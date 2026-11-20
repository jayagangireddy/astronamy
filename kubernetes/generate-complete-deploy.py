#!/usr/bin/env python3
"""Regenerate the consolidated Astronomy Shop manifest and namespace DNS."""

from pathlib import Path
import base64
import re


ROOT = Path(__file__).resolve().parent
PREFIX = "opentelemetry-demo-"
NAMESPACES = {
    "accountingservice", "adservice", "cartservice", "checkoutservice",
    "currencyservice", "emailservice", "flagd", "frauddetectionservice",
    "frontend", "frontendproxy", "imageprovider", "investigator",
    "investigator-api", "jaeger", "kafka", "loadgenerator", "otelcol",
    "paymentservice", "productcatalogservice", "prometheus", "quoteservice",
    "recommendationservice", "shippingservice", "valkey", "grafana",
}
SPECIAL_NAMESPACES = {
    "opentelemetry-demo": "frontendproxy",
    "opentelemetry-demo-flagd-config": "flagd",
    "opentelemetry-demo-frontendproxy-config": "frontendproxy",
    "opentelemetry-demo-investigator-ui": "investigator",
    "opentelemetry-demo-investigator-api": "investigator-api",
    "opentelemetry-demo-otelcol-config": "otelcol",
    "opentelemetry-demo-prometheus-config": "prometheus",
    "opentelemetry-demo-grafana-datasources": "grafana",
    "opentelemetry-demo-grafana-dashboards": "grafana",
    "opentelemetry-demo-jaeger-query": "jaeger",
    "opentelemetry-demo-jaeger-collector": "jaeger",
}


def split_documents(text):
    return [part.strip() for part in re.split(r"(?m)^---\s*$", text) if part.strip()]


def info(document):
    lines = document.splitlines()
    kind = next((m.group(1) for line in lines if (m := re.match(r"^kind:\s*(\S+)", line))), None)
    meta_index = next((i for i, line in enumerate(lines) if line == "metadata:"), None)
    if kind is None or meta_index is None:
        return kind, None, None, lines, meta_index
    name = namespace = None
    name_index = None
    for i in range(meta_index + 1, len(lines)):
        line = lines[i]
        if line and not line.startswith(" "):
            break
        if line.startswith("  name:"):
            name = line.split(":", 1)[1].strip().strip("'\"")
            name_index = i
        elif line.startswith("  namespace:"):
            namespace = line.split(":", 1)[1].strip().strip("'\"")
    return kind, name, namespace, lines, (meta_index, name_index)


def namespace_for(name):
    if name in SPECIAL_NAMESPACES:
        return SPECIAL_NAMESPACES[name]
    if name and name.startswith(PREFIX):
        suffix = name[len(PREFIX):]
        if suffix in NAMESPACES:
            return suffix
    return None


def assigned_namespace(document):
    kind, name, existing, _, _ = info(document)
    if kind == "Namespace" or kind in {"ClusterRole", "ClusterRoleBinding", "CustomResourceDefinition"}:
        return None
    return existing or namespace_for(name)


def with_namespace(document):
    kind, name, existing, lines, indices = info(document)
    namespace = assigned_namespace(document)
    if namespace is None or existing:
        return document
    _, name_index = indices
    if name_index is None:
        raise ValueError(f"Cannot find metadata.name for {kind}: {name}")
    lines.insert(name_index + 1, f"  namespace: {namespace}")
    return "\n".join(lines)


def identity(document):
    kind, name, namespace, _, _ = info(document)
    return kind, name, namespace or assigned_namespace(document) or "<cluster>"


def add_dns_suffixes(documents):
    # Service references can occur in a different source file/namespace from
    # the Service declaration (for example, Envoy routes). Seed the complete
    # demo service map so each split manifest is valid on its own as well as
    # when included in complete-deploy.yaml.
    services = {f"{PREFIX}{namespace}": namespace for namespace in NAMESPACES}
    services.update({
        "opentelemetry-demo": "frontendproxy",
        "opentelemetry-demo-jaeger-query": "jaeger",
        "opentelemetry-demo-jaeger-collector": "jaeger",
    })
    for document in documents:
        kind, name, _, _, _ = info(document)
        if kind == "Service" and name:
            namespace = namespace_for(name)
            if not namespace:
                raise ValueError(f"No namespace mapping for Service {name}")
            services[name] = namespace

    rewritten = []
    for document in documents:
        for service_name, namespace in sorted(services.items(), key=lambda pair: -len(pair[0])):
            pattern = re.escape(service_name) + r"(?=:\d|/|,\s|['\"]|\s+\d)"
            document = re.sub(pattern, f"{service_name}.{namespace}.svc.cluster.local", document)
        rewritten.append(document)
    return rewritten


def namespace_document(name):
    return "\n".join([
        "apiVersion: v1", "kind: Namespace", "metadata:", f"  name: {name}",
        "  labels:", "    app.kubernetes.io/part-of: opentelemetry-demo",
    ])


def write_generated_configmaps():
    ui_dir = ROOT.parent / "src" / "investigator"
    ui_files = ["index.html", "styles.css", "app.js", "data.js", "chat.js", "nginx.conf"]
    ui = [
        "apiVersion: v1", "kind: ConfigMap", "metadata:",
        "  name: opentelemetry-demo-investigator-ui", "  labels:",
        "    app.kubernetes.io/instance: opentelemetry-demo",
        "    app.kubernetes.io/component: investigator",
        "    app.kubernetes.io/name: opentelemetry-demo-investigator",
        "    app.kubernetes.io/part-of: opentelemetry-demo", "binaryData:",
    ]
    for filename in ui_files:
        encoded = base64.b64encode((ui_dir / filename).read_bytes()).decode("ascii")
        ui.append(f"  {filename}: {encoded}")
    (ROOT / "investigator" / "app-config.yaml").write_text("\n".join(ui) + "\n", encoding="utf-8")

    api_code = ROOT.parent / "src" / "investigator-api" / "server.py"
    encoded = base64.b64encode(api_code.read_bytes()).decode("ascii")
    api = [
        "apiVersion: v1", "kind: ConfigMap", "metadata:",
        "  name: opentelemetry-demo-investigator-api", "  labels:",
        "    app.kubernetes.io/instance: opentelemetry-demo",
        "    app.kubernetes.io/component: investigator-api",
        "    app.kubernetes.io/name: opentelemetry-demo-investigator-api",
        "    app.kubernetes.io/part-of: opentelemetry-demo", "binaryData:",
        f"  server.py: {encoded}",
    ]
    (ROOT / "investigator" / "api-config.yaml").write_text("\n".join(api) + "\n", encoding="utf-8")


def write_generated_serviceaccounts():
    documents = []
    for namespace in sorted(NAMESPACES):
        documents.append("\n".join([
            "apiVersion: v1", "kind: ServiceAccount", "metadata:",
            "  name: opentelemetry-demo", f"  namespace: {namespace}", "  labels:",
            "    app.kubernetes.io/instance: opentelemetry-demo",
            "    app.kubernetes.io/name: opentelemetry-demo",
            "    app.kubernetes.io/part-of: opentelemetry-demo",
        ]))
    (ROOT / "serviceaccount.yaml").write_text("\n---\n".join(documents) + "\n", encoding="utf-8")


def main():
    write_generated_configmaps()
    write_generated_serviceaccounts()
    source_paths = sorted(
        path for path in ROOT.rglob("*.yaml")
        if path.name not in {"complete-deploy.yaml"} and not path.name.startswith(".")
    )
    documents = split_documents((ROOT / "complete-deploy.yaml").read_text(encoding="utf-8"))
    source_documents = []
    for path in source_paths:
        text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        transformed = add_dns_suffixes(split_documents(text))
        transformed = [with_namespace(document) for document in transformed]
        path.write_text("\n---\n".join(transformed) + "\n", encoding="utf-8")
        source_documents.extend(transformed)

    # Individual component manifests override generated copies in the old bundle.
    combined = documents + source_documents
    combined = add_dns_suffixes(combined)
    normalized = {}
    for document in combined:
        kind, name, _, _, _ = info(document)
        if kind == "Namespace":
            continue
        if name == "opentelemetry-demo-investigator-api" and kind in {"Role", "RoleBinding"}:
            continue
        document = with_namespace(document)
        key = identity(document)
        normalized[key] = document

    namespaces = [namespace_document(name) for name in sorted(NAMESPACES)]
    (ROOT / "namespaces.yaml").write_text("\n---\n".join(namespaces) + "\n", encoding="utf-8")
    bundle = list(normalized.values())
    output = "# Consolidated Astronomy Shop resources. Delete this file to remove this stack.\n"
    output += "\n---\n".join(bundle) + "\n"
    (ROOT / "complete-deploy.yaml").write_text(output, encoding="utf-8")
    print(f"Wrote {len(NAMESPACES)} namespaces and {len(normalized)} unique Kubernetes resources.")


if __name__ == "__main__":
    main()

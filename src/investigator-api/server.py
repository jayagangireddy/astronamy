#!/usr/bin/env python3
"""Small, read-only Kubernetes Deployment status API for the Investigator UI."""

import json
import os
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PORT = int(os.environ.get("PORT", "8080"))
NAMESPACE = os.environ.get("KUBERNETES_NAMESPACE", "default")
API_SERVER = os.environ.get("KUBERNETES_SERVICE_HOST")
API_PORT = os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS", "443")
TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"


def list_deployments():
    if not API_SERVER:
        raise RuntimeError("Kubernetes API service environment is unavailable")

    with open(TOKEN_PATH, encoding="utf-8") as token_file:
        token = token_file.read().strip()

    endpoint = (
        f"https://{API_SERVER}:{API_PORT}/apis/apps/v1/namespaces/"
        f"{NAMESPACE}/deployments"
    )
    request = Request(endpoint, headers={"Authorization": f"Bearer {token}"})
    context = ssl.create_default_context(cafile=CA_PATH)
    with urlopen(request, context=context, timeout=5) as response:
        payload = json.load(response)

    services = []
    for deployment in payload.get("items", []):
        metadata = deployment.get("metadata", {})
        name = metadata.get("name", "")
        if not name.startswith("opentelemetry-demo-") or name.startswith("opentelemetry-demo-investigator"):
            continue
        spec = deployment.get("spec", {})
        status = deployment.get("status", {})
        services.append(
            {
                "name": name,
                "readyReplicas": status.get("readyReplicas", 0),
                "desiredReplicas": spec.get("replicas", 1),
            }
        )
    return sorted(services, key=lambda item: item["name"])


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if self.path != "/api/services":
            self.send_json(404, {"error": "not found"})
            return
        try:
            self.send_json(200, {"services": list_deployments()})
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            self.log_error("Kubernetes API request failed: %s", error)
            self.send_json(502, {"error": "unable to read Kubernetes Deployments"})

    def do_POST(self):
        if self.path == "/api/chat":
            self.send_json(501, {"error": "chat is not configured; live workload data is available"})
        else:
            self.send_json(404, {"error": "not found"})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

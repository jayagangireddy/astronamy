# Astronomy Shop Investigator

A standalone UI microservice for viewing Astronomy Shop workload health and starting investigations. It contains no Kubernetes credentials and does not call the Kubernetes API from the browser.

## API behavior

The same-origin API is deployed in the `investigator-api` namespace and reached through the frontend proxy:

- `GET /investigator-api/services` lists live Deployments named `opentelemetry-demo-*` in the cluster's demo namespaces. The API returns shortened display names plus each resource name and namespace.
- `POST /investigator-api/chat` accepts `{ "message": "...", "serviceName": "opentelemetry-demo-checkoutservice", "namespace": "checkoutservice" }` and returns a clearly labeled demo reply based on the selected Deployment's live ready/desired replica counts. It does not call an AI agent or inspect logs.

The UI computes Healthy/Failing from ready and desired replicas. If `GET /api/services` is unavailable, it shows an API-unavailable state and no workload rows; it does not substitute sample data.

The frontend modules keep data access separate from rendering: `data.js` calls the services endpoint, `chat.js` calls the chat endpoint, and `app.js` renders the page. Envoy routes `/investigator-api/` to `opentelemetry-demo-investigator-api.investigator-api.svc.cluster.local:8080`, rewriting the prefix to `/api/`. The shop's `/api/` routes continue to go to the shop frontend. The Investigator API has read-only Deployment access across the cluster.

## Container and deployment

`Dockerfile` builds a small unprivileged Nginx image. The AKS Deployment currently uses the public `nginxinc/nginx-unprivileged` image and mounts the static files from `kubernetes/investigator/app-config.yaml`, so no custom registry is required. Regenerate that ConfigMap from `src/investigator` after changing UI assets.

Each workload has its own namespace. Deploy or remove the full stack using the consolidated manifest. Namespace creation is a separate first step so all namespaces exist before their namespaced resources are applied; deletion removes the workload resources before deleting namespaces:

```powershell
kubectl --context aks-fde-astronomy-dev apply -f kubernetes/namespaces.yaml
kubectl --context aks-fde-astronomy-dev apply --server-side -f kubernetes/complete-deploy.yaml
kubectl --context aks-fde-astronomy-dev delete -f kubernetes/complete-deploy.yaml -f kubernetes/namespaces.yaml
```

The UI is exposed through the Envoy LoadBalancer in the `frontendproxy` namespace at `/investigator/`. The public Azure DNS label is configured on that Service. `kubernetes/generate-complete-deploy.py` regenerates the combined manifest, namespace list, and ConfigMaps from the source assets.

# Astronomy Shop Investigator

A standalone UI microservice for viewing Astronomy Shop workload health and starting investigations. It contains no Kubernetes credentials and does not call the Kubernetes API from the browser.

## Data contract

The separate backend repo must expose these same-origin endpoints through the frontend proxy:

- `GET /api/services` returns `{ "services": [{ "name": "checkoutservice", "readyReplicas": 1, "desiredReplicas": 1 }] }`.
- `POST /api/chat` accepts `{ "message": "...", "serviceName": "checkoutservice" }` and returns `{ "reply": "..." }`.

The UI computes Healthy/Failing from ready and desired replicas. If `GET /api/services` is missing or returns an error, it shows an API-unavailable state and no workload rows; it does not substitute sample data. Chat replies are returned by the backend only.

The frontend modules keep data access separate from rendering: `data.js` calls the services endpoint, `chat.js` calls the chat endpoint, and `app.js` renders the page. Envoy routes `/api/` to `opentelemetry-demo-investigator-api.default.svc.cluster.local:8080`. The backend repo should expose that ClusterIP Service name and port, or update the Envoy cluster to match it.

## Container and deployment

`Dockerfile` builds a small unprivileged Nginx image. The AKS Deployment currently uses the public `nginxinc/nginx-unprivileged` image and mounts the static files from `kubernetes/investigator/app-config.yaml`, so no custom registry is required. Regenerate that ConfigMap from `src/investigator` after changing UI assets.

The verified Astronomy Shop namespace is `default` on context `aks-fde-astronomy-dev`:

```powershell
kubectl --context aks-fde-astronomy-dev apply -n default -f kubernetes/investigator
kubectl --context aks-fde-astronomy-dev rollout status -n default deployment/opentelemetry-demo-investigator
```

The UI is exposed through the existing Envoy LoadBalancer at `/investigator/`. Live data requires the separate backend and an Envoy `/api/` route to its Service.

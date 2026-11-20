# Astronomy Shop Investigator

The UI is served at http://astronamy-shop-sudha-demo.eastus.cloudapp.azure.com:8080/investigator/ through the existing frontend proxy.

Chat uses `sendChatMessage` in `chat.js` to POST `{ "message": "..." }` to same-origin `/api/chat`. The message includes the current conversation and asks the existing agent to discover and investigate the requested services using its MCP tools. Conversation history is held in the page until it is reloaded. The chat panel shows loading, reply, and error states. Envoy preserves the path, method, and body and forwards to `kube-investigator-agent.kube-investigator.svc.cluster.local:8080` with a 120-second timeout. MCP remains internal; the proxy has no MCP route.

`GET /investigator-api/services` uses the existing read-only Deployment API for workload rows. Its legacy demo chat handler is not used by the UI.

The existing Dockerfile builds the UI. Current image: `kubeinvestigatoracr5837.azurecr.io/astronomy-investigator-ui:20261115-chat-3`. Build with Docker and push to the existing ACR (remote ACR Tasks are disabled). The Deployment retains its original labels, probes, selectors, and ConfigMap mounts, so regenerate `app-config.yaml` from source assets as well. Keep `complete-deploy.yaml` synchronized; `kubernetes/generate-complete-deploy.py` is the repository generator.

Apply only the required files in `kubernetes/investigator/`, using `kubectl --context aks-fde-astronomy-dev`. Restart `deployment/opentelemetry-demo-frontendproxy` in `frontendproxy` after changing its mounted Envoy configuration. Do not apply the whole stack for a UI update.

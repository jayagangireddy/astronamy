# Astronomy Shop Investigator

The UI is served at http://astronamy-shop-sudha-demo.eastus.cloudapp.azure.com:8080/investigator/ through the existing frontend proxy.

Chat posts `{ "message": "...", "history": [...] }` to `/api/chat/stream` and displays tool status events as they arrive. History contains up to the previous 10 user and completed assistant messages, in order, and is held in the page until reload. If the endpoint returns 404, 405 or 501, or the browser lacks streaming support, the same payload is sent to `/api/chat`. It never retries a started stream. The optional Investigate button includes the chosen workload and namespace; typed chat does not require a selection. Envoy forwards both chat paths to the existing agent. MCP remains internal; the proxy has no MCP route. Both backend endpoints must accept the structured history field; older backend versions may reject it.

The stream adapter assumes SSE `status` events contain `tool`, `state` (`started`, `completed`, or `failed`), and optionally `invocation_id` or `invocationId`; `delta` contains a string `text`, `final` contains a nonempty `reply`, and `error` reports failure. Deltas update the answer as they arrive; the final reply replaces the accumulated text. Verify these fields, tool names, error semantics, and a final blank event delimiter against the backend before deployment. Progress labels are local to avoid showing tool arguments or raw evidence. When concurrent same-tool calls omit IDs, their completions are shown separately because they cannot be matched safely.

Run `node --test src/investigator/chat.test.mjs` with Node.js 18 or later. To test the integrated stream, start the updated backend, apply the UI ConfigMap and proxy configuration in a test cluster, then ask about a service and watch for incremental progress followed by the final reply. Test a GitHub request, an interrupted stream and a follow-up; verify MCP calls in backend logs. A 404/405/501 from an older backend should instead return the normal non-streaming response. Do not deploy the MCP server for this UI change.

`GET /investigator-api/services` uses the existing read-only Deployment API for workload rows. Its legacy demo chat handler is not used by the UI.

The existing Dockerfile builds the UI. Current image: `kubeinvestigatoracr5837.azurecr.io/astronomy-investigator-ui:20261115-chat-3`. Build with Docker and push to the existing ACR (remote ACR Tasks are disabled). The Deployment retains its original labels, probes, selectors, and ConfigMap mounts, so regenerate `app-config.yaml` from source assets as well. Keep `complete-deploy.yaml` synchronized; `kubernetes/generate-complete-deploy.py` is the repository generator.

Apply only the required files in `kubernetes/investigator/`, using `kubectl --context aks-fde-astronomy-dev`. Restart `deployment/opentelemetry-demo-frontendproxy` in `frontendproxy` after changing its mounted Envoy configuration. Do not apply the whole stack for a UI update.

# Investigator failure exercise

Target context: `aks-fde-astronomy-dev`. The original cart, payment, and Valkey manifests were restored and all three reached 1/1 ready before fault injection on 2026-11-15.

These opt-in fault manifests live outside `kubernetes/` so the full-stack manifest generator cannot accidentally include them. They copy the original Deployment configuration, changing only:

- Cart: memory limit 160Mi -> 10Mi. Observed OOMKilled, exit code 137, and restarts.
- Payment: image tag `1.12.0-paymentservice` -> `intentional-invalid-paymentservice-20261115`. Observed ErrImagePull / ImagePullBackOff with image not found.
- Both: Recreate strategy, ensuring old healthy replicas do not mask the failures.

Apply from the repo root:

```powershell
kubectl --context aks-fde-astronomy-dev apply -f experiments/investigator-failures/cart-oom.yaml -f experiments/investigator-failures/payment-image.yaml
```

Open http://astronamy-shop-sudha-demo.eastus.cloudapp.azure.com:8080/investigator/ and investigate each workload. The two rows should show Failing and 0/1. Namespace context is included automatically in the chat message.

## Recovery

The original source manifests remain unchanged. These commands were validated with a server-side dry run; recovery has intentionally NOT been applied:

```powershell
kubectl --context aks-fde-astronomy-dev apply -f kubernetes/cart/deploy.yaml -f kubernetes/payment/deploy.yaml
kubectl --context aks-fde-astronomy-dev rollout status deployment/opentelemetry-demo-cartservice -n cartservice --timeout=120s
kubectl --context aks-fde-astronomy-dev rollout status deployment/opentelemetry-demo-paymentservice -n paymentservice --timeout=120s
```

This restores the original images, cart's 160Mi memory limit, and default RollingUpdate strategy. Valkey is left running as cart's required dependency. ServiceAccounts named `opentelemetry-demo` were also restored in cartservice, paymentservice, and valkey from the existing repository configuration. No agent or MCP configuration was changed.

## Verified results

Chromium validation through the existing dashboard URL on 2026-11-15:

| Target | UI row | Agent diagnosis | Completed inspect_namespace call |
| --- | --- | --- | --- |
| cartservice | Failing, 0/1 | OOMKilled, exit 137, repeated restarts, no ready endpoint | 2c18d5c61e11 (127ms) |
| paymentservice | Failing, 0/1 | ImagePullBackOff, invalid image tag not found, no ready endpoint | 662a0afdf111 (81ms) |

Both Investigate actions POSTed the selected workload name and namespace through `/api/chat`. Both returned HTTP 200, and browser assertions confirmed the exact reply strings appeared in the chat panel. MCP logs recorded tool_call_started and tool_call_completed for both calls. The agent correctly identified OOMKills but noted that its inspection alone did not prove the configured memory limit; the 10Mi limit was independently verified with kubectl.

Final state: cart 0/1 ready, payment 0/1 ready, Valkey 1/1 ready. Faults remain active intentionally. The temporary browser container and script were removed.

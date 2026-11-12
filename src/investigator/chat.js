export async function sendChatMessage(message, workload) {
  const response = await fetch('/investigator-api/chat', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      serviceName: workload?.resourceName ?? workload?.name ?? null,
      namespace: workload?.namespace ?? null,
    }),
  });
  if (!response.ok) throw new Error(`POST /investigator-api/chat returned HTTP ${response.status}`);

  const payload = await response.json();
  if (typeof payload.reply !== 'string') throw new Error('POST /investigator-api/chat must return a reply string');
  return { text: payload.reply, source: payload.source || 'BACKEND' };
}

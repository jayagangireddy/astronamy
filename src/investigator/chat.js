export async function sendChatMessage(message, workload) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, serviceName: workload?.name ?? null }),
  });
  if (!response.ok) throw new Error(`POST /api/chat returned HTTP ${response.status}`);

  const payload = await response.json();
  if (typeof payload.reply !== 'string') throw new Error('POST /api/chat must return a reply string');
  return { text: payload.reply, source: 'LIVE BACKEND' };
}

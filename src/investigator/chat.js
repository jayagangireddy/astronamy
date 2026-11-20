export async function sendChatMessage(message, history = []) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: [
        'Investigate the user request using available Kubernetes MCP tools to discover services and namespaces and inspect relevant resources. For all unhealthy services, discover and investigate each unhealthy service. Use GitHub tools when relevant. Explain the likely cause and supporting evidence, and state any uncertainty or unavailable evidence.',
        ...history.map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`),
        `User: ${message}`,
      ].join('\n\n'),
    }),
  });
  if (!response.ok) throw new Error(`POST /api/chat returned HTTP ${response.status}`);

  const payload = await response.json();
  if (typeof payload.reply !== 'string') throw new Error('POST /api/chat must return a reply string');
  return { text: payload.reply, source: payload.source || 'BACKEND' };
}

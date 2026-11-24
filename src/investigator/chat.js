// The backend's example SSE schema is adapted here; keep protocol assumptions isolated.
export function createSSEParser(onEvent) {
  let buffer = '', event = '', data = [];
  function line(value) {
    if (value === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
      event = ''; data = [];
      return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let valuePart = colon < 0 ? '' : value.slice(colon + 1);
    if (valuePart.startsWith(' ')) valuePart = valuePart.slice(1);
    if (field === 'event') event = valuePart;
    if (field === 'data') data.push(valuePart);
  }
  return {
    feed(chunk, end = false) {
      buffer += chunk;
      let match;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        // A CR at the end of a chunk might be the first half of CRLF.
        if (!end && match[0] === '\r' && match.index === buffer.length - 1) break;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      // An event without its terminating blank line is incomplete and must not be dispatched.
      if (end) buffer = '';
    },
  };
}

export function createProgressTracker() {
  const steps = [];
  return {
    steps,
    update(status) {
      if (!status || typeof status.tool !== 'string' || !status.tool.trim() || !['started', 'completed', 'failed'].includes(status.state)) {
        throw new Error('Invalid investigation status event');
      }
      const id = status.invocation_id ?? status.invocationId ?? null;
      if (id !== null && typeof id !== 'string' && typeof id !== 'number') throw new Error('Invalid invocation ID');
      let step;
      if (id !== null) step = steps.find((item) => item.id === id && item.tool === status.tool);
      else if (status.state !== 'started') {
        const active = steps.filter((item) => item.id === null && item.tool === status.tool && item.state === 'started');
        if (active.length === 1) step = active[0];
      }
      if (!step || (status.state === 'started' && step.state !== 'started')) {
        step = { id, tool: status.tool, state: status.state };
        steps.push(step);
      }
      step.state = status.state;
      return steps;
    },
  };
}

function requestBody(message, history) {
  return JSON.stringify({ message: [
    'Investigate the user request using available Kubernetes MCP tools to discover services and namespaces and inspect relevant resources. For all unhealthy services, discover and investigate each unhealthy service. Use GitHub tools when relevant. Explain the likely cause and supporting evidence, and state any uncertainty or unavailable evidence.',
    ...history.map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`),
    `User: ${message}`,
  ].join('\n\n') });
}

export async function sendChatMessage(message, history = [], { onStatus = () => {}, onDelta = () => {}, signal } = {}) {
  const body = requestBody(message, history);
  const headers = { Accept: 'text/event-stream', 'Content-Type': 'application/json' };
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
  try {
    const fallback = async () => {
      const response = await fetch('/api/chat', { method: 'POST', headers: { ...headers, Accept: 'application/json' }, body, signal: controller.signal });
      if (!response.ok) throw new Error(`Chat returned HTTP ${response.status}`);
      const result = await response.json();
      if (typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Chat returned an empty response');
      return { text: result.reply, source: result.source || 'BACKEND' };
    };
    if (typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') return await fallback();
    const response = await fetch('/api/chat/stream', { method: 'POST', headers, body, signal: controller.signal });
    if ([404, 405, 501].includes(response.status)) return await fallback();
    if (!response.ok) throw new Error(`Investigation returned HTTP ${response.status}`);
    if (!response.body?.getReader || !/^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) {
      throw new Error('The investigation endpoint did not return an event stream');
    }
    let result = null;
    const parser = createSSEParser(({ event, data }) => {
      if (!['status', 'delta', 'final', 'error'].includes(event)) return;
      let payload;
      try { payload = JSON.parse(data); } catch { throw new Error('Invalid investigation event'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid investigation event');
      if (event === 'status') onStatus(payload);
      if (event === 'delta') {
        if (typeof payload.text !== 'string') throw new Error('Invalid investigation delta event');
        onDelta(payload.text);
      }
      if (event === 'error') throw new Error('The investigation reported an error');
      if (event === 'final') {
        if (typeof payload.reply !== 'string' || !payload.reply.trim()) throw new Error('The investigation returned an empty response');
        result = { text: payload.reply, source: 'INVESTIGATOR' };
      }
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!result) {
        const { value, done } = await reader.read();
        if (done) { parser.feed(decoder.decode(), true); break; }
        parser.feed(decoder.decode(value, { stream: true }));
      }
      if (!result) throw new Error('The investigation stream ended before a final response');
      return result;
    } finally { await reader.cancel().catch(() => {}); }
  } catch (error) {
    if (timedOut) throw new Error('The investigation timed out');
    if (controller.signal.aborted) throw new Error('The investigation was cancelled');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

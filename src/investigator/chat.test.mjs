import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import browser ES module without changing the repository-wide module type.
const source = await readFile(new URL('./chat.js', import.meta.url), 'utf8');
const { createSSEParser, createProgressTracker, sendChatMessage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('SSE parser handles arbitrary splits, CRLF, multiline data and multiple events', () => {
  const wire = 'event: status\r\ndata: {"tool":"inspect_namespace",\r\ndata: "state":"started"}\r\n\r\nevent: final\ndata: {"reply":"done"}\n\n';
  for (let i = 0; i <= wire.length; i++) {
    const events = [];
    const parser = createSSEParser((event) => events.push(event));
    parser.feed(wire.slice(0, i)); parser.feed(wire.slice(i), true);
    assert.deepEqual(events.map((event) => event.event), ['status', 'final']);
    assert.equal(JSON.parse(events[0].data).state, 'started');
  }
  const events = [];
  const parser = createSSEParser((event) => events.push(event));
  parser.feed('event: final\ndata: {"reply":"partial"}', true);
  assert.equal(events.length, 0);
});

test('tool calls with IDs and ambiguous concurrent calls stay separate', () => {
  const tracker = createProgressTracker();
  tracker.update({ tool: 'inspect_namespace', state: 'started', invocation_id: '1' });
  tracker.update({ tool: 'inspect_namespace', state: 'started', invocation_id: '2' });
  tracker.update({ tool: 'inspect_namespace', state: 'completed', invocation_id: '2' });
  assert.deepEqual(tracker.steps.map((step) => step.state), ['started', 'completed']);
  tracker.update({ tool: 'read_repo_file', state: 'started' });
  tracker.update({ tool: 'read_repo_file', state: 'started' });
  tracker.update({ tool: 'read_repo_file', state: 'completed' });
  assert.deepEqual(tracker.steps.slice(2).map((step) => step.state), ['started', 'started', 'completed']);
  assert.throws(() => tracker.update({ tool: ' ', state: 'started' }), /Invalid/);
});

test('deltas arrive progressively and the final answer is authoritative', async () => {
  const original = globalThis.fetch;
  try {
    const encoder = new TextEncoder();
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      for (const event of [
        'event: delta\ndata: {"text":"Hello"}\n\n',
        'event: delta\ndata: {"text":" world"}\n\n',
        'event: final\ndata: {"reply":"Hello world!"}\n\n',
      ]) controller.enqueue(encoder.encode(event));
      controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
    let text = ''; const snapshots = []; const statuses = [];
    const result = await sendChatMessage('hi', [], { onDelta: (delta) => { text += delta; snapshots.push(text); }, onStatus: (status) => statuses.push(status) });
    assert.deepEqual(snapshots, ['Hello', 'Hello world']);
    assert.equal(result.text, 'Hello world!');
    assert.deepEqual(statuses, []);
  } finally { globalThis.fetch = original; }
});

test('markdown renders as safe DOM nodes with lists, code and escaped punctuation', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  class Node {
    constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.textContent = text; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    get firstChild() { return this.children[0]; }
  }
  const document = { createElement: (tag) => new Node(tag), createTextNode: (text) => new Node('#text', text) };
  const renderAnswer = new Function('document', `${app.slice(app.indexOf('function renderAnswer('), app.indexOf('\nfunction addMessage('))}; return renderAnswer;`)(document);
  const output = new Node('div');
  renderAnswer(output, '**Issue**\n\n- `cart` failed\n- \\-escaped\n\n```js\n<x>\n```\n\n<script>');
  assert.deepEqual(output.children.map((node) => node.tagName), ['P', 'UL', 'PRE', 'P']);
  assert.equal(output.children[0].children[1].tagName, 'STRONG');
  assert.equal(output.children[1].children[0].children[1].tagName, 'CODE');
  assert.equal(output.children[1].children[1].children[1].textContent, '-');
  assert.equal(output.children[2].firstChild.textContent, '<x>\n');
  assert.equal(output.children[3].children[0].textContent, '<script>');
});

test('streaming final response and status events; fallback only on explicit unsupported status', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(url);
      const stream = new ReadableStream({ start(controller) {
        for (const part of ['event: status\ndata: {"tool":"find_repo_', 'files","state":"started"}\n\nevent: final\ndata: {"reply":"Issue\\n\\nFix"}\n\n']) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const seen = [];
    const reply = await sendChatMessage('question', [], { onStatus: (event) => seen.push(event.tool) });
    assert.equal(reply.text, 'Issue\n\nFix');
    assert.deepEqual(seen, ['find_repo_files']);
    globalThis.fetch = async (url) => { calls.push(url); return url.endsWith('/stream') ? new Response('', { status: 404 }) : Response.json({ reply: 'fallback' }); };
    assert.equal((await sendChatMessage('question')).text, 'fallback');
    assert.deepEqual(calls.slice(-2), ['/api/chat/stream', '/api/chat']);
    globalThis.fetch = async (url) => { calls.push(url); return new Response('event: status\ndata: {"tool":"inspect_namespace","state":"started"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); };
    await assert.rejects(sendChatMessage('question'), /ended before/);
    assert.equal(calls.at(-1), '/api/chat/stream');
  } finally { globalThis.fetch = original; }
});

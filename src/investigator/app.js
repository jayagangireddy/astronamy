import { getWorkloads } from './data.js';
import { createProgressTracker, sendChatMessage } from './chat.js';

const state = { workloads: [], filter: 'all', history: [], busy: false, loadError: null };
const rows = document.querySelector('#workload-rows');
const messages = document.querySelector('#chat-messages');
const dataStatus = document.querySelector('#data-status');

function renderAnswer(element, text) {
  element.replaceChildren();
  // Build DOM nodes directly: model output is never interpreted as HTML.
  function inline(parent, value) {
    const pattern = /\\([\\`*_[\]{}()#+.!>-])|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
    let last = 0, match;
    while ((match = pattern.exec(value))) {
      parent.append(document.createTextNode(value.slice(last, match.index)));
      if (match[1]) parent.append(document.createTextNode(match[1]));
      else {
        const node = document.createElement(match[2] ? 'strong' : 'code');
        node.textContent = match[2] || match[3];
        parent.append(node);
      }
      last = pattern.lastIndex;
    }
    parent.append(document.createTextNode(value.slice(last)));
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph = [], list = null, code = null;
  function flush() {
    if (!paragraph.length) return;
    const p = document.createElement('p');
    inline(p, paragraph.join('\n'));
    element.append(p);
    paragraph = [];
  }
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush(); list = null;
      if (code) { element.append(code); code = null; }
      else { code = document.createElement('pre'); code.append(document.createElement('code')); }
      continue;
    }
    if (code) { code.firstChild.textContent += `${line}\n`; continue; }
    if (!line.trim()) { flush(); list = null; continue; }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (item) {
      flush();
      const type = item[2] ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== type) { list = document.createElement(type); element.append(list); }
      const li = document.createElement('li'); inline(li, item[3]); list.append(li);
      continue;
    }
    list = null;
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const p = document.createElement('p');
      const strong = document.createElement('strong'); inline(strong, heading[1]); p.append(strong); element.append(p);
    } else paragraph.push(line);
  }
  flush();
  if (code) element.append(code);
}

function addMessage(text, kind, label) {
  const article = document.createElement('article');
  article.className = `message ${kind}`;
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = label;
  const content = document.createElement('p');
  content.textContent = text;
  article.append(meta, content);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

function renderSummary() {
  const healthy = state.workloads.filter((item) => item.status === 'healthy').length;
  const count = state.loadError ? '—' : state.workloads.length;
  document.querySelector('#total-count').textContent = count;
  document.querySelector('#healthy-count').textContent = state.loadError ? '—' : healthy;
  document.querySelector('#failing-count').textContent = state.loadError ? '—' : state.workloads.length - healthy;
  document.querySelector('#all-filter-count').textContent = state.workloads.length;
}

function renderRows() {
  if (state.loadError) {
    rows.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-state';
    cell.textContent = 'Live workload data is unavailable. The backend must provide GET /api/services; no sample data is shown.';
    row.append(cell);
    rows.append(row);
    return;
  }
  const visible = state.workloads.filter((item) => state.filter === 'all' || item.status === state.filter);
  rows.replaceChildren();
  if (visible.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-state';
    cell.textContent = 'No workloads match this filter.';
    row.append(cell);
    rows.append(row);
    return;
  }

  for (const workload of visible) {
    const row = document.createElement('tr');
    const service = document.createElement('th');
    service.scope = 'row';
    service.className = 'service-name';
    service.textContent = workload.name;

    const healthCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status-badge ${workload.status}`;
    badge.innerHTML = `<span aria-hidden="true"></span>${workload.status === 'healthy' ? 'Healthy' : 'Failing'}`;
    healthCell.append(badge);

    const replicas = document.createElement('td');
    replicas.className = `replicas ${workload.status === 'failing' ? 'replicas-failing' : ''}`;
    replicas.textContent = `${workload.ready}/${workload.desired}`;

    const action = document.createElement('td');
    action.className = 'action-cell';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'investigate-button';
    button.textContent = 'Investigate';
    button.setAttribute('aria-label', `Investigate ${workload.name}`);
    button.disabled = state.busy;
    button.addEventListener('click', () => startChat(`Investigate ${workload.name}`, workload));
    action.append(button);
    row.append(service, healthCell, replicas, action);
    rows.append(row);
  }
}

async function submitChat(question, displayedQuestion = question) {
  const previousHistory = state.history.slice();
  state.history.push({ role: 'user', content: displayedQuestion });
  const article = document.createElement('article');
  article.className = 'message assistant-message';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = 'INVESTIGATOR';
  const activity = document.createElement('details');
  activity.className = 'investigation-activity';
  activity.open = true;
  activity.hidden = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Investigation activity';
  const list = document.createElement('ul');
  activity.append(summary, list);
  const content = document.createElement('div');
  content.className = 'investigation-answer';
  content.textContent = 'Investigating…';
  article.append(meta, activity, content);
  messages.append(article);
  const tracker = createProgressTracker();
  const controller = new AbortController();
  const cancelOnNavigation = () => controller.abort();
  window.addEventListener('pagehide', cancelOnNavigation, { once: true });
  const labels = { inspect_namespace: 'Inspecting Kubernetes namespace', find_repo_files: 'Searching relevant GitHub files', read_repo_file: 'Reading source file' };
  let streamedText = '';
  const updateStatus = (status) => {
    tracker.update(status);
    activity.hidden = false;
    list.replaceChildren();
    for (const step of tracker.steps) {
      const item = document.createElement('li');
      const icon = document.createElement('span');
      icon.className = `activity-icon ${step.state}`;
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = step.state === 'completed' ? '✓' : step.state === 'failed' ? '⚠' : '';
      const label = document.createElement('span');
      const name = labels[step.tool] || 'Running investigation tool';
      label.textContent = `${name}${step.state === 'started' ? '…' : step.state === 'failed' ? ' — failed' : ' — completed'}`;
      item.append(icon, label);
      list.append(item);
    }
    messages.scrollTop = messages.scrollHeight;
  };
  try {
    const response = await sendChatMessage(question, previousHistory, {
      onStatus: updateStatus,
      onDelta: (text) => {
        streamedText += text;
        renderAnswer(content, streamedText);
        messages.scrollTop = messages.scrollHeight;
      },
      signal: controller.signal,
    });
    state.history.push({ role: 'assistant', content: response.text });
    meta.textContent = response.source;
    renderAnswer(content, response.text);
    activity.open = false;
    activity.hidden = tracker.steps.length === 0;
  } catch (error) {
    list.querySelectorAll('.activity-icon.started').forEach((icon) => {
      icon.className = 'activity-icon failed';
      icon.textContent = '⚠';
    });
    if (!streamedText) content.replaceChildren();
    const errorMessage = document.createElement('p');
    errorMessage.textContent = `Investigation unavailable: ${error.message}`;
    content.append(errorMessage);
    article.classList.add('investigation-error');
    activity.hidden = tracker.steps.length === 0;
  } finally {
    window.removeEventListener('pagehide', cancelOnNavigation);
  }
  messages.scrollTop = messages.scrollHeight;
}
async function refreshWorkloads() {
  try {
    state.workloads = await getWorkloads();
    state.loadError = null;
    dataStatus.textContent = 'Live Kubernetes data · refreshed just now';
    document.querySelector('.updated').classList.remove('unavailable');
    document.querySelector('.updated').classList.add('connected');
  } catch (error) {
    state.workloads = [];
    state.loadError = error;
    dataStatus.textContent = 'Live Kubernetes data unavailable';
    document.querySelector('.updated').classList.remove('connected');
    document.querySelector('.updated').classList.add('unavailable');
  }
  renderSummary();
  renderRows();
}

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((filterButton) => {
      const active = filterButton === button;
      filterButton.classList.toggle('active', active);
      filterButton.setAttribute('aria-pressed', String(active));
    });
    renderRows();
  });
});

async function startChat(question, workload = null) {
  if (!question || state.busy) return;
  state.busy = true;
  document.querySelector('.send-button').disabled = true;
  renderRows();
  addMessage(question, 'user-message', 'YOU');
  try {
    const prompt = workload ? `${question}\nWorkload: ${workload.resourceName}; namespace: ${workload.namespace}.` : question;
    await submitChat(prompt, question);
  } finally {
    state.busy = false;
    document.querySelector('.send-button').disabled = false;
    renderRows();
    document.querySelector('#chat-input').focus();
  }
}

document.querySelector('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#chat-input');
  const question = input.value.trim();
  if (!question || state.busy) return;
  input.value = '';
  await startChat(question);
});

await refreshWorkloads();
if (state.loadError) {
  addMessage(`Could not load live workloads: ${state.loadError.message}. No sample data is shown.`, 'system-message', 'API UNAVAILABLE');
} else {
  addMessage('Live Kubernetes workload data is connected. This dashboard refreshes every 15 seconds.', 'assistant-message', 'LIVE DATA');
}
window.setInterval(refreshWorkloads, 15000);

import { getWorkloads } from './data.js';
import { sendChatMessage } from './chat.js';

const state = { workloads: [], filter: 'all', history: [], busy: false, loadError: null };
const rows = document.querySelector('#workload-rows');
const messages = document.querySelector('#chat-messages');
const dataStatus = document.querySelector('#data-status');

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
    cell.colSpan = 3;
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
    cell.colSpan = 3;
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

    row.append(service, healthCell, replicas);
    rows.append(row);
  }
}

async function submitChat(question) {
  addMessage('Investigating...', 'system-message', 'LOADING');
  const pending = messages.lastElementChild;
  try {
    const response = await sendChatMessage(question, state.history);
    state.history.push({ role: 'user', text: question }, { role: 'assistant', text: response.text });
    addMessage(response.text, 'assistant-message', response.source);
  } catch (error) {
    addMessage(`Live chat is unavailable: ${error.message}`, 'system-message', 'API UNAVAILABLE');
  } finally {
    pending.remove();
  }
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

document.querySelector('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#chat-input');
  const question = input.value.trim();
  if (!question || state.busy) return;
  state.busy = true;
  document.querySelector('.send-button').disabled = true;
  input.value = '';
  addMessage(question, 'user-message', 'YOU');
  try {
    await submitChat(question);
  } finally {
    state.busy = false;
    document.querySelector('.send-button').disabled = false;
    input.focus();
  }
});

await refreshWorkloads();
if (state.loadError) {
  addMessage(`Could not load live workloads: ${state.loadError.message}. No sample data is shown.`, 'system-message', 'API UNAVAILABLE');
} else {
  addMessage('Live Kubernetes workload data is connected. This dashboard refreshes every 15 seconds.', 'assistant-message', 'LIVE DATA');
}
window.setInterval(refreshWorkloads, 15000);

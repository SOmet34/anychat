'use strict';

/* ============ Storage ============ */

const CONFIG_KEY = 'anychat.config';

const defaultConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
  proxyUrl: '',
  temperature: 0.7,
  maxTokens: 2000,
  stream: true,
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...defaultConfig };
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return { ...defaultConfig };
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

let config = loadConfig();

/* ============ Providers ============ */

const PROVIDERS = {
  openai: {
    label: 'OpenAI-compatible',
    defaultBase: 'https://api.openai.com',
    modelPath: '/v1/models',
    placeholder: 'sk-…',
    modelPlaceholder: 'gpt-4o',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultBase: 'https://api.anthropic.com',
    modelPath: '/v1/models?limit=25',
    placeholder: 'sk-ant-…',
    modelPlaceholder: 'claude-sonnet-5',
    headers: { 'anthropic-version': '2023-06-01' },
  },
};

function providerInfo() {
  return PROVIDERS[config.provider] || PROVIDERS.openai;
}

function baseUrl() {
  return (config.baseUrl || providerInfo().defaultBase).replace(/\/+$/, '');
}

// When a proxy URL is set, all requests go through it (the provider's API
// blocks browser requests with CORS). The proxy forwards to the real API
// server-side, so the browser never calls the provider directly.
function proxyUrl() {
  return (config.proxyUrl || '').replace(/\/+$/, '');
}

/* ============ API calls ============ */

async function authHeaders() {
  if (!config.apiKey) throw new Error('You have not set an API key yet. Open API settings to add one.');
  const base = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    ...(providerInfo().headers || {}),
  };
  if (config.provider === 'anthropic') base['x-api-key'] = config.apiKey;
  return base;
}

// Pick the URL to fetch, routing through the proxy if configured.
function requestUrl(target) {
  const proxy = proxyUrl();
  if (!proxy) return target;
  const u = new URL(proxy + '/proxy');
  u.searchParams.set('url', target);
  return u.toString();
}

function wireModel(payload) {
  const chosen = document.getElementById('modelSelect').value;
  const model = chosen === '__manual' ? config.model : chosen;
  if (model) payload.model = model;
  return payload;
}

async function fetchModels() {
  const headers = await authHeaders();
  const res = await fetch(requestUrl(baseUrl() + providerInfo().modelPath), { headers });
  if (!res.ok) throw new Error(`Could not list models (HTTP ${res.status}).`);
  const json = await res.json();
  const list = json.data || json.models || [];
  return list
    .map((m) => (typeof m === 'string' ? m : m.id || m.name))
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

async function sendMessages(messages, onChunk) {
  const headers = await authHeaders();
  const url = requestUrl(baseUrl() + (config.provider === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'));
  const body = buildRequestBody(messages);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err.error?.message || err.error?.type || JSON.stringify(err);
    } catch { /* ignore parse errors */ }
    throw new Error(detail);
  }

  if (!body.stream) {
    const json = await res.json();
    const text = config.provider === 'anthropic'
      ? (json.content || []).map((c) => c.text || '').join('')
      : json.choices?.[0]?.message?.content || '';
    onChunk(text);
    return text;
  }

  // Stream the response. Some providers (e.g. locally hosted Ollama-style
  // servers) ignore the stream flag and return a plain JSON body — so we
  // collect the whole response and fall back to non-streaming parsing.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep the incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = config.provider === 'anthropic'
          ? (json.type === 'content_block_delta' ? json.delta?.text : '')
          : json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(full);
        }
      } catch { /* ignore partial JSON */ }
    }
  }

  // Flush any remaining buffered data after stream ends
  if (buffer) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trim();
      if (data && data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          const delta = config.provider === 'anthropic'
            ? (json.type === 'content_block_delta' ? json.delta?.text : '')
            : json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onChunk(full);
          }
        } catch { /* ignore */ }
      }
    }
  }

  // The provider ignored streaming and returned a plain JSON body.
  if (!full && buffer.trim()) {
    try {
      const json = JSON.parse(buffer.trim());
      const text = config.provider === 'anthropic'
        ? (json.content || []).map((c) => c.text || '').join('')
        : json.choices?.[0]?.message?.content || '';
      if (text) {
        full = text;
        onChunk(full);
      }
    } catch {
      // Not JSON — some providers return plain text. Use it verbatim.
      const text = buffer.trim();
      if (text) {
        full = text;
        onChunk(full);
      }
    }
  }

  // Diagnostics: if we still have nothing, surface the raw response so we can
  // see what the provider actually sent back.
  if (!full) {
    console.error('[anychat] empty response. URL:', url);
    console.error('[anychat] request body:', body);
    console.error('[anychat] raw response buffer:', buffer);
  }
  return full;
}

function buildRequestBody(messages) {
  const base = {
    temperature: Number(config.temperature) || 0.7,
    stream: config.stream !== false,
  };
  if (config.maxTokens) base.max_tokens = Number(config.maxTokens);

  if (config.provider === 'anthropic') {
    const system = messages.find((m) => m.role === 'system');
    const body = { ...base, messages: messages.filter((m) => m.role !== 'system') };
    if (system) body.system = system.content;
    if (!base.max_tokens) base.max_tokens = 1024; // Anthropic requires max_tokens
    return wireModel(body);
  }
  return wireModel({ ...base, messages });
}

/* ============ Conversations ============ */

const CONVOS_KEY = 'anychat.conversations';

function loadConvos() {
  try {
    return JSON.parse(localStorage.getItem(CONVOS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveConvos() {
  localStorage.setItem(CONVOS_KEY, JSON.stringify(convos));
}

let convos = loadConvos();
let currentId = null;
let isStreaming = false;

function currentConvo() {
  return convos.find((c) => c.id === currentId) || null;
}

function newConversation() {
  const convo = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: 'New chat', messages: [] };
  convos.unshift(convo);
  currentId = convo.id;
  saveConvos();
  renderConversations();
  renderMessages();
}

function deleteConversation(id) {
  convos = convos.filter((c) => c.id !== id);
  if (currentId === id) currentId = convos[0]?.id || null;
  saveConvos();
  renderConversations();
  renderMessages();
}

/* ============ Rendering ============ */

if (typeof marked !== 'undefined') marked.setOptions({ breaks: true });

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text || '');
  try {
    return DOMPurify.sanitize(marked.parse(text || ''));
  } catch {
    return escapeHtml(text || '');
  }
}

function renderConversations() {
  const el = document.getElementById('conversations');
  el.innerHTML = '';
  if (!convos.length) {
    el.innerHTML = '<div class="conv-empty">No conversations yet</div>';
    return;
  }
  for (const convo of convos) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (convo.id === currentId ? ' active' : '');
    item.innerHTML = `
      <span class="conv-title"></span>
      <button class="conv-del" title="Delete">🗑</button>
    `;
    item.querySelector('.conv-title').textContent = convo.title;
    item.addEventListener('click', () => {
      currentId = convo.id;
      renderConversations();
      renderMessages();
    });
    item.querySelector('.conv-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(convo.id);
    });
    el.appendChild(item);
  }
}

function renderMessages() {
  const messagesEl = document.getElementById('messages');
  const welcome = document.getElementById('welcome');
  const convo = currentConvo();

  messagesEl.innerHTML = '';
  if (!convo || !convo.messages.length) {
    welcome.style.display = 'flex';
    messagesEl.style.display = 'none';
    return;
  }
  welcome.style.display = 'none';
  messagesEl.style.display = 'flex';

  for (const msg of convo.messages) {
    messagesEl.appendChild(messageEl(msg.role, msg.content));
  }
  scrollChatToBottom();
}

function messageEl(role, content) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `
    <div class="avatar">${role === 'user' ? 'U' : '✦'}</div>
    <div class="bubble"></div>
  `;
  el.querySelector('.bubble').innerHTML = renderMarkdown(content);
  return el;
}

function scrollChatToBottom() {
  const chat = document.getElementById('chat');
  chat.scrollTop = chat.scrollHeight;
}

/* ============ Sending ============ */

async function sendMessage(text) {
  if (isStreaming) return;
  if (!config.apiKey) {
    openSettings();
    toast('Add your API key first', true);
    return;
  }

  // Make sure we have a conversation
  if (!currentConvo()) newConversation();
  const convo = currentConvo();

  // Build user message content (text + optional image)
  const imageBlock = imageToProviderFormat();
  const content = imageBlock
    ? [{ type: 'text', text }, imageBlock]
    : text;

  convo.messages.push({ role: 'user', content });
  const userText = typeof content === 'string' ? content : content.find(c => c.type === 'text')?.text || '';
  if (convo.messages.filter((m) => m.role === 'user').length === 1) {
    convo.title = userText.length > 32 ? userText.slice(0, 32) + '…' : userText;
  }
  saveConvos();
  renderConversations();

  // Build the assistant bubble with a typing indicator
  const messagesEl = document.getElementById('messages');
  document.getElementById('welcome').style.display = 'none';
  messagesEl.style.display = 'flex';
  // Show image preview in user bubble if attached
  const userContent = imageBlock
    ? renderMarkdown(userText) + '<br><img src="' + attachedImage.dataUrl + '" style="max-width:200px;border-radius:8px;margin-top:8px;">'
    : renderMarkdown(userText);
  messagesEl.appendChild(messageEl('user', userContent));

  const asstEl = messageEl('assistant', '');
  const bubble = asstEl.querySelector('.bubble');
  bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(asstEl);
  scrollChatToBottom();

  const input = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  isStreaming = true;
  input.value = '';
  autoResize(input);
  sendBtn.disabled = true;
  clearImage(); // Clear after sending

  try {
    const full = await sendMessages(
      convo.messages.map(({ role, content }) => ({ role, content })),
      (partial) => {
        bubble.innerHTML = renderMarkdown(partial);
        scrollChatToBottom();
      }
    );
    bubble.innerHTML = renderMarkdown(full || '(empty response)');
    convo.messages.push({ role: 'assistant', content: full || '' });
    saveConvos();
  } catch (err) {
    bubble.innerHTML = `<span style="color:var(--danger)">Error: ${escapeHtml(err.message)}</span>`;
  } finally {
    isStreaming = false;
    sendBtn.disabled = !input.value.trim();
    input.focus();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============ Settings modal ============ */

function openSettings() {
  const modal = document.getElementById('settingsModal');
  document.getElementById('providerSelect').value = config.provider;
  document.getElementById('apiKeyInput').value = config.apiKey;
  document.getElementById('baseUrlInput').value = config.baseUrl;
  document.getElementById('modelInput').value = config.model;
  document.getElementById('proxyUrlInput').value = config.proxyUrl || '';
  document.getElementById('tempInput').value = config.temperature;
  document.getElementById('maxTokensInput').value = config.maxTokens;
  document.getElementById('streamInput').checked = config.stream !== false;
  updateProviderHints();
  modal.classList.add('open');
  document.getElementById('apiKeyInput').focus();
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function updateProviderHints() {
  const provider = document.getElementById('providerSelect').value;
  const info = PROVIDERS[provider];
  document.getElementById('apiKeyInput').placeholder = info.placeholder;
  document.getElementById('baseUrlInput').placeholder = info.defaultBase;
  document.getElementById('modelInput').placeholder = info.modelPlaceholder;
}

function saveSettings() {
  config.provider = document.getElementById('providerSelect').value;
  config.apiKey = document.getElementById('apiKeyInput').value.trim();
  config.baseUrl = document.getElementById('baseUrlInput').value.trim();
  config.model = document.getElementById('modelInput').value.trim();
  config.proxyUrl = document.getElementById('proxyUrlInput').value.trim();
  config.temperature = parseFloat(document.getElementById('tempInput').value) || 0.7;
  config.maxTokens = parseInt(document.getElementById('maxTokensInput').value, 10) || 0;
  config.stream = document.getElementById('streamInput').checked;
  saveConfig(config);
  closeSettings();
  populateModels().catch(() => {});
  if (!config.apiKey) toast('Settings saved — add an API key to start chatting');
  else toast('Settings saved');
}

/* ============ Model picker ============ */

async function populateModels() {
  const select = document.getElementById('modelSelect');
  select.innerHTML = '<option value="__manual">Loading models…</option>';
  if (!config.apiKey) {
    select.innerHTML = '<option value="__manual">Set API key first</option>';
    return;
  }
  try {
    const models = await fetchModels();
    select.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    }
    // Add manual entry option at end
    const manual = document.createElement('option');
    manual.value = '__manual';
    manual.textContent = '✏️ Custom model…';
    select.appendChild(manual);

    // Prefer the saved model if available
    if (config.model && models.includes(config.model)) {
      select.value = config.model;
    } else if (config.model) {
      select.value = '__manual';
    }
  } catch {
    select.innerHTML = '<option value="__manual">✏️ Custom model… (could not list models)</option>';
  }
}

// When user picks a model, remember it; "Custom model…" opens settings
document.getElementById('modelSelect').addEventListener('change', (e) => {
  if (e.target.value === '__manual') {
    openSettings();
    document.getElementById('modelInput').focus();
  } else {
    config.model = e.target.value;
    saveConfig(config);
  }
});

/* ============ Toast ============ */

let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ============ Input handling ============ */

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');

function canSend() {
  return (inputEl.value.trim() || attachedImage) && !isStreaming;
}

inputEl.addEventListener('input', () => {
  autoResize(inputEl);
  sendBtn.disabled = !canSend();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('composer').requestSubmit();
  }
});

document.getElementById('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  let text = inputEl.value.trim();
  if (!text && attachedImage) text = 'What is in this image?';
  if (!text) return;
  sendMessage(text);
});

// Quick question chips
document.querySelectorAll('.qchip').forEach((chip) => {
  chip.addEventListener('click', () => sendMessage(chip.dataset.q));
});

/* ============ Sidebar / topbar ============ */

document.getElementById('newChatBtn').addEventListener('click', () => {
  newConversation();
  document.getElementById('sidebar').classList.remove('open');
});

document.getElementById('menuBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('sidebarSettingsBtn').addEventListener('click', openSettings);
document.getElementById('topSettingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
document.getElementById('providerSelect').addEventListener('change', updateProviderHints);

document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettings();
});

// Escape closes the settings modal (and the mobile sidebar)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('settingsModal');
  if (modal.classList.contains('open')) { closeSettings(); return; }
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 720 && sidebar.classList.contains('open')) sidebar.classList.remove('open');
});

// Close sidebar on outside click (mobile)
document.addEventListener('click', (e) => {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 720 && sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) && !document.getElementById('menuBtn').contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

/* ============ Image handling ============ */

const imageInput = document.getElementById('imageInput');
const attachBtn = document.getElementById('attachBtn');
const imagePreview = document.getElementById('imagePreview');
let attachedImage = null; // { dataUrl, mimeType }

attachBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Please select an image file', true);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('Image too large (max 20 MB)', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    attachedImage = { dataUrl: reader.result, mimeType: file.type };
    showImagePreview();
    inputEl.focus();
  };
  reader.readAsDataURL(file);
});

function showImagePreview() {
  imagePreview.innerHTML = `
    <img src="${attachedImage.dataUrl}" alt="Attached image" />
    <button type="button" id="removeImageBtn" title="Remove image">✕</button>
  `;
  imagePreview.hidden = false;
  document.getElementById('removeImageBtn').addEventListener('click', clearImage);
}

function clearImage() {
  attachedImage = null;
  imageInput.value = '';
  imagePreview.innerHTML = '';
  imagePreview.hidden = true;
}

function imageToProviderFormat() {
  if (!attachedImage) return null;
  if (config.provider === 'anthropic') {
    // Anthropic: base64 without data: prefix
    const base64 = attachedImage.dataUrl.split(',')[1];
    return { type: 'image', source: { type: 'base64', media_type: attachedImage.mimeType, data: base64 } };
  }
  // OpenAI: data URL or base64
  return { type: 'image_url', image_url: { url: attachedImage.dataUrl } };
}

/* ============ Init ============ */

renderConversations();
if (convos.length) {
  currentId = convos[0].id;
  renderMessages();
}
populateModels();
if (!config.apiKey) openSettings();
inputEl.focus();

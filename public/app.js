// ─────────────────────────────────────────────────────────────
//  app.js  —  MarkCloud Frontend
//  Handles: routing, Supabase Realtime (Broadcast + Presence),
//           debounced saves, tab management, toolbar, preview
// ─────────────────────────────────────────────────────────────

// ── Config ────────────────────────────────────────────────────
//  These values are injected at runtime from window.__env
//  (set by server.js) or fall back to placeholders so the
//  UI still loads when env vars are missing.
const SUPABASE_URL      = window.__env?.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = window.__env?.SUPABASE_ANON_KEY || '';

// ── Supabase client (anon key — safe on frontend) ─────────────
let sb = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ── State ─────────────────────────────────────────────────────
let roomId        = null;
let activeFileId  = null;
let files         = [];       // [{ id, name, updated_at }]
let broadcastCh   = null;     // Supabase Broadcast channel
let presenceCh    = null;     // Supabase Presence channel
let saveTimer     = null;     // debounce handle
let isBroadcasting = false;   // guard: skip local re-render from own broadcast
const SAVE_DELAY  = 1000;     // ms to wait before persisting to DB

// ── DOM refs ──────────────────────────────────────────────────
const $landing       = document.getElementById('landing');
const $app           = document.getElementById('app');
const $loading       = document.getElementById('loading-overlay');
const $btnStart      = document.getElementById('btn-start');
const $roomBadge     = document.getElementById('room-id-badge');
const $tabbar        = document.getElementById('tabbar');
const $btnNewFile    = document.getElementById('btn-new-file');
const $textarea      = document.getElementById('markdown-input');
const $preview       = document.getElementById('preview-content');
const $saveStatus    = document.getElementById('save-status');
const $presenceCount = document.getElementById('presence-count');
const $modalOverlay  = document.getElementById('modal-overlay');
const $modalInput    = document.getElementById('modal-input');
const $modalCancel   = document.getElementById('modal-cancel');
const $modalConfirm  = document.getElementById('modal-confirm');
const $toast         = document.getElementById('toast');
const $editorPane    = document.getElementById('editor-pane');
const $previewPane   = document.getElementById('preview-pane');

// ── Helpers ───────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  setTimeout(() => $toast.classList.remove('show'), duration);
}

function setSaveStatus(state, msg) {
  $saveStatus.className = '';
  $saveStatus.classList.add(state);
  $saveStatus.textContent = msg;
}

function hideLoading() {
  $loading.classList.add('hidden');
  setTimeout(() => { $loading.style.display = 'none'; }, 350);
}

function renderMarkdown(text) {
  $preview.innerHTML = marked.parse(text || '');
}

// ── Landing → create room ─────────────────────────────────────
$btnStart.addEventListener('click', async () => {
  $btnStart.disabled = true;
  $btnStart.textContent = 'Creating…';
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    const { roomId: id } = await res.json();
    window.location.href = `/${id}`;
  } catch (err) {
    console.error(err);
    showToast('Failed to create room. Is the server running?');
    $btnStart.disabled = false;
    $btnStart.textContent = 'Start New Conference';
  }
});

// ── Route: detect room ID from URL ───────────────────────────
async function init() {
  const path = window.location.pathname;
  const match = path.match(/^\/([0-9a-f-]{36})\/?$/i);

  if (!match) {
    // Home page
    hideLoading();
    $landing.style.display = 'flex';
    return;
  }

  roomId = match[1];
  await loadRoom();
}

// ── Load room ─────────────────────────────────────────────────
async function loadRoom() {
  try {
    const res = await fetch(`/api/rooms/${roomId}/files`);
    if (!res.ok) {
      showToast('Room not found.');
      setTimeout(() => { window.location.href = '/'; }, 1500);
      return;
    }
    const data = await res.json();
    files = data.files;

    // Show editor
    $landing.style.display = 'none';
    $app.style.display = 'flex';

    // Room badge
    $roomBadge.textContent = `Room: ${roomId.slice(0,8)}…`;

    // Render tabs
    renderTabs();

    // Open first file
    await switchFile(files[0].id);

    // Connect realtime
    setupRealtime();

    hideLoading();
  } catch (err) {
    console.error(err);
    showToast('Error loading room.');
    hideLoading();
  }
}

// ── Tabs ──────────────────────────────────────────────────────
function renderTabs() {
  // Remove existing tabs (not the "New File" button)
  document.querySelectorAll('.tab').forEach(el => el.remove());

  files.forEach(file => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (file.id === activeFileId ? ' active' : '');
    tab.dataset.fileId = file.id;
    tab.innerHTML = `<span>${file.name}</span><span class="tab-close" data-file-id="${file.id}">✕</span>`;
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      switchFile(file.id);
    });
    tab.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFile(file.id);
    });
    $tabbar.insertBefore(tab, $btnNewFile);
  });
}

// ── Switch file ───────────────────────────────────────────────
async function switchFile(fileId) {
  // Unsubscribe old broadcast channel
  if (broadcastCh) {
    broadcastCh.unsubscribe();
    broadcastCh = null;
  }

  activeFileId = fileId;

  // Update tab highlight
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.fileId === fileId);
  });

  // Fetch content
  try {
    const res = await fetch(`/api/files/${fileId}`);
    const { file } = await res.json();
    $textarea.value = file.content;
    renderMarkdown(file.content);
    setSaveStatus('saved', 'All saved');
  } catch (err) {
    console.error(err);
  }

  // Subscribe new broadcast channel for this file
  subscribeToFile(fileId);
}

// ── Supabase Realtime: Broadcast (typing sync) ────────────────
function subscribeToFile(fileId) {
  if (!supabase) return;

  const channelName = `room:${roomId}:file:${fileId}`;

  broadcastCh = supabase.channel(channelName, {
    config: { broadcast: { self: false } }  // don't echo own messages
  });

  broadcastCh.on('broadcast', { event: 'content-update' }, ({ payload }) => {
    // Another user typed — update editor + preview without triggering our own save
    isBroadcasting = true;
    const cursorPos = $textarea.selectionStart;
    $textarea.value = payload.content;
    $textarea.setSelectionRange(cursorPos, cursorPos);
    renderMarkdown(payload.content);
    isBroadcasting = false;
  });

  broadcastCh.subscribe();
}

// ── Supabase Realtime: Presence (online count) ────────────────
function setupRealtime() {
  if (!supabase) {
    $presenceCount.textContent = '1 online';
    return;
  }

  const presenceKey = crypto.randomUUID();

  presenceCh = supabase.channel(`presence:${roomId}`, {
    config: { presence: { key: presenceKey } }
  });

  presenceCh.on('presence', { event: 'sync' }, () => {
    const state = presenceCh.presenceState();
    const count = Object.keys(state).length;
    $presenceCount.textContent = `${count} online`;
  });

  presenceCh.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceCh.track({ online_at: new Date().toISOString() });
    }
  });
}

// ── Textarea input handler ────────────────────────────────────
$textarea.addEventListener('input', () => {
  const content = $textarea.value;

  // 1. Live preview (instant)
  renderMarkdown(content);

  // 2. Broadcast to other users (instant, no DB write)
  if (!isBroadcasting && broadcastCh && supabase) {
    broadcastCh.send({
      type: 'broadcast',
      event: 'content-update',
      payload: { content }
    });
  }

  // 3. Debounced DB save (1000ms after last keystroke)
  clearTimeout(saveTimer);
  setSaveStatus('saving', 'Saving…');
  saveTimer = setTimeout(() => persistContent(content), SAVE_DELAY);
});

// ── Persist to DB (debounced) ─────────────────────────────────
async function persistContent(content) {
  if (!activeFileId) return;
  try {
    const res = await fetch(`/api/files/${activeFileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error(await res.text());
    setSaveStatus('saved', `Saved ${formatTime()}`);
  } catch (err) {
    console.error(err);
    setSaveStatus('error', 'Save failed');
  }
}

function formatTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── New file modal ────────────────────────────────────────────
$btnNewFile.addEventListener('click', () => {
  $modalInput.value = '';
  $modalOverlay.classList.add('visible');
  setTimeout(() => $modalInput.focus(), 50);
});

$modalCancel.addEventListener('click', () => {
  $modalOverlay.classList.remove('visible');
});

$modalOverlay.addEventListener('click', (e) => {
  if (e.target === $modalOverlay) $modalOverlay.classList.remove('visible');
});

$modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $modalConfirm.click();
  if (e.key === 'Escape') $modalCancel.click();
});

$modalConfirm.addEventListener('click', async () => {
  const name = $modalInput.value.trim();
  if (!name) { $modalInput.focus(); return; }

  $modalConfirm.disabled = true;
  $modalConfirm.textContent = 'Creating…';

  try {
    const res = await fetch(`/api/rooms/${roomId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(await res.text());
    const { file } = await res.json();
    files.push({ id: file.id, name: file.name, updated_at: file.updated_at });
    renderTabs();
    await switchFile(file.id);
    $modalOverlay.classList.remove('visible');
  } catch (err) {
    console.error(err);
    showToast('Failed to create file.');
  } finally {
    $modalConfirm.disabled = false;
    $modalConfirm.textContent = 'Create';
  }
});

// ── Delete file ───────────────────────────────────────────────
async function deleteFile(fileId) {
  if (files.length <= 1) {
    showToast('Cannot delete the last file.');
    return;
  }

  if (!confirm('Delete this file? This cannot be undone.')) return;

  try {
    const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    files = files.filter(f => f.id !== fileId);
    renderTabs();
    // Switch to first remaining file
    if (activeFileId === fileId) {
      await switchFile(files[0].id);
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to delete file.');
  }
}

// ── Toolbar actions ───────────────────────────────────────────
document.querySelectorAll('.toolbar-btn[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    insertMarkdown(action);
  });
});

function insertMarkdown(action) {
  const ta    = $textarea;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.substring(start, end);

  const MAP = {
    bold:    { wrap: ['**', '**'],       placeholder: 'bold text' },
    italic:  { wrap: ['_', '_'],         placeholder: 'italic text' },
    code:    { wrap: ['`', '`'],         placeholder: 'code' },
    heading: { wrap: ['# ', ''],         placeholder: 'Heading', prefix: true },
    ul:      { wrap: ['- ', ''],         placeholder: 'List item', prefix: true },
    link:    { wrap: ['[', '](url)'],    placeholder: 'link text' },
    hr:      { wrap: ['\n\n---\n\n', ''], placeholder: '', prefix: true },
  };

  const def = MAP[action];
  if (!def) return;

  let newText;
  const [before, after] = def.wrap;
  const content = sel || def.placeholder;

  if (def.prefix) {
    newText = before + content;
  } else {
    newText = before + content + after;
  }

  const newVal = ta.value.substring(0, start) + newText + ta.value.substring(end);
  ta.value = newVal;

  // Position cursor
  const newCursor = start + newText.length;
  ta.setSelectionRange(newCursor, newCursor);
  ta.focus();

  // Trigger input event to sync + save
  ta.dispatchEvent(new Event('input'));
}

// ── View toggle ───────────────────────────────────────────────
document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const view = btn.dataset.view;
    $editorPane.classList.remove('hidden', 'full');
    $previewPane.classList.remove('hidden', 'full');

    if (view === 'editor') {
      $previewPane.classList.add('hidden');
      $editorPane.classList.add('full');
    } else if (view === 'preview') {
      $editorPane.classList.add('hidden');
      $previewPane.classList.add('full');
    }
    // 'split' — both visible (default)
  });
});

// ── Room badge: copy URL ──────────────────────────────────────
$roomBadge.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    showToast('Room URL copied to clipboard!');
  });
});

// ── Export .md ────────────────────────────────────────────────
document.getElementById('btn-download').addEventListener('click', () => {
  const content  = $textarea.value;
  const filename = files.find(f => f.id === activeFileId)?.name || 'export.md';
  const blob     = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${filename}`);
});

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    clearTimeout(saveTimer);
    persistContent($textarea.value);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    insertMarkdown('bold');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault();
    insertMarkdown('italic');
  }
});

// ── Bootstrap: fetch env vars then start ─────────────────────
(async () => {
  try {
    const res = await fetch('/api/env');
    window.__env = await res.json();
    if (window.__env.SUPABASE_URL && window.__env.SUPABASE_ANON_KEY) {
      supabase = window.supabase.createClient(
        window.__env.SUPABASE_URL,
        window.__env.SUPABASE_ANON_KEY
      );
    }
  } catch (_) { /* realtime disabled gracefully if env unavailable */ }
  init();
})();

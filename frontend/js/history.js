// ── history.js ────────────────────────────────────────────────────────────────
// Session history: save, load, render, and manage past chat sessions.
// Backed by Firebase Firestore — scoped to device ID.

import { state }         from './state.js';
import { showToast }     from './ui.js';
import { PERSONA_NAMES } from './prompts.js';
import {
  saveSessionToFirestore,
  loadSessionsFromFirestore,
  deleteSessionFromFirestore,
  updateSessionFields,
} from './firebase.js';
import { attachExportBtn } from './export.js';

import { API_BASE as BACKEND } from './config.js';

// ── Sidebar-local toast ───────────────────────────────────────────────────────
// Shows a small toast anchored above the session history panel.

let _sidebarToastTimer = null;

function showSidebarToast(msg, type) {
  const t = document.getElementById('chSidebarToast');
  if (!t) return showToast(msg); // fallback to global toast

  if (!type) {
    const lower = msg.toLowerCase();
    type = /error|failed/.test(lower) ? 'error' : /saved|restored|renamed|pinned|deleted/.test(lower) ? 'success' : 'info';
  }

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };

  t.innerHTML = `<span>${msg}</span>`;
  t.className = `ch-sidebar-toast st-${type} show`;

  clearTimeout(_sidebarToastTimer);
  _sidebarToastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Save current session ──────────────────────────────────────────────────────

export async function saveCurrentSession() {
  if (!state.conversationHistory) return;
  // Require at least one real user turn before saving
  const hasUserTurn = state.conversationHistory.some(m => m.role === 'user');
  if (!hasUserTurn) return;

  const firstUser = state.conversationHistory.find(m => m.role === 'user');
  const rawTitle  = firstUser?.content || 'Session';
  const title     = rawTitle.length > 60 ? rawTitle.slice(0, 60) + '…' : rawTitle;

  // Lock subject on first save — but only once we have a real subject (not the default 'Other')
  const detectedSubject = state.currentSubject;
  if (!state.sessionSubject && detectedSubject && detectedSubject !== 'Other') {
    state.sessionSubject = detectedSubject;
  }

  const sessionData = {
    title,
    subject:      state.sessionSubject || state.currentSubject || 'Other',
    ts:           new Date().toISOString(),
    history:      JSON.parse(JSON.stringify(state.conversationHistory)),
    messagesHtml: (document.getElementById('messages')?.innerHTML || '').replace(/\bspeaking\b/g, ''),
  };

  const id = await saveSessionToFirestore(sessionData, state.currentSessionId || null);

  if (id) {
    state.currentSessionId = id;
    showSidebarToast('Chat saved');
    renderHistory();
  } else {
    showSidebarToast('Save failed — check connection');
  }
}

// ── Auto-save (silent) ────────────────────────────────────────────────────────

export async function autoSaveSession() {
  if (!state.conversationHistory) return;
  // Require at least one real user turn before saving
  const hasUserTurn = state.conversationHistory.some(m => m.role === 'user');
  if (!hasUserTurn) return;

  const session = _cachedSessions.find(s => s.id === state.currentSessionId);
  // Preserve custom title and pinned state if they exist
  const firstUser  = state.conversationHistory.find(m => m.role === 'user');
  const autoTitle  = (firstUser?.content || 'Session').slice(0, 60) + (firstUser?.content?.length > 60 ? '…' : '');
  const title      = session?.customTitle || autoTitle;

  // Lock subject on first save — but only once we have a real subject (not the default 'Other')
  const detectedSubject = state.currentSubject;
  if (!state.sessionSubject && detectedSubject && detectedSubject !== 'Other') {
    state.sessionSubject = detectedSubject;
  }

  const sessionData = {
    title,
    subject:      state.sessionSubject || state.currentSubject || 'Other',
    ts:           new Date().toISOString(),
    history:      JSON.parse(JSON.stringify(state.conversationHistory)),
    messagesHtml: (document.getElementById('messages')?.innerHTML || '').replace(/\bspeaking\b/g, ''),
    pinned:       session?.pinned || false,
    customTitle:  session?.customTitle || null,
  };

  const id = await saveSessionToFirestore(sessionData, state.currentSessionId || null);
  if (id && !state.currentSessionId) {
    state.currentSessionId = id;
  }
  // Update cache
  if (id) {
    const idx = _cachedSessions.findIndex(s => s.id === id);
    if (idx !== -1) {
      _cachedSessions[idx] = { ..._cachedSessions[idx], ...sessionData, id };
    }
  }
}

// ── Restore a session ─────────────────────────────────────────────────────────

async function restoreSession(id) {
  const session = _cachedSessions.find(s => s.id === id);
  if (!session) return;

  state.conversationHistory = JSON.parse(JSON.stringify(session.history));
  state.currentSubject      = session.subject;
  state.sessionSubject      = session.subject; // lock to original subject
  state.lastComplexity      = null;
  state.currentSessionId    = id;

  const msgEl = document.getElementById('messages');
  if (msgEl && session.messagesHtml) {
    msgEl.innerHTML = session.messagesHtml.replace(/\bspeaking\b/g, '');
    msgEl.querySelectorAll('pre code:not(.hljs)').forEach(c => {
      try { hljs.highlightElement(c); } catch (_) {}
    });
    if (window.renderMathInElement) {
      try {
        renderMathInElement(msgEl, {
          delimiters: [
            { left: '$$', right: '$$', display: true  },
            { left: '$',  right: '$',  display: false },
          ],
          throwOnError: false,
        });
      } catch (_) {}
    }
    msgEl.scrollTop = msgEl.scrollHeight;

    // Re-attach copy button listeners (addEventListener is lost when HTML is serialized)
    msgEl.querySelectorAll('.copy-btn').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.replaceWith(fresh);
      fresh.addEventListener('click', () => {
        const bubble = fresh.closest('.msg')?.querySelector('.msg-bubble');
        const text   = bubble?.innerText || bubble?.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          fresh.textContent = 'Copied ✓';
          fresh.classList.add('copied');
          setTimeout(() => { fresh.textContent = 'Copy'; fresh.classList.remove('copied'); }, 2000);
        }).catch(() => {});
      });
    });

    // Re-attach export button listeners (use different var name to avoid shadowing msgEl)
    msgEl.querySelectorAll('.msg.ai').forEach(aiMsg => {
      const existingWrap = aiMsg.querySelector('.export-wrap');
      const existingSep  = aiMsg.querySelector('.btn-sep');
      if (existingWrap) existingWrap.remove();
      if (existingSep)  existingSep.remove();
      attachExportBtn(aiMsg);
    });
  }

  import('./subject.js').then(m => m.updateSubjectBadge(session.subject));
  showSidebarToast('Chat restored');
  renderHistory(); // refresh to show active state
}

// ── Delete a session ──────────────────────────────────────────────────────────

async function deleteSession(id) {
  await deleteSessionFromFirestore(id);
  if (state.currentSessionId === id) state.currentSessionId = null;
  _cachedSessions = _cachedSessions.filter(s => s.id !== id);
  renderHistory();
  showSidebarToast('Chat deleted');
}

// ── Pin / unpin ───────────────────────────────────────────────────────────────

async function togglePin(id) {
  const session = _cachedSessions.find(s => s.id === id);
  if (!session) return;
  const pinned = !session.pinned;
  const ok = await updateSessionFields(id, { pinned });
  if (ok) {
    session.pinned = pinned;
    // Update item in-place — no re-render, no jump
    const item = document.querySelector(`.ch-item[data-id="${id}"]`);
    if (item) {
      item.classList.toggle('ch-item-pinned', pinned);
      const titleEl = item.querySelector('.ch-title');
      if (titleEl) {
        // Remove existing pin badge if any
        titleEl.querySelector('.ch-pin-badge')?.remove();
        if (pinned) {
          const badge = document.createElement('span');
          badge.className = 'ch-pin-badge';
          badge.title = 'Pinned';
          badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="9" height="9"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14"/><path d="M15 3a2 2 0 0 1 2 2v3l2 2v1H5v-1l2-2V5a2 2 0 0 1 2-2h6z"/></svg>`;
          titleEl.prepend(badge);
        }
      }
    }
    showSidebarToast(pinned ? 'Chat pinned' : 'Chat unpinned');
  }
}

// ── Rename ────────────────────────────────────────────────────────────────────

function startRename(id) {
  closeContextMenu();
  const session = _cachedSessions.find(s => s.id === id);
  if (!session) return;

  const titleEl = document.querySelector(`.ch-item[data-id="${id}"] .ch-title`);
  if (!titleEl) return;

  const current = session.customTitle || session.title || '';
  const input = document.createElement('input');
  input.className   = 'ch-rename-input';
  input.value       = current;
  input.maxLength   = 80;
  input.placeholder = 'Session title…';

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim() || current;
    // Restore title element immediately — no flash
    const newTitleEl = document.createElement('span');
    newTitleEl.className = 'ch-title';
    if (session.pinned) {
      const badge = document.createElement('span');
      badge.className = 'ch-pin-badge';
      badge.title = 'Pinned';
      badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="9" height="9"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14"/><path d="M15 3a2 2 0 0 1 2 2v3l2 2v1H5v-1l2-2V5a2 2 0 0 1 2-2h6z"/></svg>`;
      newTitleEl.append(badge);
    }
    newTitleEl.append(document.createTextNode(newTitle));
    input.replaceWith(newTitleEl);
    const ok = await updateSessionFields(id, { title: newTitle, customTitle: newTitle });
    if (ok) {
      session.title       = newTitle;
      session.customTitle = newTitle;
      showSidebarToast('Chat renamed');
    }
  };

  input.addEventListener('blur',  commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

// ── Summarize title via Gemini ────────────────────────────────────────────────

async function summarizeTitle(id) {
  closeContextMenu();
  const session = _cachedSessions.find(s => s.id === id);
  if (!session || !session.history?.length) return;

  const titleEl = document.querySelector(`.ch-item[data-id="${id}"] .ch-title`);
  if (titleEl) titleEl.textContent = '✨ Summarizing…';

  try {
    const messages = session.history
      .slice(0, 6)
      .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
      .join('\n');

    const res = await fetch(`${BACKEND}/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Based on this tutoring conversation, write a SHORT title (4-6 words max) that captures the main topic. Return ONLY the title, no punctuation, no quotes.\n\n${messages}`,
        history: [],
        subject: session.subject || 'Other',
      }),
    });

    if (!res.ok) throw new Error('Server error');

    // Read the SSE stream and grab text chunks
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    let   title   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.text) title += ev.text;
        } catch (_) {}
      }
    }

    title = title.trim().replace(/^["']|["']$/g, '').slice(0, 60);
    if (!title) throw new Error('Empty response');

    const ok = await updateSessionFields(id, { title, customTitle: title });
    if (ok) {
      session.title       = title;
      session.customTitle = title;
      showSidebarToast('Chat renamed');
    }
  } catch (e) {
    showSidebarToast('Summarize failed — try again');
  }

  renderHistory();
}

// ── Context menu ──────────────────────────────────────────────────────────────

let _activeMenu = null;

let _menuJustOpened = false;

function openContextMenu(id, anchorEl) {
  // If this menu is already open for this id, close it (toggle)
  if (_activeMenu && _activeMenu.dataset.id === id) {
    closeContextMenu();
    return;
  }
  closeContextMenu();

  const session = _cachedSessions.find(s => s.id === id);
  if (!session) return;

  // Mark the anchor button as active so it stays visible
  anchorEl.classList.add('active');

  const menu = document.createElement('div');
  menu.className  = 'ch-ctx-menu';
  menu.dataset.id = id;

  const items = [
    {
      icon: session.pinned
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14"/><path d="M15 3a2 2 0 0 1 2 2v3l2 2v1H5v-1l2-2V5a2 2 0 0 1 2-2h6z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14"/><path d="M15 3a2 2 0 0 1 2 2v3l2 2v1H5v-1l2-2V5a2 2 0 0 1 2-2h6z"/></svg>`,
      label:   session.pinned ? 'Unpin' : 'Pin',
      action:  () => togglePin(id),
      cls:     '',
    },
    {
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
      label:   'Rename',
      action:  () => startRename(id),
      cls:     '',
    },
    {
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
      label:   'Summarize chat',
      action:  () => {
        closeContextMenu();
        const session = _cachedSessions.find(s => s.id === id);
        if (session) window.openSummary(session);
      },
      cls:     '',
    },
    {
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16"/></svg>`,
      label:   'Create flashcards',
      action:  () => {
        closeContextMenu();
        const session = _cachedSessions.find(s => s.id === id);
        if (session) window.openFlashcards(session);
      },
      cls:     '',
    },
    {
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
      label:   'Delete',
      action:  () => deleteSession(id),
      cls:     'ch-ctx-danger',
    },
  ];

  // Build HTML with divider before delete
  menu.innerHTML = items.map((item, i) => `
    ${i === items.length - 1 ? '<div class="ch-ctx-divider"></div>' : ''}
    <button class="ch-ctx-item ${item.cls}" data-idx="${i}">
      <span class="ch-ctx-icon">${item.icon}</span>
      <span class="ch-ctx-label">${item.label}</span>
    </button>
  `).join('');

  document.body.appendChild(menu);

  // Position below the three-dot button, aligned to its right edge
  const rect  = anchorEl.getBoundingClientRect();
  const menuW = 188;
  let   left  = rect.right - menuW;
  let   top   = rect.bottom + 6;

  // Measure actual height after append
  const menuH = menu.offsetHeight || 165;
  if (top + menuH > window.innerHeight - 16) top = rect.top - menuH - 6;
  if (left < 8) left = 8;

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';

  // Wire up item clicks
  menu.querySelectorAll('.ch-ctx-item').forEach((btn, i) => {
    btn.addEventListener('mousedown', e => {
      // mousedown fires before blur — prevents menu closing before action runs
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeContextMenu();
      items[i].action();
    });
  });

  _activeMenu   = menu;
  _activeAnchor = anchorEl;

  // Flag so the document click listener ignores this same click
  _menuJustOpened = true;
  setTimeout(() => { _menuJustOpened = false; }, 0);

  // Animate in
  requestAnimationFrame(() => menu.classList.add('ch-ctx-open'));
}

let _activeAnchor = null;

function closeContextMenu() {
  if (!_activeMenu) return;
  _activeMenu.classList.remove('ch-ctx-open');
  if (_activeAnchor) { _activeAnchor.classList.remove('active'); _activeAnchor = null; }
  const m = _activeMenu;
  _activeMenu = null;
  setTimeout(() => m.remove(), 180);
}

// Close on outside click — but not the same click that opened it
document.addEventListener('click', e => {
  if (_menuJustOpened) return;
  if (_activeMenu && !_activeMenu.contains(e.target)) closeContextMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _activeMenu) closeContextMenu();
});

// ── Session cache ─────────────────────────────────────────────────────────────

let _cachedSessions = [];

export function getCachedSessions() { return _cachedSessions; }

export async function ensureSessionsLoaded() {
  if (_cachedSessions.length > 0) return _cachedSessions;
  _cachedSessions = await loadSessionsFromFirestore();
  _cachedSessions.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return  1;
    return 0;
  });
  return _cachedSessions;
}

// ── Render the history list ───────────────────────────────────────────────────

export async function renderHistory() {
  const container = document.getElementById('chatHistoryList');
  if (!container) return;

  container.innerHTML = `<div class="ch-empty"><span>Loading…</span></div>`;
  _cachedSessions = await loadSessionsFromFirestore();

  // Sort: pinned first, then by time
  _cachedSessions.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return  1;
    return 0; // already sorted by updatedAt from Firestore
  });

  if (_cachedSessions.length === 0) {
    container.innerHTML = `
      <div class="ch-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>No saved sessions yet</span>
      </div>`;
    return;
  }

  container.innerHTML = _cachedSessions.map(s => {
    const color    = SUBJECT_COLORS[s.subject] || SUBJECT_COLORS.Other;
    const label    = s.subject === 'ComputerScience' ? 'CS' : (s.subject || 'Other');
    const msgCount = Math.floor((s.history?.length || 0) / 2);
    const isActive = s.id === state.currentSessionId;
    const pinIcon  = s.pinned
      ? `<span class="ch-pin-badge" title="Pinned">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="9" height="9"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14"/><path d="M15 3a2 2 0 0 1 2 2v3l2 2v1H5v-1l2-2V5a2 2 0 0 1 2-2h6z"/></svg>
         </span>`
      : '';
    return `
      <div class="ch-item${isActive ? ' ch-item-active' : ''}${s.pinned ? ' ch-item-pinned' : ''}" data-id="${s.id}">
        <div class="ch-item-body" onclick="window._chRestore('${s.id}')" title="Restore session">
          <span class="ch-dot" style="background:${color}"></span>
          <div class="ch-meta">
            <span class="ch-title">${pinIcon}${escHtml(s.title)}</span>
            <span class="ch-sub">${escHtml(label)} · ${msgCount} msg${msgCount !== 1 ? 's' : ''} · ${relativeTime(s.ts)}</span>
          </div>
        </div>
        <button class="ch-more-btn" onclick="window._chMenu('${s.id}', this)" title="More options" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <circle cx="12" cy="5"  r="1.5"/>
            <circle cx="12" cy="12" r="1.5"/>
            <circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>
      </div>`;
  }).join('');
}

// ── Time formatting ───────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60000);
  const h    = Math.floor(m / 60);
  const d    = Math.floor(h / 24);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Subject color map ─────────────────────────────────────────────────────────

const SUBJECT_COLORS = {
  Math:            '#818cf8',
  Physics:         '#60a5fa',
  Chemistry:       '#34d399',
  Biology:         '#a3e635',
  ComputerScience: '#fbbf24',
  History:         '#f87171',
  Literature:      '#ec4899',
  Economics:       '#8b5cf6',
  Other:           '#6b7280',
};

function escHtml(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toggle collapse ───────────────────────────────────────────────────────────

export function toggleHistory() {
  const panel  = document.getElementById('chatHistoryPanel');
  const btn    = document.getElementById('chToggleBtn');
  const isOpen = panel.classList.toggle('ch-open');
  btn.setAttribute('aria-expanded', isOpen);
  if (isOpen) renderHistory();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initHistory() {
  window._chRestore = restoreSession;
  window._chDelete  = deleteSession;
  window._chMenu    = openContextMenu;
}
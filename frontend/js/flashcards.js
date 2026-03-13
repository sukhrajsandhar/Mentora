// ── flashcards.js ─────────────────────────────────────────────────────────────
// Flashcard generator — session picker then floating card viewer.
// ─────────────────────────────────────────────────────────────────────────────

import { API_BASE } from './config.js';
import { state } from './state.js';
import { getCachedSessions, ensureSessionsLoaded } from './history.js';

// ── Internal state ────────────────────────────────────────────────────────────

const fc = {
  cards:             [],
  index:             0,
  flipped:           false,
  title:             '',
  selectedSessionId: 'active',
};

// ── Subject colours ───────────────────────────────────────────────────────────

const FC_SUBJECT_COLORS = {
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

function fcRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fcEsc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Position / drag ───────────────────────────────────────────────────────────

function fcPositionWindow(win) {
  if (window.innerWidth <= 600) { win.style.left = win.style.top = win.style.width = ''; return; }
  const w = 480;
  win.style.width = w + 'px';
  win.style.left  = Math.max(0, (window.innerWidth  - w) / 2) + 'px';
  win.style.top   = Math.max(16, (window.innerHeight - 520) / 2 - 40) + 'px';
}

window.addEventListener('resize', () => {
  const win = document.getElementById('fcWindow');
  if (!win || win.hidden) return;
  fcPositionWindow(win);
});

(function initFcDraggable() {
  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const win    = document.getElementById('fcWindow');
    const handle = win?.querySelector('.fc-header');
    if (!win || !handle) return;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      if (window.innerWidth <= 600 || e.target.closest('button')) return;
      dragging = true; startX = e.clientX; startY = e.clientY;
      origLeft = win.offsetLeft; origTop = win.offsetTop;
      handle.style.cursor = 'grabbing'; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      win.style.left = Math.max(0, Math.min(window.innerWidth  - win.offsetWidth,  origLeft + e.clientX - startX)) + 'px';
      win.style.top  = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, origTop  + e.clientY - startY)) + 'px';
    });
    document.addEventListener('mouseup', () => { if (dragging) { dragging = false; handle.style.cursor = 'grab'; } });
  });
})();

// ── Open ──────────────────────────────────────────────────────────────────────

window.openFlashcards = async function(session) {
  const win     = document.getElementById('fcWindow');
  const overlay = document.getElementById('fcOverlay');
  if (!win) return;

  fc.cards = []; fc.index = 0; fc.flipped = false;
  fc.selectedSessionId = (session && session.id) ? session.id : 'active';

  fcPositionWindow(win);
  win.hidden = false; overlay.hidden = false;
  document.body.classList.add('pt-open');

  fcShowPickerView();
  await fcRenderPicker();
};

window.closeFlashcards = function() {
  document.getElementById('fcWindow').hidden     = true;
  document.getElementById('fcOverlay').hidden    = true;
  document.body.classList.remove('pt-open');
};

// ── Picker ────────────────────────────────────────────────────────────────────

async function fcRenderPicker() {
  const listEl = document.getElementById('fcPickerList');
  if (!listEl) return;

  const hasActive = state.conversationHistory.length > 0;
  const saved     = await ensureSessionsLoaded();

  if (!hasActive && !saved.length) {
    listEl.innerHTML = `<span class="pt-session-empty">No sessions yet — start a tutoring session first.</span>`;
    return;
  }

  if (fc.selectedSessionId !== 'active' && !saved.some(s => s.id === fc.selectedSessionId)) {
    fc.selectedSessionId = hasActive ? 'active' : (saved[0]?.id || 'active');
  }
  if (fc.selectedSessionId === 'active' && !hasActive && saved.length > 0) {
    fc.selectedSessionId = saved[0].id;
  }

  const rows = [];

  if (hasActive) {
    const subject = (state.currentSubject && state.currentSubject !== 'Other') ? state.currentSubject : 'Other';
    const turns   = Math.ceil(state.conversationHistory.length / 2);
    const color   = FC_SUBJECT_COLORS[subject] || FC_SUBJECT_COLORS.Other;
    const sel     = fc.selectedSessionId === 'active';
    rows.push(`<div class="pt-sess-row${sel ? ' pt-sess-selected' : ''}" onclick="window._fcSelectSession('active')">
      <span class="pt-sess-dot" style="background:${color}"></span>
      <div class="pt-sess-meta">
        <span class="pt-sess-title"><span class="pt-sess-live-badge">Live</span> Current session</span>
        <span class="pt-sess-sub">${subject === 'Other' ? 'General' : subject} · ${turns} exchange${turns !== 1 ? 's' : ''}</span>
      </div>${sel ? '<span class="pt-sess-check">✓</span>' : ''}</div>`);
  }

  saved.forEach(s => {
    const label = s.subject === 'ComputerScience' ? 'CS' : (s.subject || 'Other');
    const color = FC_SUBJECT_COLORS[s.subject] || FC_SUBJECT_COLORS.Other;
    const msgs  = Math.floor((s.history?.length || 0) / 2);
    const sel   = fc.selectedSessionId === s.id;
    rows.push(`<div class="pt-sess-row${sel ? ' pt-sess-selected' : ''}" onclick="window._fcSelectSession('${fcEsc(s.id)}')">
      <span class="pt-sess-dot" style="background:${color}"></span>
      <div class="pt-sess-meta">
        <span class="pt-sess-title">${fcEsc(s.title || 'Untitled')}</span>
        <span class="pt-sess-sub">${fcEsc(label)} · ${msgs} msg${msgs !== 1 ? 's' : ''} · ${fcRelativeTime(s.ts)}</span>
      </div>${sel ? '<span class="pt-sess-check">✓</span>' : ''}</div>`);
  });

  listEl.innerHTML = rows.join('');
}

window._fcSelectSession = function(id) {
  fc.selectedSessionId = id;
  fcRenderPicker();
};

window.fcGenerate = async function() {
  const isActive = fc.selectedSessionId === 'active';
  let history, subject, displayTitle;

  if (isActive) {
    history      = state.conversationHistory;
    subject      = state.currentSubject || 'Other';
    displayTitle = 'Current Session';
  } else {
    const sess = getCachedSessions().find(s => s.id === fc.selectedSessionId);
    if (!sess) { fcShowError('Session not found.'); return; }
    history      = sess.history || [];
    subject      = sess.subject || 'Other';
    displayTitle = sess.customTitle || sess.title || 'Chat Session';
  }

  const switchPattern = /^Sure,\s+switching to .+? now[!.]?$/i;
  const cleanHistory  = history
    .filter(m => !switchPattern.test(m.content?.trim()) && m.type !== 'subject_switch')
    .slice(-40);

  if (!cleanHistory.length) { fcShowError('No session content to generate flashcards from.'); return; }

  fcShowLoadingView();

  try {
    const res  = await fetch(`${API_BASE}/flashcards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionHistory: cleanHistory, subject, title: displayTitle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);

    fc.cards = data.cards || [];
    fc.title = data.title || `Flashcards — ${displayTitle}`;

    if (!fc.cards.length) { fcShowError('No flashcards could be generated for this session.'); return; }

    fc.index = 0; fc.flipped = false;
    fcRenderCard(); fcUpdateCounter(); fcShowCardsView();
  } catch (e) {
    fcShowError(e.message);
  }
};

// ── Card navigation ───────────────────────────────────────────────────────────

window.fcFlip = function() {
  fc.flipped = !fc.flipped;
  document.getElementById('fcCardInner')?.classList.toggle('flipped', fc.flipped);
};

window.fcPrev = function() {
  if (!fc.cards.length) return;
  fc.index = (fc.index - 1 + fc.cards.length) % fc.cards.length;
  fc.flipped = false; fcRenderCard(); fcUpdateCounter();
};

window.fcNext = function() {
  if (!fc.cards.length) return;
  fc.index = (fc.index + 1) % fc.cards.length;
  fc.flipped = false; fcRenderCard(); fcUpdateCounter();
};

window.fcShuffle = function() {
  if (fc.cards.length < 2) return;
  for (let i = fc.cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fc.cards[i], fc.cards[j]] = [fc.cards[j], fc.cards[i]];
  }
  fc.index = 0; fc.flipped = false; fcRenderCard(); fcUpdateCounter();
};

document.addEventListener('keydown', e => {
  const win = document.getElementById('fcWindow');
  if (!win || win.hidden) return;
  if (document.getElementById('fcPickerView')?.style.display !== 'none') return;
  if (e.key === 'ArrowRight') fcNext();
  if (e.key === 'ArrowLeft')  fcPrev();
  if (e.key === ' ')          { e.preventDefault(); fcFlip(); }
});

// ── Render ────────────────────────────────────────────────────────────────────

function fcRenderCard() {
  const card  = fc.cards[fc.index];
  if (!card) return;
  const inner = document.getElementById('fcCardInner');
  const front = document.getElementById('fcFront');
  const back  = document.getElementById('fcBack');
  if (!inner || !front || !back) return;
  inner.classList.remove('flipped');
  front.textContent = card.front;
  back.innerHTML    = fcRenderText(card.back);
  if (window.renderMathInElement) {
    renderMathInElement(back, {
      delimiters: [{ left:'$$', right:'$$', display:true }, { left:'$', right:'$', display:false }],
      throwOnError: false,
    });
  }
}

function fcRenderText(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

function fcUpdateCounter() {
  const el = document.getElementById('fcCounter');
  if (el) el.textContent = fc.cards.length ? `${fc.index + 1} / ${fc.cards.length}` : '';
}

// ── View switching ────────────────────────────────────────────────────────────

function fcShowPickerView() {
  document.getElementById('fcPickerView').style.display  = 'flex';
  document.getElementById('fcLoadingView').style.display = 'none';
  document.getElementById('fcCardsView').style.display   = 'none';
  document.getElementById('fcTitle').textContent = 'Create Flashcards';
}

function fcShowLoadingView() {
  document.getElementById('fcPickerView').style.display  = 'none';
  document.getElementById('fcLoadingView').style.display = 'flex';
  document.getElementById('fcCardsView').style.display   = 'none';
  document.getElementById('fcTitle').textContent = 'Generating flashcards…';
}

function fcShowCardsView() {
  document.getElementById('fcPickerView').style.display  = 'none';
  document.getElementById('fcLoadingView').style.display = 'none';
  document.getElementById('fcCardsView').style.display   = 'flex';
  document.getElementById('fcTitle').textContent = fc.title;
}

function fcShowError(msg) {
  fcShowPickerView();
  const listEl = document.getElementById('fcPickerList');
  if (listEl) listEl.innerHTML = `<span class="pt-session-empty" style="color:#f87171">${fcEsc(msg)}</span>`;
}

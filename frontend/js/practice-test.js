// ── practice-test.js ──────────────────────────────────────────────────────────
// All frontend logic for the Practice Test Generator window.
// Imported as a module by index.html — zero changes to any existing file.

import { state } from './state.js';
import { showToast } from './ui.js';
import { getCachedSessions, ensureSessionsLoaded } from './history.js';

import { API_BASE } from './config.js';
import { resolveSubject } from './subjectMap.js';
import { parseMarkdownWithMath } from './messages.js';

// ── Internal state ────────────────────────────────────────────────────────────

const pt = {
  activeTab:         'files',    // 'files' | 'text' | 'session'
  difficulty:        2,
  numQuestions:      5,
  files:             [],         // [{ name, mimeType, data }]  (base64)
  lastResult:        null,       // last generated markdown string
  lastTitle:         '',
  selectedSessionId: 'active',   // 'active' | <firestore session id>
};


// ── Open / close ──────────────────────────────────────────────────────────────

// Position the window — defers to CSS bottom-sheet on mobile (≤600px)
function ptPositionWindow(win) {
  if (window.innerWidth <= 600) {
    win.style.left  = '';
    win.style.top   = '';
    win.style.width = '';
    return;
  }
  const w = 520;
  win.style.width = w + 'px';
  win.style.left  = Math.max(0, (window.innerWidth  - w) / 2) + 'px';
  win.style.top   = Math.max(16, (window.innerHeight - Math.min(window.innerHeight * 0.82, 600)) / 2 - 40) + 'px';
}

// Re-centre on viewport resize (desktop only)
window.addEventListener('resize', () => {
  const win = document.getElementById('ptWindow');
  if (!win || win.hidden) return;
  ptPositionWindow(win);
});

// ── Draggable window ──────────────────────────────────────────────────────────

(function initPtDraggable() {
  const win    = document.getElementById('ptWindow');
  const handle = document.getElementById('ptHeader');
  if (!win || !handle) return;

  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  handle.style.cursor = 'grab';

  handle.addEventListener('mousedown', e => {
    if (window.innerWidth <= 600) return; // disabled on mobile
    if (e.target.closest('button')) return; // don't drag when clicking close btn
    dragging = true;
    startX   = e.clientX;
    startY   = e.clientY;
    origLeft = win.offsetLeft;
    origTop  = win.offsetTop;
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx  = e.clientX - startX;
    const dy  = e.clientY - startY;
    const maxX = window.innerWidth  - win.offsetWidth;
    const maxY = window.innerHeight - win.offsetHeight;
    win.style.left = Math.max(0, Math.min(maxX, origLeft + dx)) + 'px';
    win.style.top  = Math.max(0, Math.min(maxY, origTop  + dy)) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
  });
})();

window.openPracticeTest = async function () {
  const win     = document.getElementById('ptWindow');
  const overlay = document.getElementById('ptOverlay');

  ptPositionWindow(win);

  win.hidden = false;
  win.classList.add('pt-entering');
  overlay.classList.add('pt-visible');
  setTimeout(() => win.classList.remove('pt-entering'), 220);

  // Sync session tab state every time the window opens
  await ptRefreshSessionTab();
  // Pre-select difficulty from last known complexity
  if (state.lastComplexity) ptSetDifficulty(state.lastComplexity);
  // Pre-select subject from current session
  ptSyncSubjectSelect();
  // Validate generate button
  ptValidate();
};

window.closePracticeTest = function () {
  document.getElementById('ptWindow').hidden = true;
  document.getElementById('ptOverlay').classList.remove('pt-visible');
};




// ── Tab switching ─────────────────────────────────────────────────────────────

window.ptSwitchTab = async function (tab) {

  pt.activeTab = tab;

  // Update tab buttons
  document.querySelectorAll('.pt-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/hide panels
  const panels = {
    files:   document.getElementById('ptPanelFiles'),
    text:    document.getElementById('ptPanelText'),
    session: document.getElementById('ptPanelSession'),
  };
  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle('pt-panel-hidden', key !== tab);
  });

  if (tab === 'session') await ptRefreshSessionTab();
  ptValidate();
};


// ── Session tab ───────────────────────────────────────────────────────────────

const PT_SESSION_SUBJECT_COLORS = {
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

function ptRelativeTime(iso) {
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

async function ptRefreshSessionTab() {
  const tab  = document.getElementById('ptTabSession');
  const info = document.getElementById('ptSessionInfo');
  if (!tab || !info) return;

  // Never grey out the tab — always allow clicking it
  // Empty state is shown inside the panel instead
  tab.classList.remove('pt-tab-disabled');
  tab.dataset.tooltip = '';

  const hasActive  = state.conversationHistory.length > 0;
  const saved      = await ensureSessionsLoaded();
  const hasAnySess = hasActive || saved.length > 0;

  if (!hasAnySess) {
    info.innerHTML = `<span class="pt-session-empty">No saved sessions yet — start a tutoring session and it will appear here.</span>`;
    return;
  }

  // Ensure selectedSessionId is still valid
  if (pt.selectedSessionId !== 'active') {
    const stillExists = saved.some(s => s.id === pt.selectedSessionId);
    if (!stillExists) pt.selectedSessionId = hasActive ? 'active' : (saved[0]?.id || 'active');
  }
  if (pt.selectedSessionId === 'active' && !hasActive && saved.length > 0) {
    pt.selectedSessionId = saved[0].id;
  }

  // Build picker rows
  const rows = [];

  if (hasActive) {
    const subject = state.currentSubject && state.currentSubject !== 'Other'
      ? state.currentSubject : 'Other';
    const turns  = Math.ceil(state.conversationHistory.length / 2);
    const color  = PT_SESSION_SUBJECT_COLORS[subject] || PT_SESSION_SUBJECT_COLORS.Other;
    const active = pt.selectedSessionId === 'active';
    rows.push(`
      <div class="pt-sess-row ${active ? 'pt-sess-selected' : ''}"
           data-sessid="active"
           onclick="window._ptSelectSession('active')">
        <span class="pt-sess-dot" style="background:${color}"></span>
        <div class="pt-sess-meta">
          <span class="pt-sess-title">
            <span class="pt-sess-live-badge">Live</span>
            Current session
          </span>
          <span class="pt-sess-sub">${subject === 'Other' ? 'General' : subject} · ${turns} exchange${turns !== 1 ? 's' : ''}</span>
        </div>
        ${active ? '<span class="pt-sess-check">✓</span>' : ''}
      </div>`);
  }

  saved.forEach(s => {
    const label  = s.subject === 'ComputerScience' ? 'CS' : (s.subject || 'Other');
    const color  = PT_SESSION_SUBJECT_COLORS[s.subject] || PT_SESSION_SUBJECT_COLORS.Other;
    const msgs   = Math.floor((s.history?.length || 0) / 2);
    const active = pt.selectedSessionId === s.id;
    rows.push(`
      <div class="pt-sess-row ${active ? 'pt-sess-selected' : ''}"
           data-sessid="${escHtml(s.id)}"
           onclick="window._ptSelectSession('${escHtml(s.id)}')">
        <span class="pt-sess-dot" style="background:${color}"></span>
        <div class="pt-sess-meta">
          <span class="pt-sess-title">${escHtml(s.title || 'Untitled')}</span>
          <span class="pt-sess-sub">${escHtml(label)} · ${msgs} msg${msgs !== 1 ? 's' : ''} · ${ptRelativeTime(s.ts)}</span>
        </div>
        ${active ? '<span class="pt-sess-check">✓</span>' : ''}
      </div>`);
  });

  info.innerHTML = `
    <div class="pt-sess-picker">
      <p class="pt-sess-picker-label">Choose a session to generate from:</p>
      <div class="pt-sess-list">${rows.join('')}</div>
    </div>`;
}

// Session row selection handler (exposed as global for inline onclick)
window._ptSelectSession = function(id) {
  pt.selectedSessionId = id;
  // Re-render rows without re-fetching from Firestore
  ptRefreshSessionTab();
  ptValidate();
};


// ── Subject select sync ───────────────────────────────────────────────────────

function ptSyncSubjectSelect() {
  const sel = document.getElementById('ptSubjectSelect');
  if (!sel) return;
  const s = state.currentSubject;
  if (s && s !== 'Other' && sel.querySelector(`option[value="${s}"]`)) {
    sel.value = s;
  }
}


// ── File handling ─────────────────────────────────────────────────────────────

(function initFileHandling() {
  const dropzone  = document.getElementById('ptDropzone');
  const fileInput = document.getElementById('ptFileInput');
  if (!dropzone || !fileInput) return;

  // Click on dropzone opens file picker (but not the browse button itself — it has its own onclick)
  dropzone.addEventListener('click', e => {
    if (e.target.classList.contains('pt-browse-link')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    handleFiles(Array.from(fileInput.files));
    fileInput.value = ''; // reset so same file can be re-added after remove
  });

  // Drag-and-drop
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('pt-drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('pt-drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('pt-drag-over');
    handleFiles(Array.from(e.dataTransfer.files));
  });
})();

function ptFileError(msg) {
  const el = document.getElementById('ptFileError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('pt-file-error-visible');
  clearTimeout(ptFileError._t);
  ptFileError._t = setTimeout(() => {
    el.classList.remove('pt-file-error-visible');
  }, 3500);
}

function handleFiles(rawFiles) {
  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const toAdd = rawFiles.filter(f => allowed.includes(f.type));

  if (toAdd.length === 0) {
    ptFileError('Unsupported file type — use PDF, image, or Word doc.');
    return;
  }

  toAdd.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const base64 = e.target.result.split(',')[1];
      const totalBytes = pt.files.reduce((acc, f) => acc + f.data.length * 0.75, 0);
      if (totalBytes + base64.length * 0.75 > 8 * 1024 * 1024) {
        ptFileError('Files too large — keep total under 8 MB.');
        return;
      }
      pt.files.push({ name: file.name, mimeType: file.type, data: base64 });
      renderFileChips();
      ptValidate();
    };
    reader.readAsDataURL(file);
  });
}

function renderFileChips() {
  const container = document.getElementById('ptFileChips');
  if (!container) return;
  container.innerHTML = '';
  pt.files.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'pt-file-chip';
    chip.innerHTML = `
      <svg class="pt-file-chip-icon" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="pt-file-chip-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <button class="pt-file-chip-remove" title="Remove" data-idx="${i}">×</button>`;
    chip.querySelector('.pt-file-chip-remove').addEventListener('click', e => {
      pt.files.splice(Number(e.currentTarget.dataset.idx), 1);
      renderFileChips();
      ptValidate();
    });
    container.appendChild(chip);
  });
}


// ── Text counter ──────────────────────────────────────────────────────────────

window.ptTextCounter = function () {
  const ta      = document.getElementById('ptTextInput');
  const counter = document.getElementById('ptCharCount');
  if (!ta || !counter) return;
  counter.textContent = ta.value.length.toLocaleString();
  ptValidate();
};


// ── Config controls ───────────────────────────────────────────────────────────

window.ptSetDifficulty = function (level) {
  pt.difficulty = Number(level);
  document.querySelectorAll('.pt-pill').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.diff) === pt.difficulty);
  });
};

window.ptUpdateQuestionCount = function (val) {
  pt.numQuestions = Number(val);
  document.querySelectorAll('.pt-q-pill').forEach(p => {
    p.classList.toggle('active', Number(p.dataset.val) === Number(val));
  });
};


// ── Validation ────────────────────────────────────────────────────────────────

function ptValidate() {
  const btn  = document.getElementById('ptBtnGenerate');
  const hint = document.getElementById('ptFooterHint');
  if (!btn) return;

  let ready = false;
  let hintText = 'Select a content source above';
  let tooltip  = '';

  if (pt.activeTab === 'files') {
    ready = pt.files.length > 0;
    hintText = ready ? `${pt.files.length} file${pt.files.length !== 1 ? 's' : ''} ready` : 'Upload at least one file';
    tooltip  = ready ? '' : 'Upload at least one file to generate a test';
  } else if (pt.activeTab === 'text') {
    const val = document.getElementById('ptTextInput')?.value.trim() || '';
    ready = val.length >= 20;
    hintText = ready ? `${val.length.toLocaleString()} characters` : 'Paste at least 20 characters';
    tooltip  = ready ? '' : 'Paste at least 20 characters of content first';
  } else if (pt.activeTab === 'session') {
    const saved = getCachedSessions();
    if (pt.selectedSessionId === 'active') {
      ready = state.conversationHistory.length > 0;
      hintText = ready ? 'Current session ready' : 'No active session';
      tooltip  = ready ? '' : 'Start a tutoring session first';
    } else {
      const sess = saved.find(s => s.id === pt.selectedSessionId);
      ready = !!(sess?.history?.length);
      hintText = ready ? `"${(sess.title || 'Session').slice(0, 30)}" ready` : 'Select a session';
      tooltip  = ready ? '' : 'Select a session above';
    }
  }

  btn.disabled = !ready;
  btn.dataset.tooltip = tooltip;
  if (hint) hint.textContent = hintText;
}


// ── Subject detection helper ──────────────────────────────────────────────────
// Scans a history array for subject switches and returns segments.
// Returns null if only one subject found.

function ptDetectSubjectSegments(history, initialSubject) {
  const switchPattern = /\bswitch(?:ing)?\s+to\s+([a-z][a-z\s&+]{1,30}?)(?:\s+now|\s+today|[.!,]|$)/i;
  const segments = [];
  // Seed with the known initial subject so the first segment is always captured
  let currentSubject = (initialSubject && initialSubject !== 'Other') ? initialSubject : null;
  let segmentStart   = 0;

  history.forEach((msg, i) => {
    // Check explicit subject_switch markers first (from dropdown or verbal switch)
    if (msg.type === 'subject_switch' && msg.subject) {
      const newSubject = msg.subject;
      if (newSubject !== currentSubject) {
        if (currentSubject !== null && i > segmentStart) {
          segments.push({ subject: currentSubject, history: history.slice(segmentStart, i) });
        }
        currentSubject = newSubject;
        segmentStart   = i + 1;
      }
      return;
    }

    // Fallback: detect verbal switch from model text (handles older history without markers)
    if (msg.role === 'model') {
      const m = msg.content?.trim().match(switchPattern);
      if (m) {
        const newSubject = resolveSubject(m[1].trim());
        if (newSubject !== 'Other' && newSubject !== currentSubject) {
          if (currentSubject !== null && i > segmentStart) {
            segments.push({ subject: currentSubject, history: history.slice(segmentStart, i) });
          }
          currentSubject = newSubject;
          segmentStart   = i + 1;
        }
      }
    }
  });

  // Push final segment
  if (currentSubject && segmentStart < history.length) {
    segments.push({ subject: currentSubject, history: history.slice(segmentStart) });
  }

  // Merge consecutive segments with the same subject (e.g. Math -> Physics -> Math)
  const merged = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.subject === seg.subject) {
      prev.history = [...prev.history, ...seg.history];
    } else {
      merged.push({ subject: seg.subject, history: [...seg.history] });
    }
  }

  return merged.length > 1 ? merged : null;
}


// ── Subject picker ────────────────────────────────────────────────────────────

function ptShowSubjectPicker(segments, onPick) {
  const existing = document.getElementById('ptSubjectPickerOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ptSubjectPickerOverlay';
  overlay.className = 'pt-subject-picker-overlay';

  const buttons = segments.map(seg => {
    const color = PT_SESSION_SUBJECT_COLORS[seg.subject] || PT_SESSION_SUBJECT_COLORS.Other;
    const exchanges = Math.ceil(seg.history.length / 2);
    return `<button class="pt-subject-pick-btn" data-subject="${escHtml(seg.subject)}" style="--subject-color:${color}">
      <span class="pt-pick-dot" style="background:${color}"></span>
      <span class="pt-pick-name">${escHtml(seg.subject)}</span>
      <span class="pt-pick-msgs">${exchanges} exchange${exchanges !== 1 ? 's' : ''}</span>
    </button>`;
  }).join('');

  const dismiss = () => {
    overlay.remove();
  };

  overlay.innerHTML = `
    <div class="pt-subject-picker-card">
      <div class="pt-subject-picker-header">
        <button class="pt-subject-picker-back" aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
      </div>
      <p class="pt-subject-picker-label">This session covered multiple subjects.<br>Which would you like to be tested on?</p>
      <div class="pt-subject-pick-btns">${buttons}</div>
    </div>`;

  overlay.querySelector('.pt-subject-picker-back').addEventListener('click', dismiss);

  // Clicking the dark backdrop also dismisses
  overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });

  overlay.querySelectorAll('.pt-subject-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const seg = segments.find(s => s.subject === btn.dataset.subject);
      overlay.remove();
      onPick(seg.history, seg.subject);
    });
  });

  document.getElementById('ptWindow').appendChild(overlay);
}


// ── Generate ──────────────────────────────────────────────────────────────────

window.generatePracticeTest = async function () {
  // Collect question types
  const types = [];
  if (document.getElementById('ptTypeMultiple')?.checked) types.push('multiple_choice');
  if (document.getElementById('ptTypeShort')?.checked)    types.push('short_answer');
  if (document.getElementById('ptTypeTrueFalse')?.checked) types.push('true_false');

  if (types.length === 0) {
    showToast('Select at least one question type.');
    return;
  }

  // Build request body
  const body = {
    contentType:  pt.activeTab,
    difficulty:   pt.difficulty,
    numQuestions: pt.numQuestions,
    questionTypes: types,
    subject:      state.currentSubject || 'Other',
  };

  if (pt.activeTab === 'files') {
    body.files = pt.files.map(f => ({ data: f.data, mimeType: f.mimeType, name: f.name }));
  } else if (pt.activeTab === 'text') {
    body.text = document.getElementById('ptTextInput')?.value.trim();
  } else if (pt.activeTab === 'session') {
    let fullHistory, sessionSubject;

    if (pt.selectedSessionId === 'active') {
      fullHistory     = state.conversationHistory;
      // Use sessionSubject (locked on first save) as the initial subject, not currentSubject
      // which has already been updated to the latest subject in a multi-subject session
      sessionSubject  = state.sessionSubject || state.currentSubject || 'Other';
    } else {
      const saved = getCachedSessions();
      const sess  = saved.find(s => s.id === pt.selectedSessionId);
      if (!sess) { showToast('Selected session not found.'); return; }
      fullHistory    = sess.history || [];
      sessionSubject = sess.subject || 'Other';
    }

    // Check for subject switches — pass the initial subject so the first segment is captured
    const segments = ptDetectSubjectSegments(fullHistory, sessionSubject);

    if (segments && segments.length > 1) {
      // Multiple subjects — show picker before proceeding
      ptShowSubjectPicker(segments, (filteredHistory, chosenSubject) => {
        body.sessionHistory = filteredHistory.slice(-20);
        body.subject        = chosenSubject || sessionSubject;
        ptRunGenerate(body);
      });
      return; // wait for picker
    }

    // Single subject — proceed as normal
    body.sessionHistory = fullHistory.slice(-20);
    body.subject        = sessionSubject;
  }

  ptRunGenerate(body);
};

// Extracted so both the normal path and the subject-picker callback can call it
async function ptRunGenerate(body) {
  ptShowResults('');
  ptSetGenerating(true);

  try {
    const res = await fetch(`${API_BASE}/practice-test`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);

    pt.lastResult = data.test;
    pt.lastTitle  = data.title || 'Practice Test';

    // Always surface the result view when done — even if user navigated back via picker
    document.getElementById('ptConfigView').classList.add('pt-body-hidden');
    document.getElementById('ptResultView').classList.remove('pt-body-hidden');
    document.getElementById('ptResultTitle').textContent = pt.lastTitle;
    ptRenderResult(data.test);
    ptSetGenerating(false);
    ptShowFooterResults();

  } catch (e) {
    ptSetGenerating(false);

    let friendly = 'Something went wrong. Please try again.';
    if (/429|quota|rate.?limit|too many/i.test(e.message)) {
      friendly = "API quota exceeded — you've run out of tokens. Try again later or check your billing at ai.dev.";
    } else if (/network|fetch|failed to fetch/i.test(e.message)) {
      friendly = 'Could not reach the server. Make sure the backend is running.';
    } else if (/500|server error/i.test(e.message)) {
      friendly = 'The server ran into an error. Check the backend logs.';
    }

    document.getElementById('ptSkeleton').hidden = true;
    document.getElementById('ptResultContent').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 16px;text-align:center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style="font-size:13px;color:var(--text);font-weight:600;margin:0;">Generation failed</p>
        <p style="font-size:12px;color:var(--text-mid);margin:0;max-width:340px;line-height:1.6;">${friendly}</p>
        <button class="btn pt-export-btn" style="margin-top:4px;" onclick="ptShowConfig()">← Try again</button>
      </div>`;
  }
}


// ── View transitions ──────────────────────────────────────────────────────────

function ptShowResults(markdown) {
  document.getElementById('ptConfigView').classList.add('pt-body-hidden');
  document.getElementById('ptResultView').classList.remove('pt-body-hidden');
  document.getElementById('ptFooterConfig').classList.add('pt-footer-hidden');
  document.getElementById('ptResultContent').innerHTML = '';
  document.getElementById('ptSkeleton').hidden = false;
}

window.ptShowConfig = function () {
  document.getElementById('ptResultView').classList.add('pt-body-hidden');
  document.getElementById('ptConfigView').classList.remove('pt-body-hidden');
  document.getElementById('ptFooterConfig').classList.remove('pt-footer-hidden');
  document.getElementById('ptFooterResults').classList.add('pt-footer-hidden');
  ptValidate();
};

function ptShowFooterResults() {
  document.getElementById('ptFooterConfig').classList.add('pt-footer-hidden');
  document.getElementById('ptFooterResults').classList.remove('pt-footer-hidden');
}

function ptSetGenerating(isGenerating) {
  const btn    = document.getElementById('ptBtnGenerate');
  const label  = document.getElementById('ptBtnLabel');
  const icon   = btn?.querySelector('.pt-gen-icon');
  const spinner = btn?.querySelector('.pt-gen-spinner');
  if (!btn) return;

  if (isGenerating) {
    btn.classList.add('is-loading');
    btn.disabled = true;
    if (label)   label.textContent = 'Generating…';
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    if (label)   label.textContent = 'Generate Test';
  }
}


// ── Render result ─────────────────────────────────────────────────────────────

function ptRenderResult(markdown) {
  document.getElementById('ptSkeleton').hidden = true;
  const content = document.getElementById('ptResultContent');
  if (!content) return;

  // Use parseMarkdownWithMath to protect LaTeX from being mangled by marked
  content.innerHTML = parseMarkdownWithMath(markdown);

  // Syntax highlight code blocks
  content.querySelectorAll('pre code:not(.hljs)').forEach(block => {
    try { hljs.highlightElement(block); } catch (_) {}
  });

  // Render math
  if (window.renderMathInElement) {
    try {
      renderMathInElement(content, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '$',  right: '$',  display: false },
        ],
        throwOnError: false,
      });
    } catch (_) {}
  }
}


// ── Export: copy as text ──────────────────────────────────────────────────────

window.ptCopyText = function () {
  if (!pt.lastResult) return;
  const plain = mdToPlain(pt.lastResult);
  navigator.clipboard.writeText(plain).then(() => {
    const btn = document.getElementById('ptBtnCopy');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }).catch(() => showToast('Copy failed'));
};


// ── Export: download PDF ──────────────────────────────────────────────────────

window.ptDownloadPDF = function () {
  if (!pt.lastResult) return;

  let html;
  try { html = marked.parse(pt.lastResult); } catch (_) { html = escHtml(pt.lastResult); }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  const printDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>${escHtml(pt.lastTitle)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js"><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.8;
      color: #1a1a14;
      background: #fff;
      padding: 40px 48px;
      max-width: 780px;
      margin: 0 auto;
    }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
    h2 { font-size: 12px; font-weight: 600; text-transform: uppercase;
         letter-spacing: 0.8px; color: #666; margin: 24px 0 8px;
         border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    h3 { font-size: 13px; font-weight: 600; margin: 18px 0 6px; }
    p  { margin-bottom: 8px; }
    ol, ul { padding-left: 20px; margin: 6px 0 14px; }
    li { margin-bottom: 8px; }
    hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
    strong { font-weight: 600; }
    code { font-family: monospace; font-size: 11.5px; background: #f4f4f4;
           padding: 1px 4px; border-radius: 3px; }
    pre  { background: #f4f4f4; padding: 12px; border-radius: 4px;
           font-size: 11.5px; overflow-x: auto; margin: 10px 0; }
    @media print {
      body { padding: 20px; }
      h2 { page-break-before: auto; }
    }
  </style>
</head>
<body>
  ${html}
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      if (window.renderMathInElement) {
        renderMathInElement(document.body, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$',  right: '$',  display: false },
          ],
          throwOnError: false,
        });
      }
      setTimeout(() => window.print(), 600);
    });
  <\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked — allow pop-ups and try again.'); return; }
  win.document.write(printDoc);
  win.document.close();
};


// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdToPlain(md) {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\$\$[\s\S]+?\$\$/g, '')
    .replace(/\$[^$]+?\$/g, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, (m) => m)
    .replace(/^---+$/gm, '────────────────────')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Close on overlay click
document.getElementById('ptOverlay')?.addEventListener('click', window.closePracticeTest);

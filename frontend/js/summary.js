// ── summary.js ────────────────────────────────────────────────────────────────
// Chat session summariser — opens a floating window, calls /summarize,
// renders the result with the same pipeline as practice-test.js.

import { API_BASE } from './config.js';
import { parseMarkdownWithMath } from './messages.js';

// ── Internal state ────────────────────────────────────────────────────────────

const sm = {
  lastResult: null,   // markdown string
  lastTitle:  '',
};


// ── Position window ───────────────────────────────────────────────────────────

function smPositionWindow(win) {
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

window.addEventListener('resize', () => {
  const win = document.getElementById('smWindow');
  if (!win || win.hidden) return;
  smPositionWindow(win);
});

// ── Draggable window ──────────────────────────────────────────────────────────

(function initSmDraggable() {
  const win    = document.getElementById('smWindow');
  const handle = win?.querySelector('.pt-header');
  if (!win || !handle) return;

  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  handle.style.cursor = 'grab';

  handle.addEventListener('mousedown', e => {
    if (window.innerWidth <= 600) return;
    if (e.target.closest('button')) return;
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


// ── Open ──────────────────────────────────────────────────────────────────────

// Called from history.js context menu with a session object:
// { id, title, customTitle, subject, history: [{role, content}] }
window.openSummary = async function (session) {
  const win     = document.getElementById('smWindow');
  const overlay = document.getElementById('smOverlay');
  if (!win) return;

  // Reset state
  sm.lastResult = null;
  sm.lastTitle  = '';

  // Show window in loading state
  smPositionWindow(win);
  win.hidden     = false;
  overlay.hidden = false;
  document.body.classList.add('pt-open'); // reuse same body lock

  smShowSkeleton();
  smSetFooterVisible(false);

  const displayTitle = session.customTitle || session.title || 'Chat Session';
  document.getElementById('smResultTitle').textContent = displayTitle;

  // Fire request
  try {
    // Extract ordered unique subjects from markers before stripping them
    const rawHistory = session.history || [];
    const subjects = [];
    const initialSubject = session.subject || 'Other';
    if (initialSubject !== 'Other') subjects.push(initialSubject);
    rawHistory.forEach(m => {
      if (m.type === 'subject_switch' && m.subject && !subjects.includes(m.subject)) {
        subjects.push(m.subject);
      }
    });

    // Strip subject-switch markers and AI confirmation lines before summarizing
    const switchPattern = /^Sure,\s+switching to .+? now[!.]?$/i;
    const history = rawHistory
      .filter(m => !switchPattern.test(m.content?.trim()) && m.type !== 'subject_switch')
      .slice(-40);

    const res = await fetch(`${API_BASE}/summarize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sessionHistory: history,
        subject:        initialSubject,
        subjects:       subjects.length > 1 ? subjects : null,
        title:          displayTitle,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error ' + res.status);

    sm.lastResult = data.summary;
    sm.lastTitle  = data.title || displayTitle;

    document.getElementById('smResultTitle').textContent = sm.lastTitle;
    smRenderResult(data.summary);
    smSetFooterVisible(true);

  } catch (e) {
    smRenderError(e.message);
  }
};


// ── Close ─────────────────────────────────────────────────────────────────────

window.closeSummary = function () {
  const win     = document.getElementById('smWindow');
  const overlay = document.getElementById('smOverlay');
  if (!win) return;
  win.hidden     = true;
  overlay.hidden = true;
  document.body.classList.remove('pt-open');
};

// Close on overlay click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('smOverlay')?.addEventListener('click', closeSummary);
});


// ── Skeleton / error ──────────────────────────────────────────────────────────

function smShowSkeleton() {
  document.getElementById('smSkeleton').hidden  = false;
  document.getElementById('smContent').innerHTML = '';
}

function smRenderError(msg) {
  document.getElementById('smSkeleton').hidden = true;

  let friendly = 'Something went wrong. Please try again.';
  if (/429|quota|rate.?limit|too many/i.test(msg)) {
    friendly = "API quota exceeded — you've run out of tokens. Try again later or check your billing at ai.dev.";
  } else if (/network|fetch|failed to fetch/i.test(msg)) {
    friendly = 'Could not reach the server. Make sure the backend is running.';
  } else if (/500|server error/i.test(msg)) {
    friendly = 'The server ran into an error. Check the backend logs.';
  }

  document.getElementById('smContent').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 16px;text-align:center;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p style="font-size:13px;color:var(--text);font-weight:600;margin:0;">Summary failed</p>
      <p style="font-size:12px;color:var(--text-mid);margin:0;max-width:340px;line-height:1.6;">${escHtml(friendly)}</p>
    </div>`;
}


// ── Render result ─────────────────────────────────────────────────────────────

function smRenderResult(markdown) {
  document.getElementById('smSkeleton').hidden = true;
  const content = document.getElementById('smContent');
  if (!content) return;

  content.innerHTML = parseMarkdownWithMath(markdown);

  // Syntax highlight
  content.querySelectorAll('pre code:not(.hljs)').forEach(block => {
    try { hljs.highlightElement(block); } catch (_) {}
  });

  // KaTeX
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


// ── Footer visibility ─────────────────────────────────────────────────────────

function smSetFooterVisible(visible) {
  const footer = document.getElementById('smFooter');
  if (!footer) return;
  footer.classList.toggle('pt-footer-hidden', !visible);
}


// ── Export: copy as text ──────────────────────────────────────────────────────

window.smCopyText = function () {
  if (!sm.lastResult) return;
  const plain = sm.lastResult.replace(/#{1,6}\s*/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
  navigator.clipboard.writeText(plain).then(() => {
    const btn = document.getElementById('smBtnCopy');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }).catch(() => {});
};


// ── Export: download PDF ──────────────────────────────────────────────────────

window.smDownloadPDF = function () {
  if (!sm.lastResult) return;

  let html;
  try { html = marked.parse(sm.lastResult); } catch (_) { html = escHtml(sm.lastResult); }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  const printDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>${escHtml(sm.lastTitle)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css"/>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           font-size: 13px; line-height: 1.75; color: #111; background: #fff;
           max-width: 720px; margin: 0 auto; padding: 40px 32px; }
    h1 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-bottom: 20px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px;
         color: #555; border-bottom: 1px solid #eee; padding-bottom: 4px; margin: 24px 0 10px; }
    h3 { font-size: 14px; margin: 16px 0 6px; }
    p, li { margin-bottom: 8px; }
    ul, ol { padding-left: 20px; }
    strong { font-weight: 600; }
    code { font-size: 11px; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
    pre  { background: #f4f4f4; padding: 12px; border-radius: 5px; overflow-x: auto; }
    hr   { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
  </style>
</head>
<body>${html}</body>
</html>`;

  const blob = new Blob([printDoc], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (win) {
    win.addEventListener('load', () => {
      win.print();
      URL.revokeObjectURL(url);
    });
  }
};


// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

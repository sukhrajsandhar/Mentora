// ── ui.js ─────────────────────────────────────────────────────────────────────
// Stateless UI utilities: theme, sidebar, status pip, toast.

// ── Theme ─────────────────────────────────────────────────────────────────────
export function initTheme() {
  const toggle = document.getElementById('themeToggle');
  toggle.checked = document.documentElement.getAttribute('data-theme') !== 'light';

  toggle.addEventListener('change', () => {
    const isDark = toggle.checked;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
let sidebarCollapsed = false;

export function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('body').classList.toggle('sidebar-collapsed', sidebarCollapsed);
}

// ── Status pip ────────────────────────────────────────────────────────────────
export function setStatus(state, label) {
  const pip = document.getElementById('statusPip');
  const txt = document.getElementById('statusTxt');
  if (pip) pip.className = 'pip' + (state === 'live' ? ' live' : state === 'busy' ? ' busy' : '');
  if (txt) txt.textContent = label;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
// type: 'success' | 'error' | 'info'
// If omitted, auto-detects from message content.
export function showToast(msg, type) {
  const t = document.getElementById('toast');

  // Auto-detect type from message if not provided
  if (!type) {
    const lower = msg.toLowerCase();
    if (/error|failed|fail|blocked|missing|invalid/.test(lower)) {
      type = 'error';
    } else if (/\u2713|saved|restored|copied|done|success/.test(lower)) {
      type = 'success';
    } else {
      type = 'info';
    }
  }

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };

  t.innerHTML = '<span class="toast-icon">' + icons[type] + '</span><span class="toast-msg">' + msg + '</span>';
  t.className = 'toast toast-' + type + ' show';

  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), type === 'error' ? 6000 : 3500);
}

// ── Generic helpers ───────────────────────────────────────────────────────────
export function mkEl(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

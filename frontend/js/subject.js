// ── subject.js ────────────────────────────────────────────────────────────────
// Subject detection UI: badge display, colour coding, and manual override.
// Imported by camera.js (to update after analysis) and app.js (to expose
// overrideSubject globally for the inline HTML onchange handler).

import { state } from './state.js';

// ── Colour map ────────────────────────────────────────────────────────────────
const SUBJECT_COLORS = {
  Math:            '#818cf8',   // soft indigo
  Physics:         '#60a5fa',   // sky blue
  Chemistry:       '#34d399',   // emerald
  Biology:         '#a3e635',   // lime
  ComputerScience: '#fbbf24',   // amber
  History:         '#f87171',   // soft red
  Literature:      '#ec4899',   // pink
  Economics:       '#8b5cf6',   // violet
  Other:           '#6b7280',   // gray
};

// Human-friendly display labels
const SUBJECT_LABELS = {
  ComputerScience: 'CS',
};

// ── Badge ─────────────────────────────────────────────────────────────────────
/**
 * Update (or create) the subject badge in the header.
 * @param {string} subject - One of the PERSONAS keys
 */
export function updateSubjectBadge(subject) {
  // Persist on shared state so chat endpoint can use the right persona
  state.currentSubject = subject;

  // Sync dropdown — Other = Auto in the UI
  const valueEl = document.getElementById('subjectSelectValue');
  const menu    = document.getElementById('subjectSelectMenu');
  if (valueEl) valueEl.textContent = subject === 'Other' ? 'Auto' : (subject === 'ComputerScience' ? 'CS' : subject);
  if (menu) {
    menu.querySelectorAll('.subject-select-option').forEach(o => {
      o.classList.toggle('active', o.dataset.value === subject || (subject === 'Other' && o.dataset.value === 'Auto'));
    });
  }

  // Show a gray badge for Other
  if (subject === 'Other') {
    let badge = document.getElementById('subjectBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'subjectBadge';
      badge.className = 'subject-badge';
      const headerRight  = document.querySelector('.header-right');
      const overrideWrap = document.getElementById('subjectOverrideWrap');
      const settingsWrap = document.getElementById('settingsWrap');
      headerRight.insertBefore(badge, overrideWrap || settingsWrap);
    }
    badge.style.opacity = '1';
    badge.textContent = 'Other';
    badge.style.setProperty('--subject-color', SUBJECT_COLORS.Other);
    return;
  }

  let badge = document.getElementById('subjectBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'subjectBadge';
    badge.className = 'subject-badge';
    const headerRight = document.querySelector('.header-right');
    const overrideWrap = document.getElementById('subjectOverrideWrap');
    if (overrideWrap) {
      headerRight.insertBefore(badge, overrideWrap);
    } else {
      headerRight.insertBefore(badge, headerRight.firstChild);
    }
  }

  badge.style.opacity = '1';
  const label = SUBJECT_LABELS[subject] || subject;
  const color = SUBJECT_COLORS[subject] || SUBJECT_COLORS.Other;

  badge.textContent = label;
  badge.style.setProperty('--subject-color', color);

  // Pop animation — remove then re-add class
  badge.classList.remove('subject-pop');
  void badge.offsetWidth;
  badge.classList.add('subject-pop');
}

// ── Manual override ───────────────────────────────────────────────────────────
/**
 * Called by the inline onchange on #subjectOverride.
 * Allows the student to correct a wrong detection.
 * @param {string} subject
 */
export function overrideSubject(subject) {
  if (!subject) return;
  if (subject === 'Auto') {
    // Remove badge when set to Auto
    document.getElementById('subjectBadge')?.remove();
    state.currentSubject     = 'Other';
    state.subjectManuallySet = false;
    return;
  }
  updateSubjectBadge(subject);
}

// ── Inject override dropdown into the DOM ─────────────────────────────────────
/**
 * Build and insert the subject override <select> next to the badge.
 * Call once from app.js after DOMContentLoaded.
 */
export function initSubjectOverride() {
  const subjects = [
    'Auto',
    'Math',
    'Physics',
    'Chemistry',
    'Biology',
    'ComputerScience',
    'History',
    'Literature',
    'Economics',
    'Other',
  ];

  const wrap = document.createElement('div');
  wrap.className = 'subject-override-wrap';
  wrap.id = 'subjectOverrideWrap';

  wrap.innerHTML = `
    <div class="subject-select" id="subjectOverride" title="Set subject — AI will tailor its explanations">
      <span class="subject-select-label">Subject</span>
      <span class="subject-select-divider"></span>
      <span class="subject-select-value" id="subjectSelectValue">Auto</span>
      <svg class="subject-select-chevron" viewBox="0 0 10 6" fill="none">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="subject-select-menu" id="subjectSelectMenu">
        
        ${subjects.map(s => `
          <div class="subject-select-option" data-value="${s}">
            ${s === 'ComputerScience' ? 'CS' : s}
          </div>`).join('')}
      </div>
    </div>`;

  // Toggle open/close
  const dropdown = wrap.querySelector('#subjectOverride');
  const menu     = wrap.querySelector('#subjectSelectMenu');
  const valueEl  = wrap.querySelector('#subjectSelectValue');

  dropdown.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle('open');
    dropdown.classList.toggle('open', isOpen);
  });

  // Select option
  menu.querySelectorAll('.subject-select-option').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      const val = opt.dataset.value;
      valueEl.textContent = opt.textContent.trim();
      menu.classList.remove('open');
      dropdown.classList.remove('open');
      // Mark active
      menu.querySelectorAll('.subject-select-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      // Fire the same logic as before
      overrideSubject(val);
      // Dispatch custom event for voice.js to pick up
      dropdown.dispatchEvent(new CustomEvent('subjectchange', { detail: val }));
    });
  });

  // Close when clicking outside — capture phase so nothing can block it
  document.addEventListener('mousedown', e => {
    if (!wrap.contains(e.target)) {
      menu.classList.remove('open');
      dropdown.classList.remove('open');
    }
  }, true);

  // Mark Auto as active by default
  menu.querySelector('.subject-select-option')?.classList.add('active');

  // Insert into header-right before settings
  const headerRight  = document.querySelector('.header-right');
  const settingsWrap = document.getElementById('settingsWrap');
  headerRight.insertBefore(wrap, settingsWrap);
}

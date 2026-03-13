// ── fileAttach.js ─────────────────────────────────────────────────────────────
// File attachment for the chat input — images and PDFs only.
// Exposes:
//   initFileAttach()   — call once from app.js after DOM ready
//   getAttachedFile()  — returns { mimeType, data, name } or null
//   clearAttachedFile() — call after send to reset state
// ─────────────────────────────────────────────────────────────────────────────

import { showToast } from './ui.js';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_SIZE_MB    = 10;

let attachedFile = null; // { mimeType, data, name }

export function getAttachedFile()  { return attachedFile; }
export function clearAttachedFile() {
  attachedFile = null;
  renderPreview();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initFileAttach() {
  const inputInner  = document.querySelector('.chat-input-inner');
  const chatInput   = document.getElementById('chatInput');
  const chatWrap    = document.querySelector('.chat-input-wrap');
  if (!inputInner || !chatInput || !chatWrap) return;

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type     = 'file';
  fileInput.accept   = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
  fileInput.hidden   = true;
  fileInput.id       = 'chatFileInput';
  document.body.appendChild(fileInput);

  // Attach button (paperclip) — inserted before textarea inside .chat-input-inner
  const attachBtn = document.createElement('button');
  attachBtn.id          = 'btnAttach';
  attachBtn.type        = 'button';
  attachBtn.ariaLabel   = 'Attach image or PDF';
  attachBtn.title       = 'Attach image or PDF';
  attachBtn.innerHTML   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.17a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
  </svg>`;
  inputInner.insertBefore(attachBtn, chatInput);

  // Preview strip — sits above the input inner box
  const previewStrip = document.createElement('div');
  previewStrip.id = 'chatFilePreview';
  chatWrap.insertBefore(previewStrip, chatWrap.querySelector('.chat-input-inner'));

  // ── Events ────────────────────────────────────────────────────────────────

  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = ''; // reset so same file can be re-attached
  });

  // Drag & drop onto the whole chat input wrap
  chatWrap.addEventListener('dragover', e => {
    e.preventDefault();
    chatWrap.classList.add('drag-over');
  });
  chatWrap.addEventListener('dragleave', e => {
    if (!chatWrap.contains(e.relatedTarget)) chatWrap.classList.remove('drag-over');
  });
  chatWrap.addEventListener('drop', e => {
    e.preventDefault();
    chatWrap.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Drag & drop onto the full chat panel (the big empty area)
  const chatPanel = document.querySelector('.chat-panel');
  if (chatPanel) {
    // Drop overlay — shown while dragging over the panel
    const overlay = document.createElement('div');
    overlay.id = 'chatDropOverlay';
    overlay.innerHTML = `<div class="chat-drop-hint">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" width="32" height="32">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.17a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
      </svg>
      <span>Drop image or PDF to attach</span>
    </div>`;
    chatPanel.appendChild(overlay);

    chatPanel.addEventListener('dragover', e => {
      e.preventDefault();
      overlay.classList.add('visible');
    });
    chatPanel.addEventListener('dragleave', e => {
      if (!chatPanel.contains(e.relatedTarget)) overlay.classList.remove('visible');
    });
    chatPanel.addEventListener('drop', e => {
      e.preventDefault();
      overlay.classList.remove('visible');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  // Paste image from clipboard
  chatInput.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      handleFile(item.getAsFile());
    }
  });
}

// ── File handler ──────────────────────────────────────────────────────────────

function handleFile(file) {
  if (attachedFile) {
    showToast('One file at a time — remove the current one first.');
    return;
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    showAttachError('Only images (JPEG, PNG, WebP, GIF) and PDFs are supported.');
    return;
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    showAttachError(`File too large — max ${MAX_SIZE_MB} MB.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    attachedFile = { mimeType: file.type, data: base64, name: file.name };
    renderPreview();
  };
  reader.readAsDataURL(file);
}

// ── Preview ───────────────────────────────────────────────────────────────────

function renderPreview() {
  const strip = document.getElementById('chatFilePreview');
  if (!strip) return;

  if (!attachedFile) {
    strip.innerHTML = '';
    strip.style.display = 'none';
    return;
  }

  const isImage = attachedFile.mimeType.startsWith('image/');
  const thumb   = isImage
    ? `<img src="data:${attachedFile.mimeType};base64,${attachedFile.data}" alt="attachment preview" />`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>`;

  strip.style.display = 'flex';
  strip.innerHTML = `
    <div class="chat-file-chip">
      <span class="chat-file-thumb">${thumb}</span>
      <span class="chat-file-name">${escName(attachedFile.name)}</span>
      <button class="chat-file-remove" aria-label="Remove attachment" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" width="10" height="10">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;

  strip.querySelector('.chat-file-remove').addEventListener('click', clearAttachedFile);
}

function showAttachError(msg) {
  const strip = document.getElementById('chatFilePreview');
  if (!strip) return;
  strip.style.display = 'flex';
  strip.innerHTML = `<span class="chat-attach-error">${msg}</span>`;
  setTimeout(() => { if (!attachedFile) { strip.innerHTML = ''; strip.style.display = 'none'; } }, 3500);
}

function escName(name) {
  return name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').slice(0, 40);
}

// ── messages.js ───────────────────────────────────────────────────────────────
// THE single rendering system for all messages — camera, chat, and voice.
// camera.js and voice.js both call these shared functions.

import { state }                         from './state.js';
import { showToast, mkEl, esc, nowTime } from './ui.js';
import { IMAGE_TRIGGERS, PERSONA_NAMES } from './prompts.js';
import { attachExportBtn }               from './export.js';
import { autoSaveSession }               from './history.js';

import { API_BASE } from './config.js';
import { getAttachedFile, clearAttachedFile } from './fileAttach.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

export function tutorName() {
  return PERSONA_NAMES[state.currentSubject] || 'Sam';
}

export function clearEmpty() {
  document.getElementById('emptyState')?.remove();
}

export function scrollMsgs() {
  const m = document.getElementById('messages');
  if (m && m.scrollHeight - m.scrollTop - m.clientHeight < 160) {
    m.scrollTop = m.scrollHeight;
  }
}

function toPlainText(md) {
  return md
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    // LaTeX block math — extract just the inner expression
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => {
      return inner
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\quad\s*/g, ' ')
        .replace(/\\overline\{[^}]*\}/g, '')
        .replace(/\\smash\{[^}]*\}/g, '')
        .replace(/\\underline\{([^}]*)\}/g, '$1')
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    })
    // LaTeX inline math — extract just the inner expression
    .replace(/\$((?:[^$]|\\.)+?)\$/g, (_, inner) => {
      return inner
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\quad\s*/g, ' ')
        .replace(/\\times/g, '×')
        .replace(/\\div/g, '÷')
        .replace(/\\pm/g, '±')
        .replace(/\\leq/g, '≤')
        .replace(/\\geq/g, '≥')
        .replace(/\\neq/g, '≠')
        .replace(/\\approx/g, '≈')
        .replace(/\\infty/g, '∞')
        .replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
        .replace(/\\overline\{[^}]*\}/g, '')
        .replace(/\\smash\{[^}]*\}/g, '')
        .replace(/\\underline\{([^}]*)\}/g, '$1')
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    })
    // Markdown cleanup
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/💡\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderMath(el) {
  if (window.renderMathInElement) {
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '$',  right: '$',  display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true  },
        ],
        throwOnError: false,
      });
    } catch (_) { /* partial LaTeX during streaming — ignore */ }
  }
}

// ── Blockquote stripping ──────────────────────────────────────────────────────
// Gemini outputs "> text" despite instructions. Strip before marked sees it
// AND unwrap any <blockquote> HTML marked generates anyway.

function stripBlockquotes(text) {
  return text
    .replace(/^(>\s*)+/gm, '')   // strip every leading > on any line (handles nested)
    .replace(/\s>\s/g, ' ');     // strip stray " > " mid-sentence
}

function unwrapBlockquotes(html) {
  let prev;
  do {
    prev = html;
    html = html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '$1');
  } while (html !== prev);
  return html;
}

// Safe wrapper — never throws, falls back to escaped plain text
function safeParse(text) {
  try {
    return unwrapBlockquotes(marked.parse(stripBlockquotes(text)));
  } catch (_) {
    return '<p>' + esc(text) + '</p>';
  }
}

// ── Markdown + Math renderer ──────────────────────────────────────────────────
// Protects LaTeX blocks from marked by swapping them for placeholders,
// running marked, then restoring. Blockquotes stripped before and after.

export function parseMarkdownWithMath(text) {
  const blocks = [];
  let cleaned = stripBlockquotes(text);

  // 1. Pull out $$ display blocks first
  let protected_ = cleaned.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => {
    blocks.push({ type: 'display', content: inner });
    return `MATHBLOCK_${blocks.length - 1}_END`;
  });

  // 2. Pull out inline $ blocks
  protected_ = protected_.replace(/\$((?:[^$]|\\.)+?)\$/g, (_, inner) => {
    blocks.push({ type: 'inline', content: inner });
    return `MATHINLINE_${blocks.length - 1}_END`;
  });

  // 3. Run marked
  let html;
  try { html = marked.parse(protected_); }
  catch (_) { html = '<p>' + esc(protected_) + '</p>'; }

  // 4. Unwrap any blockquotes marked still generated
  html = unwrapBlockquotes(html);

  // 5. Restore math blocks
  html = html.replace(/MATHBLOCK_(\d+)_END/g, (_, i) => `$$${blocks[i].content}$$`);
  html = html.replace(/MATHINLINE_(\d+)_END/g, (_, i) => `$${blocks[i].content}$`);

  return html;
}


// ── Streaming bubble builders ─────────────────────────────────────────────────

export function appendStreamingAI(nameOverride, icon) {
  clearEmpty();
  const el   = mkEl('div', 'msg ai streaming');
  const name = (nameOverride || tutorName()) + (icon ? ' ' + icon : '');
  el.innerHTML = `
    <div class="msg-label">${esc(name)} <span class="msg-time">${nowTime()}</span></div>
    <div class="msg-bubble"></div>`;
  document.getElementById('messages').appendChild(el);
  scrollMsgs();
  return el;
}

export function updateStreamingLabel(el, subject) {
  const label = el.querySelector('.msg-label');
  if (!label) return;
  const time = label.querySelector('.msg-time');
  label.textContent = PERSONA_NAMES[subject] || 'Sam';
  if (time) label.appendChild(time);
}

// Used by chat streaming and the voice reformat pass.
// Renders markdown without KaTeX (runs on finalise). Never shows a <pre> box.
export function updateStreamingBubble(el, text) {
  const bubble = el.querySelector('.msg-bubble');
  if (!bubble) return;
  bubble.innerHTML = safeParse(text);
  scrollMsgs();
}

// Used by camera analyze streaming — identical behaviour to updateStreamingBubble
export function updateStreamingBubbleMarkdown(el, text) {
  const bubble = el.querySelector('.msg-bubble');
  if (!bubble) return;
  bubble.innerHTML = safeParse(text);
  scrollMsgs();
}

const _mathRenderTimers = new WeakMap();

export function cancelMathRender(el) {
  const t = _mathRenderTimers.get(el);
  if (t) { clearTimeout(t); _mathRenderTimers.delete(el); }
}

// Used by the live voice transcript. Renders markdown + KaTeX when safe,
// markdown-only otherwise. Never shows a <pre> or blockquote box.
// Wrapped in try-catch so a bad chunk can NEVER crash the WebSocket.
export function updateStreamingBubbleLive(el, text) {
  const bubble = el.querySelector('.msg-bubble');
  if (!bubble) return;

  try {
    const clean = stripBlockquotes(text);

    // Only run KaTeX when delimiters are balanced — mid-chunk would corrupt math
    const ddCount  = (clean.match(/\$\$/g) || []).length;
    const stripped = clean.replace(/\$\$[\s\S]*?\$\$/g, '');
    const dCount   = (stripped.match(/\$/g) || []).length;
    const mathSafe = ddCount % 2 === 0 && dCount % 2 === 0;

    if (mathSafe) {
      bubble.innerHTML = parseMarkdownWithMath(clean);
      renderMath(bubble);
      bubble.querySelectorAll('pre code:not(.hljs)').forEach(c => {
        try { hljs.highlightElement(c); } catch (_) {}
      });
    } else {
      // Mid-LaTeX: markdown only — still a proper chat bubble
      bubble.innerHTML = safeParse(clean);
    }
  } catch (_) {
    // Hard fallback — never let a render error kill the WebSocket connection
    try {
      bubble.innerHTML = '<p>' + esc(text) + '</p>';
    } catch (_2) {}
  }

  scrollMsgs();
}


// ── Finalise ──────────────────────────────────────────────────────────────────

export function finaliseStreamingBubble(el, markdown, opts = {}) {
  el.classList.remove('streaming');
  if (opts.skipExport) el.classList.add('voice-reply');

  const detailsMatch = markdown.match(/<details>[\s\S]*?<\/details>/i);
  const clean        = markdown.replace(/<details>[\s\S]*?<\/details>/i, '').trim();

  const bubbleSel = opts.docCard ? '.doc-body' : '.msg-bubble';
  const bubble = el.querySelector(bubbleSel) || el.querySelector('.msg-bubble');
  if (bubble) {
    try {
      bubble.innerHTML = parseMarkdownWithMath(clean);
    } catch (_) {
      bubble.innerHTML = '<p>' + esc(clean) + '</p>';
    }
    bubble.querySelectorAll('pre code').forEach(b => {
      try { hljs.highlightElement(b); } catch (_) {}
    });
    renderMath(bubble);
  }

  const topRight = document.createElement('div');
  topRight.className = 'msg-top-right';

  const copyBtn = document.createElement('button');
  copyBtn.className   = 'copy-btn';
  copyBtn.title       = 'Copy response';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    const text = opts.plainText ? clean : toPlainText(clean);
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied ✓';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 2000);
    }).catch(() => showToast('Copy failed'));
  });
  topRight.appendChild(copyBtn);
  el.appendChild(topRight);

  attachExportBtn(el);

  if (detailsMatch) {
    const seenText = detailsMatch[0]
      .replace(/<summary>.*?<\/summary>/i, '')
      .replace(/<\/?details>/gi, '')
      .trim();
    if (seenText) {
      const footnote = document.createElement('div');
      footnote.className = 'msg-seen-footnote';
      footnote.innerHTML = `<span class="msg-seen-toggle">👁 what I saw</span><span class="msg-seen-text">${esc(seenText)}</span>`;
      footnote.querySelector('.msg-seen-toggle').addEventListener('click', () => {
        footnote.classList.toggle('expanded');
      });
      el.appendChild(footnote);
    }
  }

  scrollMsgs();
}

// ── Static message builders ───────────────────────────────────────────────────

export function appendUser(text, fileData) {
  clearEmpty();
  const el = mkEl('div', 'msg user');
  const fileHtml = fileData
    ? fileData.mimeType.startsWith('image/')
      ? `<div class="msg-attachment"><img src="data:${fileData.mimeType};base64,${fileData.data}" alt="${fileData.name}" /></div>`
      : `<div class="msg-attachment msg-attachment--pdf"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${fileData.name}</div>`
    : '';
  el.innerHTML = `
    <div class="msg-label">You <span class="msg-time">${nowTime()}</span></div>
    ${fileHtml}
    <div class="msg-bubble">${esc(text)}</div>`;
  document.getElementById('messages').appendChild(el);
  scrollMsgs();
}

export function appendAI(markdown, _frameDataUrl, generatedImageUrl) {
  clearEmpty();
  const el   = mkEl('div', 'msg ai');
  const html = parseMarkdownWithMath(markdown);

  const genHtml = generatedImageUrl
    ? `<div class="msg-gen-img-wrap">
        <img class="msg-gen-img" src="${generatedImageUrl}" alt="Generated diagram" />
        <a class="msg-gen-img-dl" href="${generatedImageUrl}" download="diagram.png" title="Download">↓ Save</a>
       </div>`
    : '';

  el.innerHTML = `
    <div class="msg-label">${esc(tutorName())} <span class="msg-time">${nowTime()}</span></div>
    <div class="msg-bubble">${html}</div>
    ${genHtml}`;

  const topRight = document.createElement('div');
  topRight.className = 'msg-top-right';
  const copyBtn = document.createElement('button');
  copyBtn.className   = 'copy-btn';
  copyBtn.title       = 'Copy response';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(toPlainText(markdown)).then(() => {
      copyBtn.textContent = 'Copied ✓';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 2000);
    }).catch(() => showToast('Copy failed'));
  });
  topRight.appendChild(copyBtn);
  el.appendChild(topRight);
  attachExportBtn(el);

  document.getElementById('messages').appendChild(el);
  el.querySelectorAll('pre code').forEach(b => {
    try { hljs.highlightElement(b); } catch (_) {}
  });
  renderMath(el);
  scrollMsgs();
}

export function appendSys(text) {
  const el = mkEl('div', 'msg sys sys-temp');
  el.innerHTML = `<div class="msg-bubble">${esc(text)}</div>`;
  document.getElementById('messages').appendChild(el);
  scrollMsgs();
  return el;
}

export function appendSysHtml(html) {
  const el = mkEl('div', 'msg sys sys-temp');
  el.innerHTML = `<div class="msg-bubble">${html}</div>`;
  document.getElementById('messages').appendChild(el);
  scrollMsgs();
  return el;
}

export function appendSysLive(text) {
  clearEmpty();
  const el = mkEl('div', 'msg sys live-status');
  el.innerHTML = `<div class="msg-bubble">${esc(text)}</div>`;
  document.getElementById('messages').appendChild(el);
  scrollMsgs();
}

export function appendThinking() {
  clearEmpty();
  const el = mkEl('div', 'msg ai thinking');
  el.innerHTML = `
    <div class="msg-label">${esc(tutorName())}</div>
    <div class="msg-bubble">
      <span class="thinking-dots"><span>·</span><span>·</span><span>·</span></span>
    </div>`;
  document.getElementById('messages').appendChild(el);
  scrollMsgs();
  return el;
}

export function removeSysMsgs() {
  document.querySelectorAll('.sys-temp').forEach(e => e.remove());
}

export function clearAll() {
  const group = document.getElementById('clearConfirmGroup');
  if (!group || group.classList.contains('visible')) return;

  group.classList.add('visible');

  const dismiss = () => group.classList.remove('visible');

  group.querySelector('.clear-confirm-yes').onclick = async e => {
    e.stopPropagation();
    dismiss();
    await _doNewChat();
  };

  group.querySelector('.clear-confirm-no').onclick = e => {
    e.stopPropagation();
    dismiss();
  };
}

async function _doNewChat() {
  // Session already auto-saved on every turn — no need to save again here.
  // Saving here would overwrite the good session with the current (possibly intro-only) DOM.
  state.currentSessionId    = null; // next message = fresh Firestore doc
  state.sessionSubject      = null; // unlock subject for new session
  state.conversationHistory = [];
  state.lastComplexity      = null;
  state.hasAnalyzed         = false;
  state.frameCount          = 0;
  state.currentSubject      = 'Other';
  state.subjectManuallySet  = false;
  document.getElementById('messages').innerHTML = `
    <div class="empty-state" id="emptyState">
      <p class="empty-title">Ready when you are.</p>
      <p class="empty-hint">Start the camera, point it at your work,<br/>and hit <strong>Analyze</strong> — or ask anything below.</p>
    </div>`;
  import('./subject.js').then(m => m.updateSubjectBadge('Other'));
}

export async function newChat() {
  const group = document.getElementById('clearConfirmGroup');
  if (group?.classList.contains('visible')) return;

  // Nothing visible — nothing to clear
  const hasMessages = state.conversationHistory.length > 0
    || document.querySelectorAll('#messages .msg').length > 0;
  if (!hasMessages) return;

  // No real user turn — just wipe silently, nothing worth saving
  const hasUserTurn = state.conversationHistory.some(m => m.role === 'user');
  if (!hasUserTurn) { await _doNewChat(); return; }

  // Real conversation — ask to confirm
  group.classList.add('visible');
  const dismiss = () => group.classList.remove('visible');
  group.querySelector('.clear-confirm-yes').onclick = async e => {
    e.stopPropagation(); dismiss(); await _doNewChat();
  };
  group.querySelector('.clear-confirm-no').onclick = e => {
    e.stopPropagation(); dismiss();
  };
}


// ── Send button state helper ──────────────────────────────────────────────────

export function setSendBtnState(mode) {
  const btn = document.getElementById('btnSend');
  if (!btn) return;
  if (mode === 'stop') {
    btn.classList.add('is-stop');
    btn.setAttribute('aria-label', 'Stop generation');
    btn.disabled = false;
  } else {
    btn.classList.remove('is-stop');
    btn.setAttribute('aria-label', 'Send');
    btn.disabled = false;
  }
}

// ── Stop any in-flight generation ─────────────────────────────────────────────

export function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
}

// ── Chat send (streaming) ─────────────────────────────────────────────────────

export async function sendChat() {
  const input   = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || state.chatBusy || state.busy) return;

  // Grab any attached file before clearing
  const fileData = getAttachedFile();
  clearAttachedFile();

  state.chatBusy = true;
  input.value = '';
  input.style.height = 'auto';
  setSendBtnState('stop');

  appendUser(message, fileData);
  state.conversationHistory.push({ role: 'user', content: message });

  const subject    = state.currentSubject || 'Other';
  const wantsImage = IMAGE_TRIGGERS.test(message);

  // Create a fresh AbortController for this request
  const controller = new AbortController();
  state.abortController = controller;

  try {
    if (wantsImage) {
      const thinkEl = appendThinking();
      const res  = await fetch(`${API_BASE}/generate-image`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt: message, subject }),
        signal:  controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);

      const reply  = data.caption || "Here's the diagram you asked for.";
      state.conversationHistory.push({ role: 'model', content: reply });
      thinkEl.remove();
      const genImg = data.imageBase64 ? `data:${data.mimeType};base64,${data.imageBase64}` : null;
      appendAI(reply, null, genImg);
      autoSaveSession();

    } else {
      const streamEl = appendStreamingAI();
      let fullReply  = '';
      let thinkingShown = true;

      // Show thinking dots immediately while waiting for first token
      const bubble = streamEl.querySelector('.msg-bubble');
      if (bubble) bubble.innerHTML = '<span class="thinking-dots"><span>·</span><span>·</span><span>·</span></span>';

      const res = await fetch(`${API_BASE}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message,
          history:        state.conversationHistory,
          subject,
          lastComplexity: state.lastComplexity || null,
          fileData:       fileData || null,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Server error ' + res.status);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (!done) buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = done ? '' : lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            let ev;
            try { ev = JSON.parse(raw); } catch (_) { continue; }

            if (ev.subject !== undefined) {
              // If subject actually changed, record a switch marker in history
              // so the practice test generator can detect multi-subject sessions
              if (ev.subject !== state.currentSubject && state.currentSubject && state.currentSubject !== 'Other') {
                state.conversationHistory.push({ role: 'model', content: `Sure, switching to ${ev.subject} now!` });
              }
              state.currentSubject = ev.subject;
              import('./subject.js').then(m => m.updateSubjectBadge(ev.subject));
              updateStreamingLabel(streamEl, ev.subject);
            } else if (ev.complexity !== undefined) {
              state.lastComplexity = ev.complexity;
            } else if (ev.text !== undefined) {
              if (thinkingShown) { thinkingShown = false; }
              fullReply += ev.text;
              updateStreamingBubble(streamEl, fullReply);
            } else if (ev.reply !== undefined || ev.observation !== undefined) {
              finaliseStreamingBubble(streamEl, fullReply);
              state.conversationHistory.push({ role: 'model', content: fullReply });
              autoSaveSession();
            } else if (ev.error) {
              throw new Error(ev.error);
            }
          }

          if (done) {
            if (streamEl.classList.contains('streaming')) {
              finaliseStreamingBubble(streamEl, fullReply);
              state.conversationHistory.push({ role: 'model', content: fullReply });
              autoSaveSession();
            }
            break;
          }
        }
      } catch (e) {
        // Aborted mid-stream — finalise whatever arrived so far
        if (e.name === 'AbortError') {
          if (streamEl.classList.contains('streaming') && fullReply.trim()) {
            finaliseStreamingBubble(streamEl, fullReply);
            state.conversationHistory.push({ role: 'model', content: fullReply });
          } else if (streamEl.classList.contains('streaming')) {
            streamEl.remove(); // nothing was received yet — remove dots bubble
          }
          // Clean up any empty trailing assistant entries left in history
          while (
            state.conversationHistory.length > 0 &&
            state.conversationHistory.at(-1).role === 'model' &&
            !state.conversationHistory.at(-1).content?.trim()
          ) { state.conversationHistory.pop(); }
        } else {
          throw e;
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      // Aborted before fetch connected — remove the dots bubble if it exists
      if (typeof streamEl !== 'undefined' && streamEl?.classList.contains('streaming')) {
        streamEl.remove();
      }
    } else {
      showToast('Chat error: ' + e.message);
    }
  } finally {
    state.chatBusy = false;
    state.abortController = null;
    setSendBtnState('send');
    scrollMsgs();
  }
}

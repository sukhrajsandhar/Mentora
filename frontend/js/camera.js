// ── camera.js ─────────────────────────────────────────────────────────────────
import { state }           from './state.js';
import { setStatus, showToast, nowTime } from './ui.js';
import {
  appendSys, removeSysMsgs,
  appendStreamingAI, updateStreamingBubble, updateStreamingBubbleMarkdown, finaliseStreamingBubble,
  updateStreamingLabel, setSendBtnState,
} from './messages.js';
import { updateSubjectBadge } from './subject.js';

import { API_BASE } from './config.js';

// ── Start ─────────────────────────────────────────────────────────────────────
export async function startCamera() {
  const video       = document.getElementById('video');
  const camIdle     = document.getElementById('camIdle');
  const camBrackets = document.getElementById('camBrackets');
  const camNudge    = document.getElementById('camNudge');

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = state.stream;
    video.classList.add('active');
    camIdle.classList.add('gone');
    camBrackets.classList.add('show');
    camNudge.classList.add('visible');
    document.querySelector('.cam-viewport')?.classList.add('live');

    setStatus('live', 'Live');
    document.getElementById('btnStart').disabled   = true;
    document.getElementById('btnStop').disabled    = false;
    document.getElementById('btnAnalyze').disabled = false;
  } catch (e) {
    showToast('Camera error: ' + e.message);
  }
}

// ── Stop ──────────────────────────────────────────────────────────────────────
export function stopCamera() {
  const video       = document.getElementById('video');
  const camIdle     = document.getElementById('camIdle');
  const camBrackets = document.getElementById('camBrackets');
  const camNudge    = document.getElementById('camNudge');

  state.stream?.getTracks().forEach(t => t.stop());
  state.stream      = null;
  video.srcObject   = null;
  video.classList.remove('active');
  camIdle.classList.remove('gone');
  camBrackets.classList.remove('show');
  camNudge.classList.remove('visible');
  document.querySelector('.cam-viewport')?.classList.remove('live');
  state.hasAnalyzed    = false;
  state.currentSubject = 'Other';

  setStatus('off', 'Camera offline');
  document.getElementById('btnStart').disabled   = false;
  document.getElementById('btnStop').disabled    = true;
  document.getElementById('btnAnalyze').disabled = true;
}

// ── Analyze (streaming) ───────────────────────────────────────────────────────
export async function analyzeFrame() {
  if (!state.stream || state.busy || state.chatBusy) return;
  state.busy = true;

  const video    = document.getElementById('video');
  const canvas   = document.getElementById('canvas');
  const ctx      = canvas.getContext('2d');
  const camScan  = document.getElementById('camScan');
  const camNudge = document.getElementById('camNudge');
  const btn      = document.getElementById('btnAnalyze');

  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Analyzing…';
  camScan.classList.add('active');
  setStatus('busy', 'Analyzing…');
  setSendBtnState('stop');  // ← flip send → stop

  // Capture frame — counter-mirror because CSS mirrors the live preview
  canvas.width  = video.videoWidth  || 1280;
  canvas.height = video.videoHeight || 720;
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  const b64 = canvas.toDataURL('image/jpeg', 0.88).split(',')[1];

  // Update thumbnail
  const thumb     = document.getElementById('camThumb');
  const thumbTime = document.getElementById('camThumbTime');
  const thumbWrap = document.getElementById('camThumbWrap');
  if (thumb) {
    thumb.src = 'data:image/jpeg;base64,' + b64;
    if (thumbWrap) thumbWrap.style.display = '';
  }
  if (thumbTime) thumbTime.textContent = nowTime();

  camNudge.classList.remove('visible');
  state.hasAnalyzed = true;
  state.frameCount++;
  appendSys('Analyzing frame ' + state.frameCount + '…');

  // AbortController for this analysis
  const controller = new AbortController();
  state.abortController = controller;

  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        image: b64,
        subjectOverride: state.subjectManuallySet ? state.currentSubject : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Server error ' + res.status);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    removeSysMsgs();

    // Show thinking dots immediately while waiting for first token
    let streamEl = appendStreamingAI();
    const _thinkBubble = streamEl.querySelector('.msg-bubble');
    if (_thinkBubble) _thinkBubble.innerHTML = '<span class="thinking-dots"><span>·</span><span>·</span><span>·</span></span>';
    let fullText = '';

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
            updateSubjectBadge(ev.subject);
            if (streamEl) updateStreamingLabel(streamEl, ev.subject);
            state.conversationHistory.push({ role: 'user', content: '[Student showed a whiteboard/notebook frame]' });
          } else if (ev.text !== undefined) {
            fullText += ev.text;
            updateStreamingBubbleMarkdown(streamEl, fullText);
          } else if (ev.observation !== undefined || ev.done !== undefined) {
            if (streamEl) {
              finaliseStreamingBubble(streamEl, fullText);
              state.conversationHistory.push({ role: 'model', content: fullText });
              if (window.mobileTab && window.innerWidth <= 700) window.mobileTab('chat');
            }
          } else if (ev.error) {
            throw new Error(ev.error);
          }
        }

        if (done) {
          if (streamEl && streamEl.classList.contains('streaming')) {
            finaliseStreamingBubble(streamEl, fullText);
            state.conversationHistory.push({ role: 'model', content: fullText });
          }
          break;
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        removeSysMsgs();
        if (streamEl && streamEl.classList.contains('streaming') && fullText) {
          finaliseStreamingBubble(streamEl, fullText);
          state.conversationHistory.push({ role: 'model', content: fullText });
        } else if (streamEl && streamEl.classList.contains('streaming')) {
          streamEl.remove();
        }
      } else {
        throw e;
      }
    }

  } catch (e) {
    if (e.name !== 'AbortError') {
      removeSysMsgs();
      showToast('Error: ' + e.message);
    }
  } finally {
    state.busy = false;
    state.abortController = null;
    setSendBtnState('send');  // ← flip stop → send
    document.getElementById('camScan').classList.remove('active');
    setStatus('live', 'Live');
    btn.classList.remove('loading');
    btn.classList.add('done');
    btn.textContent = 'Done ✓';
    setTimeout(() => {
      btn.classList.remove('done');
      btn.textContent = 'Analyze';
      btn.disabled    = false;
    }, 1400);
  }
}

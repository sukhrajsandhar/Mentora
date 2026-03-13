// ── voice.js ──────────────────────────────────────────────────────────────────
// Gemini Live API — real-time voice + video tutoring.
// Subject is set exclusively via the dropdown — no auto-detection.

import { startWaveform, stopWaveform, setWaveformAISpeaking } from './waveform.js';
import { startCamera, stopCamera } from './camera.js';
import { state }           from './state.js';
import { showToast }       from './ui.js';
import { DOC_TRIGGERS, liveDocPrompt, PERSONA_NAMES } from './prompts.js';
import { detectVoiceSwitch, detectStudentSwitch } from './subjectMap.js';
import {
  clearEmpty, scrollMsgs,
  appendStreamingAI, updateStreamingBubble, updateStreamingBubbleMarkdown, updateStreamingBubbleLive, finaliseStreamingBubble,
  cancelMathRender,
  appendSysLive, appendSys, appendSysHtml, removeSysMsgs,
} from './messages.js';
import { autoSaveSession } from './history.js';

import { API_BASE, WS_BASE } from './config.js';
const WS_URL   = `${WS_BASE}/live`;
const CHAT_URL = `${API_BASE}/chat`;
const IN_RATE   = 16000;
const OUT_RATE  = 24000;
const CHUNK_SZ  = 2048;
const VIDEO_FPS = 8;
const JPEG_Q    = 0.7;

// Phrases that explicitly mean "look at the camera view right now"
// Deliberately narrow — avoids "check again" (could mean check my answer)
const CAMERA_LOOK_RE = /\b(what (do you see|can you see|are you seeing)(( through| on| in)? the camera)?|look (through |at )?(the camera|the (live )?feed)|what (does the |is on the )?camera show|what('?s| is) (on |in |through )?the camera|do you see (anything |something )?(different|new|changed?)|the (view|scene|camera) (has |might have )?changed|i (moved|changed|updated|switched) (the |what's in )?the camera|look at (this|that) (on |through )?the camera)\b/i;

// ── Module state ──────────────────────────────────────────────────────────────

let ws           = null;
let micCtx       = null;
let playCtx      = null;
let gainNode     = null;
let analyserNode = null;
let processor    = null;
let micStream    = null;
let isLive       = false;
let greetingSent = false;
let ttsEnabled   = true;
let volume       = 0.5;
const MASTER_GAIN = 0.4; // overall volume ceiling
let nextPlayTime = 0;

// Video
let vidStream    = null;
let vidInterval  = null;
let vidCanvas    = null;
let vidCtx2d     = null;
let videoEnabled = false;
let userCameraOn = true;  // tracks user's explicit toggle choice
let videoSource  = 'camera'; // 'camera' | 'screen'
let screenStream = null;     // active getDisplayMedia stream

// Session timer
let timerInterval = null;
let timerStart    = null;

// Clear any stale timer display on load (browser cache can restore DOM state)
document.addEventListener('DOMContentLoaded', () => {
  const timerEl = document.getElementById('liveSessionTimer');
  if (timerEl) timerEl.textContent = '';
});

// The subject this session was started with — read from dropdown at session start.
// To change persona: end session, pick subject from dropdown, start again.
let sessionSubject = 'Other';

// ── Per-persona voices ────────────────────────────────────────────────────────
const PERSONA_VOICES = {
  Math:            'Aoede',    // clear, precise — Prof. Maya
  Physics:         'Orus',     // measured, thoughtful — Dr. Arun
  Chemistry:       'Kore',     // warm, enthusiastic — Dr. Sofia
  Biology:         'Leda',     // curious, naturalistic — Dr. Kezia
  ComputerScience: 'Puck',     // direct, pragmatic — Alex
  History:         'Charon',   // narrative, authoritative — Prof. James
  Literature:      'Zephyr',   // lyrical, reflective — Prof. Claire
  Economics:       'Fenrir',   // analytical, confident — Prof. David
  Other:           'Aoede',    // warm generalist — Sam
};

// Active streaming bubbles
let currentAIBubble   = null;
let currentUserBubble = null;
let aiAccum           = '';
let userAccum         = '';

// Queued intro message to send after a silent WS restart
let pendingIntro = null;
let pendingSwitchSubject = null;
let pendingCameraReset   = false;

// Active audio sources — tracked so we can stop them all on interrupt
const activeSources  = new Set();
let   skipTurn       = false; // when true, discard transcript/audio until next turn_complete

// Abort controller for background fetches (reformat, streamDoc)
let voiceFetchController = null;

// VAD
let vadFrames        = 0;
const VAD_THRESH     = 0.015;
const VAD_FRAMES_REQ = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Join transcript chunks with a space only when needed.
// Gemini Live sends chunks that sometimes have leading/trailing spaces and
// sometimes don't — naively concatenating causes "wordsmashed" or "word  doubled".
function joinChunk(acc, chunk) {
  if (!acc) return chunk;
  const needsSpace = acc.length > 0
    && !/\s$/.test(acc)        // acc doesn't end with whitespace
    && !/^[\s.,!?;:)]/.test(chunk); // chunk doesn't start with space or punctuation
  return acc + (needsSpace ? ' ' : '') + chunk;
}

// Fix speech-to-text artefact where acronyms get spaced out:
// "G P U" → "GPU", "G PU" → "GPU", "CP U" → "CPU"
// Leaves real single-letter words (I, A, O, U) alone.
const _realSingleWords = new Set(['I', 'A', 'O', 'U']);
function fixSpacedLetters(text) {
  // Pass 1: 3+ fully-spaced letters "G P U" → "GPU"
  text = text.replace(/\b([A-Z])( [A-Z]){2,}\b/g, m => m.replace(/ /g, ''));
  // Pass 2: leading split " G PU" → " GPU"
  text = text.replace(/ ([A-Z]) ([A-Z]{2,5})(?= |[.,!?]|$)/g, (m, a, b) =>
    _realSingleWords.has(a) ? m : ' ' + a + b);
  // Pass 3: trailing split " GPU U" → " GPU" (rare but seen with "C P U")
  text = text.replace(/ ([A-Z]{2,5}) ([A-Z])(?= |[.,!?]|$)/g, (m, a, b) =>
    _realSingleWords.has(b) ? m : ' ' + a + b);
  return text;
}

function voiceTutorName() {
  return PERSONA_NAMES[sessionSubject] || 'Sam';
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function toggleVoice() {
  if (isLive) stopLive(); else await startLive();
}

export function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  if (gainNode) gainNode.gain.value = ttsEnabled ? volume * MASTER_GAIN : 0;
  const checkbox = document.getElementById('ttsToggleCheck');
  if (checkbox) checkbox.checked = ttsEnabled;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, parseFloat(v)));
  if (gainNode && ttsEnabled) gainNode.gain.value = volume * MASTER_GAIN;
  const slider = document.getElementById('volumeSlider');
  if (slider) slider.style.setProperty('--val', Math.round(volume * 100));
}

export function stopSpeaking()       { interruptPlayback(true); }
export async function startLiveWithCamera() { await startLive(); }
export function stopLiveSession()    { if (isLive) stopLive(); }

export async function toggleLiveCamera() {
  const btn     = document.getElementById('btnLiveCam');
  userCameraOn = !userCameraOn;
  videoEnabled = userCameraOn;
  if (userCameraOn) {
    await startCamera();
    await startVideo();
    startFrameLoop();
    btn?.classList.add('active');
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text: 'The student turned their camera back on. Reply with exactly: "Oh, your camera is back on again."' }));
    }
  } else {
    stopFrameLoop();
    stopVideo();
    stopCamera();
    btn?.classList.remove('active');
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text: 'The student turned their camera off. You can no longer see a live feed, but you do remember what you last saw. If asked whether you can see them, say something like "I can\'t see you live right now, but I remember what I last saw." Reply with exactly: "You have turned your camera off."' }));
    }
  }
}

// ── Video source switching (camera ↔ screen share) ────────────────────────────

export async function setVideoSource(source) {
  // Clicking the active source toggles it off
  if (source === videoSource && videoEnabled) {
    stopFrameLoop();
    stopVideo();
    if (videoSource === 'camera') stopCamera();
    videoEnabled = false;
    videoSource  = 'none';
    document.getElementById('btnLiveCam')?.classList.remove('active');
    document.getElementById('btnLiveScreen')?.classList.remove('active');
    return;
  }

  // Stop current video before switching
  stopFrameLoop();
  stopVideo();
  if (videoSource === 'camera') stopCamera();

  videoSource = source;

  // Update button states
  document.getElementById('btnLiveCam')?.classList.toggle('active', source === 'camera');
  document.getElementById('btnLiveScreen')?.classList.toggle('active', source === 'screen');

  if (!isLive) return; // session not running — just track the choice

  // Start new source
  if (source === 'camera') {
    await startCamera();
    userCameraOn = true;
    videoEnabled = true;
  }
  await startVideo();
  startFrameLoop();
}

let micMuted = false;

export function toggleLiveMic() {
  const btn = document.getElementById('btnLiveMic');
  micMuted = !micMuted;
  if (micMuted) {
    if (processor) processor._muted = true;
    btn?.classList.remove('active');
  } else {
    if (processor) processor._muted = false;
    btn?.classList.add('active');
  }
}

// ── Live camera ───────────────────────────────────────────────────────────────

async function startVideo() {
  try {
    if (videoSource === 'screen') {
      // Screen share — get display media and pipe into a hidden video element
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        // User stopped sharing from browser UI — switch back to camera
        setVideoSource('camera');
      });
      const screenVideo = document.createElement('video');
      screenVideo.srcObject = screenStream;
      screenVideo.autoplay  = true;
      screenVideo.muted     = true;
      screenVideo.id        = 'screenShareVideo';
      screenVideo.style.display = 'none';
      document.body.appendChild(screenVideo);

      // Also show screen feed in the sidebar viewport (no mirror flip for screen)
      const sidebarVideo = document.getElementById('video');
      if (sidebarVideo) {
        sidebarVideo.srcObject = screenStream;
        sidebarVideo.classList.add('active', 'no-mirror');
      }

      vidStream        = screenStream;
      vidCanvas        = document.createElement('canvas');
      vidCanvas.width  = 1280;
      vidCanvas.height = 720;
      vidCtx2d         = vidCanvas.getContext('2d');
      videoEnabled     = true;
      if (isLive && ws?.readyState === WebSocket.OPEN) startFrameLoop();
    } else {
      // Camera — existing behaviour unchanged
      const sidebarVideo = document.getElementById('video');
      if (!sidebarVideo || !sidebarVideo.srcObject) return;
      vidStream        = sidebarVideo.srcObject;
      vidCanvas        = document.createElement('canvas');
      vidCanvas.width  = 640;
      vidCanvas.height = 480;
      vidCtx2d         = vidCanvas.getContext('2d');
      videoEnabled     = userCameraOn;
      if (isLive && ws?.readyState === WebSocket.OPEN && videoEnabled) startFrameLoop();
    }
  } catch (e) {
    showToast('Video error: ' + e.message);
  }
}

function stopVideo() {
  stopFrameLoop();
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    document.getElementById('screenShareVideo')?.remove();
    // Restore webcam feed in sidebar if camera stream still active
    const sidebarVideo = document.getElementById('video');
    if (sidebarVideo && state.stream) sidebarVideo.srcObject = state.stream;
    sidebarVideo?.classList.remove('no-mirror');
  }
  vidStream = null; videoEnabled = false; vidCanvas = null; vidCtx2d = null;
}

// ── Frame change detection ────────────────────────────────────────────────────
// Compare a downsampled version of the current frame against the last *sent*
// frame.  A frame is only forwarded to Gemini when it differs enough, OR when
// a minimum heartbeat interval has elapsed so Gemini never goes fully blind.
//
// Tuning knobs (all in one place):
const DIFF_SAMPLE_W   = 64;    // width  of the diff thumbnail (pixels)
const DIFF_SAMPLE_H   = 36;    // height of the diff thumbnail (pixels)
const DIFF_THRESHOLD  = 0.01;  // fraction of pixels that must change  (0–1)
const DIFF_PIXEL_GATE = 15;    // per-channel delta to count as "changed"
const HEARTBEAT_MS    = 4000;  // always send at least one frame per this interval

let _diffCanvas  = null;   // tiny canvas used only for diffing
let _diffCtx     = null;
let _prevPixels  = null;   // Uint8Array of last-sent frame's diff thumbnail
let _lastSentAt  = 0;      // timestamp of last frame actually sent

function _getDiffCanvas() {
  if (!_diffCanvas) {
    _diffCanvas = document.createElement('canvas');
    _diffCanvas.width  = DIFF_SAMPLE_W;
    _diffCanvas.height = DIFF_SAMPLE_H;
    _diffCtx = _diffCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: _diffCanvas, ctx: _diffCtx };
}

/**
 * Returns true if the current vidCanvas content differs enough from the
 * last sent frame, or if the heartbeat interval has elapsed.
 * Also updates _prevPixels to the current frame when returning true.
 */
function _frameHasChanged() {
  const now = performance.now();

  // Always send on heartbeat so Gemini stays aware of static scenes
  if (now - _lastSentAt >= HEARTBEAT_MS) return true;

  const { ctx } = _getDiffCanvas();

  // Draw the full vidCanvas down to the tiny diff canvas (mirroring already applied)
  ctx.drawImage(vidCanvas, 0, 0, DIFF_SAMPLE_W, DIFF_SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, DIFF_SAMPLE_W, DIFF_SAMPLE_H);

  if (!_prevPixels) {
    // First frame — always send
    _prevPixels = new Uint8Array(data);
    return true;
  }

  // Count pixels whose R, G, or B channel changed beyond the gate
  let changedPixels = 0;
  const total = DIFF_SAMPLE_W * DIFF_SAMPLE_H;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i]     - _prevPixels[i])     > DIFF_PIXEL_GATE ||
      Math.abs(data[i + 1] - _prevPixels[i + 1]) > DIFF_PIXEL_GATE ||
      Math.abs(data[i + 2] - _prevPixels[i + 2]) > DIFF_PIXEL_GATE
    ) {
      changedPixels++;
    }
  }

  if (changedPixels / total >= DIFF_THRESHOLD) {
    _prevPixels = new Uint8Array(data);  // update reference
    return true;
  }

  return false;
}

function _resetDiffState() {
  _prevPixels = null;
  _lastSentAt = 0;
}

function startFrameLoop() {
  // Always clear any existing interval — never silently bail if one is running
  if (vidInterval) { clearInterval(vidInterval); vidInterval = null; }
  _resetDiffState();
  vidInterval = setInterval(() => {
    const sidebarVideo = document.getElementById('video');
    if (!vidCtx2d || !vidCanvas || ws?.readyState !== WebSocket.OPEN) return;
    if (!videoEnabled) return;  // camera toggled off — skip sending frames
    const src = sidebarVideo && sidebarVideo.videoWidth > 0 ? sidebarVideo : null;
    if (!src) return;

    // Draw current frame — mirror flip for camera, no flip for screen share
    vidCanvas.width  = src.videoWidth  || 640;
    vidCanvas.height = src.videoHeight || 480;
    vidCtx2d.save();
    if (videoSource === 'camera') {
      vidCtx2d.translate(vidCanvas.width, 0);
      vidCtx2d.scale(-1, 1);
    }
    vidCtx2d.drawImage(src, 0, 0);
    vidCtx2d.restore();

    // Only send if the scene has changed (or heartbeat is due)
    if (!_frameHasChanged()) return;

    const b64 = vidCanvas.toDataURL('image/jpeg', JPEG_Q).split(',')[1];
    if (b64 && videoEnabled) {
      ws.send(JSON.stringify({ type: 'video', data: b64 }));
      _lastSentAt = performance.now();
    }
  }, 1000 / VIDEO_FPS);
}

function stopFrameLoop() {
  if (vidInterval) { clearInterval(vidInterval); vidInterval = null; }
  _resetDiffState();
}

// ── Sidebar UI ────────────────────────────────────────────────────────────────

function setLiveSessionState(s) {
  const dot     = document.getElementById('liveStatusDot');
  const label   = document.getElementById('liveStatusLabel');
  const btn     = document.getElementById('btnLiveSession');
  const overlay = document.getElementById('liveOverlay');
  const micSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`;
  const xSvg    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  if (s === 'live') {
    dot?.classList.add('active');
    if (label) label.textContent = 'Session active';
    if (btn)   { btn.disabled = false; btn.classList.add('btn-live-active'); btn.innerHTML = `${xSvg} End Chat`; }
    overlay?.classList.add('active');
    // Start session timer
    timerStart = Date.now();
    const timerEl = document.getElementById('liveSessionTimer');
    if (timerEl) timerEl.textContent = '0:00';
    timerInterval = setInterval(() => {
      if (!timerStart) return;
      const elapsed = Math.floor((Date.now() - timerStart) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = String(elapsed % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);
  } else if (s === 'connecting') {
    dot?.classList.remove('active'); dot?.classList.add('connecting');
    if (label) label.textContent = 'Connecting…';
    if (btn)   { btn.disabled = true; }
    overlay?.classList.remove('active');
  } else {
    dot?.classList.remove('active', 'connecting');
    if (label) label.textContent = 'Ready to connect';
    if (btn)   { btn.disabled = false; btn.classList.remove('btn-live-active'); btn.innerHTML = `${micSvg} Start Chat`; }
    overlay?.classList.remove('active');
    // Stop and reset timer
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerStart = null;
    const timerEl = document.getElementById('liveSessionTimer');
    if (timerEl) timerEl.textContent = '';
  }
}

// ── Mid-session subject switch (dropdown change while live) ───────────────────
// Silently restarts the Gemini WebSocket with the new voice + persona.
// Mic and audio contexts stay alive — invisible to the user.

// Holds the temporary "Connecting…" sys message so we can remove it on ready.
let switchingMsg = null;
// Holds the initial "Setting up your tutor…" sys message — kept separately so
// a mid-connect subject switch can clear it before replacing with "Calling X…"
let setupMsg = null;
// Confirmation text to show on first transcript chunk after a subject switch.
let pendingConfirm = null;

function onDropdownChange(e) {
  if (!isLive) return;
  const picked = e.detail;
  if (!picked || picked === 'Auto' || picked === sessionSubject) return;

  sessionSubject           = picked;
  state.currentSubject     = picked;
  state.subjectManuallySet = true;
  import('./subject.js').then(m => m.updateSubjectBadge(picked));

  // Record the switch in history so practice-test segment detection picks it up
  state.conversationHistory.push({ role: 'system', subject: picked, type: 'subject_switch' });

  restartGeminiWs(picked);
}

async function restartGeminiWs(newSubject, silent = false) {
  // 1. Stop current playback and wipe any in-flight bubbles
  interruptPlayback();
  skipTurn = true;
  if (currentAIBubble)   { currentAIBubble.remove();   currentAIBubble   = null; aiAccum   = ''; }
  if (currentUserBubble) { currentUserBubble.remove(); currentUserBubble = null; userAccum = ''; }

  // Show "connecting" indicator — skip for silent camera resets
  const newName = PERSONA_NAMES[newSubject] || 'Sam';
  if (!silent) {
    if (setupMsg)    { setupMsg.remove();    setupMsg    = null; }
    if (switchingMsg && switchingMsg !== setupMsg) { switchingMsg.remove(); }
    switchingMsg = appendSysHtml(`Calling ${newName} for ${newSubject} <span class="thinking-dots"><span>·</span><span>·</span><span>·</span></span>`);
  }

  // 2. Close old Gemini WS quietly — strip all handlers first so onclose
  //    doesn't trigger stopLive() while we're mid-restart.
  if (ws) {
    const oldWs  = ws;
    ws           = null;
    oldWs.onclose   = null;
    oldWs.onerror   = null;
    oldWs.onmessage = null;
    try { oldWs.close(); } catch (_) {}
  }

  // 3. Brief pause to let the old connection drain
  await new Promise(r => setTimeout(r, 150));

  // 4. Open a new Gemini WS with the new voice — reuse existing mic/audio contexts
  const newVoice = PERSONA_VOICES[newSubject] || 'Aoede';

  setLiveSessionState('connecting');

  // For camera resets: keep conversation history but strip visual descriptions
  // so Gemini remembers the lesson but not what it previously saw on camera
  const historyForSetup = silent
    ? state.conversationHistory.slice(-10).map(m => {
        if (m.role !== 'model') return m;
        // Remove sentences that describe camera/visual content
        const scrubbed = m.content
          .replace(/I (can |still )?(see|notice|observe)[^.!?]*[.!?]/gi, '')
          .replace(/[Tt]he (view|camera|frame)[^.!?]*[.!?]/gi, '')
          .replace(/[Ii]t looks like[^.!?]*camera[^.!?]*[.!?]/gi, '')
          .trim();
        return { ...m, content: scrubbed || m.content };
      })
    : state.conversationHistory.slice(-6);

  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type:           'setup',
      subject:        newSubject,
      voice:          newVoice,
      isFirstSession: false,
      history:        historyForSetup,
    }));
  };
  ws.onmessage = (e) => handleMsg(JSON.parse(e.data));
  ws.onerror   = () => { showToast('Live voice error — is backend running?'); stopLive(); };
  ws.onclose   = () => { if (isLive) stopLive(); };

  // 5. Queue intro — silent resets ask Gemini to describe current frame, no greeting
  if (silent) {
    pendingIntro   = `You are ${newName}, the ${newSubject} tutor, continuing the same session. The student just asked what you can see on camera. Look ONLY at the live camera frame right now and describe what you see. Do NOT reference what you saw before.`;
    pendingConfirm = null;
  } else {
    pendingIntro   = `You are now ${newName}, the ${newSubject} tutor. The student just switched to you. Say only: "Hi, I'm ${newName} — your ${newSubject} tutor. What are we working on?" — nothing else.`;
    pendingConfirm = `Now with ${newName} — ${newSubject}`;
  }
}

async function resetCameraContext() {
  if (!isLive) return;
  const subject = sessionSubject || state.currentSubject || 'Other';
  await restartGeminiWs(subject, true);
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

async function startLive() {
  if (state.chatBusy || state.busy) { showToast('Wait for current response to finish.'); return; }

  // Read subject from custom dropdown at session-start
  const activeOpt = document.querySelector('#subjectSelectMenu .subject-select-option.active');
  const picked    = activeOpt?.dataset?.value || 'Auto';
  sessionSubject  = (picked && picked !== 'Auto') ? picked : 'Other';

  // Keep state in sync
  if (sessionSubject !== 'Other') {
    state.currentSubject     = sessionSubject;
    state.subjectManuallySet = true;
    import('./subject.js').then(m => m.updateSubjectBadge(sessionSubject));
    // Anchor the first segment so ptDetectSubjectSegments knows where the session started
    state.conversationHistory.push({ role: 'system', subject: sessionSubject, type: 'subject_switch' });
  }

  // Watch dropdown for mid-session subject changes
  const dropdown = document.getElementById('subjectOverride');
  dropdown?.addEventListener('subjectchange', onDropdownChange);

  setLiveSessionState('connecting');
  setMicState('processing');

  const tutorName = sessionSubject !== 'Other' ? (PERSONA_NAMES[sessionSubject] || 'Sam') : 'Sam';

  try {
    // Start camera if not already running — camera + mic both start on "Start Chat"
    if (!state.stream) await startCamera();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: IN_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micCtx   = new AudioContext({ sampleRate: IN_RATE });
    playCtx  = new AudioContext({ sampleRate: OUT_RATE });
    gainNode = playCtx.createGain();
    gainNode.gain.value = ttsEnabled ? volume * MASTER_GAIN : 0;
    gainNode.connect(playCtx.destination);
    nextPlayTime = playCtx.currentTime;

    ws           = new WebSocket(WS_URL);
    ws.onopen    = () => {
      ws.send(JSON.stringify({
        type: 'setup',
        subject: sessionSubject,
        voice: PERSONA_VOICES[sessionSubject] || 'Aoede',
        isFirstSession: true,
        history: state.conversationHistory.slice(-6),
      }));
    };
    ws.onmessage = (e) => handleMsg(JSON.parse(e.data));
    ws.onerror   = () => { showToast('Live voice error — is backend running?'); stopLive(); };
    ws.onclose   = () => { if (isLive) stopLive(); };
  } catch (e) {
    showToast('Mic error: ' + e.message);
    setLiveSessionState('idle');
    setMicState('idle');
  }
}

function handleMsg(msg) {
  switch (msg.type) {

    case 'ready':
      isLive = true;
      skipTurn = false;
      setMicState('live');
      setLiveSessionState('live');
      if (!processor)    startMic().catch(e => { showToast('Mic error: ' + e.message); stopLive(); });
      if (!videoEnabled && userCameraOn) startVideo().then(() => {
        document.getElementById('btnLiveCam')?.classList.add('active');
      });
      if (videoEnabled)  startFrameLoop();

      // Sync mic button — reset mute state on new session
      micMuted = false;
      if (processor) processor._muted = false;
      document.getElementById('btnLiveMic')?.classList.add('active');

      if (pendingIntro) {
        // Silent restart — send new persona intro
        const intro = pendingIntro;
        pendingIntro = null;
        setTimeout(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'text', text: intro }));
          }
        }, 300);
      } else if (!greetingSent) {
        // Fresh session start — only ever runs once per session
        greetingSent = true;
        appendSysLive('🎙 Live Tutor — speak freely. Click "End Chat" to stop.');
        setupMsg = appendSysHtml(`Setting up your tutor${sessionSubject !== 'Other' ? ` — ${voiceTutorName()}` : ''} <span class="thinking-dots"><span>·</span><span>·</span><span>·</span></span>`);
        switchingMsg = setupMsg;
        setTimeout(() => {
          if (ws?.readyState !== WebSocket.OPEN) return;
          if (sessionSubject === 'Other') {
            ws.send(JSON.stringify({
              type: 'text',
              text: `Greet the student in one short sentence. Then say: "Pick your subject from the dropdown at the top, or say 'switch to' and a subject name — you can switch any time. What would you like to work on today?"`,
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'text',
              text: `You are ${voiceTutorName()}, the ${sessionSubject} tutor. Say only your name and subject in one short sentence then wait. Example: "Hi, I'm ${voiceTutorName()} — your ${sessionSubject} tutor. What are we working on?"`,
            }));
          }
        }, 500);
      }
      break;

    case 'audio':
      if (!skipTurn) scheduleAudio(msg.data);
      break;

    case 'transcript_out':
      if (!skipTurn && msg.text) {
        // Remove switching sys message on first AI speech
        if (switchingMsg) { switchingMsg.remove(); switchingMsg = null; }
        // First transcript chunk from new tutor — swap connecting msg for confirmation
        if (pendingConfirm) {
          appendSysLive(pendingConfirm);
          pendingConfirm = null;
        }
        // Once a switch is detected, stop accumulating — no more chunks should extend the message
        if (!pendingSwitchSubject) {
          aiAccum = joinChunk(aiAccum, msg.text); updateVoiceAIBubble(fixSpacedLetters(aiAccum));
        }

        // Detect verbal subject switch — "switching to X now"
        const detectedSwitch = detectVoiceSwitch(aiAccum);
        if (detectedSwitch && detectedSwitch !== sessionSubject && !pendingSwitchSubject) {
          pendingSwitchSubject = detectedSwitch;
          state.currentSubject     = detectedSwitch;
          state.subjectManuallySet = true;
          import('./subject.js').then(m => m.updateSubjectBadge(detectedSwitch));

          // Record the switch in history so practice-test segment detection picks it up
          state.conversationHistory.push({ role: 'system', subject: detectedSwitch, type: 'subject_switch' });
          const menu = document.getElementById('subjectSelectMenu');
          if (menu) menu.querySelectorAll('.subject-select-option').forEach(o => o.classList.toggle('active', o.dataset.value === detectedSwitch));
          const valueEl = document.getElementById('subjectSelectValue');
          if (valueEl) valueEl.textContent = detectedSwitch === 'ComputerScience' ? 'CS' : detectedSwitch;

          // Truncate text to just "Sure, switching to X now!" — drop anything after
          const cutIdx = aiAccum.search(/now[!.]/i);
          if (cutIdx !== -1) { aiAccum = aiAccum.slice(0, cutIdx + 4).trim(); updateVoiceAIBubble(aiAccum); }
        }
      }
      break;

    case 'transcript_in':
      if (!skipTurn && msg.text) { userAccum = joinChunk(userAccum, msg.text); updateVoiceUserBubble(fixSpacedLetters(userAccum)); }
      // Show thinking dots in AI bubble while waiting for response
      if (!currentAIBubble) {
        currentAIBubble = appendStreamingAI(voiceTutorName(), '🎙');
        const _b = currentAIBubble.querySelector('.msg-bubble');
        if (_b) _b.innerHTML = '<span class="thinking-dots"><span>·</span><span>·</span><span>·</span></span>';
      }
      break;

    case 'turn_complete':
      if (skipTurn) {
        skipTurn = false;
        aiAccum = ''; userAccum = '';
        if (currentAIBubble)   { currentAIBubble.remove();   currentAIBubble   = null; }
        if (currentUserBubble) { currentUserBubble.remove(); currentUserBubble = null; }
        break;
      } {
      const spokenText = aiAccum.trim();
      const userText   = userAccum.trim();

      finaliseVoiceUserBubble();

      if (spokenText) {
        if (userText) state.conversationHistory.push({ role: 'user', content: userText });
        state.conversationHistory.push({ role: 'model', content: spokenText });
        finaliseStreamingBubble(currentAIBubble, spokenText, { skipExport: true });
        currentAIBubble = null;
        aiAccum = '';
      } else {
        finaliseVoiceAIBubble();
        if (userText) {
          state.conversationHistory.push({ role: 'user', content: userText });
        }
      }

      // Auto-save after every completed voice turn
      autoSaveSession();

      if (userText && DOC_TRIGGERS.test(userText)) streamDoc(userText);

      // Detect explicit "switch to X" from student
      if (userText && !pendingSwitchSubject) {
        const studentSwitch = detectStudentSwitch(userText);
        if (studentSwitch && studentSwitch !== sessionSubject) {
          pendingSwitchSubject = studentSwitch;
          // Write marker immediately from student intent — don't wait for AI confirmation
          state.conversationHistory.push({ role: 'system', subject: studentSwitch, type: 'subject_switch' });
        }
      }

      // Detect camera-look request (only if no subject switch pending)
      if (userText && videoEnabled && !pendingSwitchSubject && CAMERA_LOOK_RE.test(userText)) {
        pendingCameraReset = true;
      }

      // Fire switch now that turn is complete
      if (pendingSwitchSubject) {
        const switchTo = pendingSwitchSubject;
        pendingSwitchSubject = null;
        pendingCameraReset   = false;
        sessionSubject = switchTo;
        setTimeout(() => restartGeminiWs(switchTo), 200);
      } else if (pendingCameraReset) {
        pendingCameraReset = false;
        setTimeout(() => resetCameraContext(), 200);
      }
      break;
    }

    case 'interrupted':
      interruptPlayback();
      finaliseVoiceAIBubble();
      break;

    case 'error':
      showToast('Live: ' + msg.error);
      stopLive();
      break;
  }
}

function stopLive() {
  isLive               = false;
  greetingSent         = false;
  sessionSubject       = 'Other';
  pendingSwitchSubject = null;
  pendingCameraReset   = false;
  skipTurn       = false;
  micMuted       = false;
  userCameraOn   = true;

  // Cancel any in-flight reformat or streamDoc fetch
  if (voiceFetchController) {
    voiceFetchController.abort();
    voiceFetchController = null;
  }

  // Reset device button states
  document.getElementById('btnLiveCam')?.classList.remove('active');
  document.getElementById('btnLiveMic')?.classList.remove('active');
  document.getElementById('camOffOverlay')?.classList.remove('active');

  stopFrameLoop();
  stopVideo();
  stopCamera();                                      // ← stop camera + reset camera UI
  processor?.disconnect();    processor    = null;
  analyserNode?.disconnect(); analyserNode = null;
  stopWaveform();                                    // ← waveform cleanup
  micStream?.getTracks().forEach(t => t.stop()); micStream = null;
  micCtx?.close().catch(() => {}); micCtx = null;
  setTimeout(() => { playCtx?.close().catch(() => {}); playCtx = null; gainNode = null; }, 1500);
  nextPlayTime = 0;

  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'end_turn' })); } catch (_) {}
    ws.close();
  }
  ws = null;

  finaliseVoiceAIBubble();
  finaliseVoiceUserBubble();
  if (setupMsg)    { setupMsg.remove();    setupMsg    = null; }
  if (switchingMsg){ switchingMsg.remove(); switchingMsg = null; }
  setMicState('idle');
  setLiveSessionState('idle');
  document.querySelectorAll('.live-status').forEach(e => e.remove());
  document.querySelectorAll('.msg.ai.speaking').forEach(el => el.classList.remove('speaking'));

  // Remove dropdown listener so it doesn't fire after session ends
  document.getElementById('subjectOverride')?.removeEventListener('subjectchange', onDropdownChange);
}

// ── Mic ───────────────────────────────────────────────────────────────────────

async function startMic() {
  const src    = micCtx.createMediaStreamSource(micStream);
  analyserNode = micCtx.createAnalyser();
  analyserNode.fftSize = 256;
  startWaveform(analyserNode, playCtx, gainNode);              // ← start waveform once analyser is ready
  src.connect(analyserNode);

  // Load the AudioWorklet processor module
  await micCtx.audioWorklet.addModule('./js/audio-processor.js');
  processor = new AudioWorkletNode(micCtx, 'mic-processor', {
    processorOptions: { chunkSize: CHUNK_SZ },
  });

  const vadBuf = new Float32Array(analyserNode.frequencyBinCount);

  processor.port.onmessage = (e) => {
    if (!isLive || ws?.readyState !== WebSocket.OPEN) return;
    if (processor._muted) return;

    analyserNode.getFloatTimeDomainData(vadBuf);
    let rms = 0;
    for (let i = 0; i < vadBuf.length; i++) rms += vadBuf[i] * vadBuf[i];
    rms = Math.sqrt(rms / vadBuf.length);
    const aiPlaying = playCtx && nextPlayTime > playCtx.currentTime + 0.1;
    if (rms > VAD_THRESH) {
      vadFrames++;
      if (vadFrames >= VAD_FRAMES_REQ && aiPlaying) { interruptPlayback(); vadFrames = 0; }
    } else {
      vadFrames = 0;
    }

    const pcm = f32ToI16(e.data.samples);
    ws.send(JSON.stringify({ type: 'audio', data: toB64(pcm.buffer), mime: `audio/pcm;rate=${IN_RATE}` }));
  };

  src.connect(processor);
  processor.connect(micCtx.destination);
}

function setMicState(s) {
  const btn = document.getElementById('btnMic');
  if (!btn) return;
  btn.classList.remove('live', 'processing');
  if (s === 'live')       { btn.classList.add('live');       btn.title = 'End live session'; }
  if (s === 'processing') { btn.classList.add('processing'); btn.title = 'Connecting…'; }
  if (s === 'idle')       { btn.title = 'Start live voice'; }
}

// ── Voice bubbles ─────────────────────────────────────────────────────────────

function updateVoiceAIBubble(text) {
  clearEmpty();
  if (!currentAIBubble) {
    currentAIBubble = appendStreamingAI(voiceTutorName(), '🎙');
  }
  // Live render — shows formatted markdown + KaTeX while the AI is speaking.
  // Falls back to plain text on mid-LaTeX chunks (unbalanced $ delimiters).
  updateStreamingBubbleLive(currentAIBubble, text);
}

function finaliseVoiceAIBubble() {
  if (!currentAIBubble || !aiAccum.trim()) {
    if (currentAIBubble) currentAIBubble.remove(); // remove dots bubble if nothing was spoken
    currentAIBubble = null; aiAccum = ''; return;
  }
  const txt = aiAccum.trim();
  aiAccum = '';
  // Full markdown + KaTeX render — the transcript IS the final content here
  // (no reformat pass). plainText:true was wrongly suppressing this.
  finaliseStreamingBubble(currentAIBubble, txt, { skipExport: true });
  // Only add to history if there's already a user turn — prevents model-first history
  const hist = state.conversationHistory;
  if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
    hist.push({ role: 'model', content: txt });
  }
  currentAIBubble = null;
}

// ── Reformat plain voice transcript into structured markdown ─────────────────
// Called after turn_complete — streams a formatted version from /chat endpoint.

async function reformatVoiceResponse(userQuestion, historySnapshot, existingBubble = null) {
  const subject = sessionSubject;
  const name    = voiceTutorName();

  const el = existingBubble || appendStreamingAI(name, '🎙');

  // Cancel any pending throttled KaTeX timer on the live bubble (defensive)
  cancelMathRender(el);
  el.classList.remove('streaming');
  el.classList.add('voice-reply', 'streaming');

  let fullReply  = '';
  let bubbleWiped = false;
  let aborted    = false;

  // Create controller — stays alive for the entire fetch + stream read
  const controller = new AbortController();
  voiceFetchController = controller;

  try {
    // Sanitise history: must start with 'user', no consecutive same-role turns
    const safeHistory = [];
    for (const turn of historySnapshot) {
      if (safeHistory.length === 0 && turn.role === 'model') continue;
      const last = safeHistory[safeHistory.length - 1];
      if (last && last.role === turn.role) {
        safeHistory[safeHistory.length - 1] = turn;
      } else {
        safeHistory.push(turn);
      }
    }
    while (safeHistory.length > 0 && safeHistory[0].role === 'model') safeHistory.shift();

    const res = await fetch(CHAT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userQuestion,
        history: safeHistory,
        subject,
        voiceMode: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Server error ' + res.status);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    // Abort promise — resolves when the controller is aborted, racing reader.read()
    const abortPromise = new Promise((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    );

    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
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
          // ignore — subject already known
        } else if (ev.text !== undefined) {
          fullReply += ev.text;
          // Only wipe the spoken transcript once the reformat has enough content
          // to fill the bubble — prevents a jarring blank flash on first chunk.
          if (!bubbleWiped && fullReply.length > 60) {
            bubbleWiped = true;
            const b = el.querySelector('.msg-bubble');
            if (b) b.innerHTML = '<span class="stream-cursor"></span>';
          }
          if (bubbleWiped) updateStreamingBubble(el, fullReply);
        } else if (ev.reply !== undefined || ev.observation !== undefined) {
          // done signal — loop will exit naturally
        } else if (ev.error) {
          throw new Error(ev.error);
        }
      }

      if (done) break;
    }
    reader.cancel();
    // If reformat was short and never triggered the wipe threshold, do it now
    if (!bubbleWiped && fullReply.trim()) {
      bubbleWiped = true;
      const b = el.querySelector('.msg-bubble');
      if (b) b.innerHTML = '<span class="stream-cursor"></span>';
      updateStreamingBubble(el, fullReply);
    }
  } catch (e) {
  } finally {
    if (voiceFetchController === controller) voiceFetchController = null;
  }

  if (aborted) { el.remove(); return; }

  if (!fullReply.trim()) {
    const fallback = state.conversationHistory.slice(-1)[0]?.content || '';
    if (fallback) {
      finaliseStreamingBubble(el, fallback, { skipExport: true, plainText: true });
    } else {
      el.remove();
    }
    return;
  }

  finaliseStreamingBubble(el, fullReply, { skipExport: true });
  const last = state.conversationHistory[state.conversationHistory.length - 1];
  if (last?.role === 'model') last.content = fullReply;
}

function updateVoiceUserBubble(text) {
  clearEmpty();
  if (!currentUserBubble) {
    const el = document.createElement('div');
    el.className = 'msg user user-voice-turn';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<div class="msg-label">You 🎙 <span class="msg-time">${time}</span></div><div class="msg-bubble"></div>`;
    document.getElementById('messages').appendChild(el);
    currentUserBubble = el;
  }
  const b = currentUserBubble.querySelector('.msg-bubble');
  if (b) b.textContent = text.trim();
  scrollMsgs();
}

function finaliseVoiceUserBubble() {
  if (currentUserBubble) {
    currentUserBubble.classList.remove('user-voice-turn');
    const cleanText = fixSpacedLetters(userAccum.trim());
    // Update the bubble display with the cleaned text
    const b = currentUserBubble.querySelector('.msg-bubble');
    if (b && cleanText) b.textContent = cleanText;
  }
  currentUserBubble = null;
  userAccum = '';
}

// ── Live document generation ──────────────────────────────────────────────────

async function streamDoc(userRequest) {
  const el = appendStreamingAI('📄 Live Document');
  el.classList.add('doc-card');
  const bubble = el.querySelector('.msg-bubble');
  if (bubble) bubble.classList.add('doc-body');

  let fullDoc = '';
  let aborted = false;

  const controller = new AbortController();
  voiceFetchController = controller;

  try {
    const res = await fetch(CHAT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: liveDocPrompt(userRequest),
        history: state.conversationHistory.slice(-8),
        subject: sessionSubject,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Server error');

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    const abortPromise = new Promise((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    );

    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (!done) buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = done ? '' : lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        let ev; try { ev = JSON.parse(raw); } catch (_) { continue; }
        if (ev.text) { fullDoc += ev.text; updateStreamingBubble(el, fullDoc); }
      }
      if (done) break;
    }
    reader.cancel();
  } catch (e) {
    if (e.name === 'AbortError') aborted = true;
    else fullDoc = '⚠️ Could not generate document: ' + e.message;
  } finally {
    if (voiceFetchController === controller) voiceFetchController = null;
  }

  if (aborted) { el.remove(); return; }

  finaliseStreamingBubble(el, fullDoc, { skipExport: true, docCard: true });
  state.conversationHistory.push({ role: 'model', content: fullDoc });
  autoSaveSession();
}

// ── Audio ─────────────────────────────────────────────────────────────────────

function interruptPlayback() {
  if (!playCtx) return;
  for (const src of activeSources) {
    try { src.stop(0); } catch (_) {}
  }
  activeSources.clear();
  setWaveformAISpeaking(false);
  nextPlayTime = playCtx.currentTime;
  if (gainNode) {
    gainNode.gain.cancelScheduledValues(playCtx.currentTime);
    gainNode.gain.setValueAtTime(volume * MASTER_GAIN, playCtx.currentTime);
  }
}

function scheduleAudio(b64) {
  if (!playCtx || !gainNode) return;
  try {
    const f32 = i16ToF32(new Int16Array(fromB64(b64)));
    const buf = playCtx.createBuffer(1, f32.length, OUT_RATE);
    buf.copyToChannel(f32, 0);
    const src = playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(gainNode);
    const at = Math.max(nextPlayTime, playCtx.currentTime + 0.02);
    src.start(at);
    nextPlayTime = at + buf.duration;
    setWaveformAISpeaking(true);
    activeSources.add(src);
    src.onended = () => {
      activeSources.delete(src);
      if (activeSources.size === 0) setWaveformAISpeaking(false);
    };
  } catch (e) { console.error('audio sched:', e); }
}

// ── PCM / base64 codec ────────────────────────────────────────────────────────

function f32ToI16(f32) {
  const o = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    o[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return o;
}
function i16ToF32(i16) {
  const o = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) o[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7FFF);
  return o;
}
function toB64(buf) {
  const b = new Uint8Array(buf); let s = ''; const N = 8192;
  for (let i = 0; i < b.length; i += N) s += String.fromCharCode(...b.subarray(i, i + N));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64); const b = new ArrayBuffer(s.length); const v = new Uint8Array(b);
  for (let i = 0; i < s.length; i++) v[i] = s.charCodeAt(i); return b;
}

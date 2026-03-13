// ── waveform.js ───────────────────────────────────────────────────────────────

let _raf          = null;
let _micAnalyser  = null;
let _playAnalyser = null;
let _aiSpeaking   = false;
let _freqMic      = null;
let _freqPlay     = null;
let _barsMic      = null;
let _barsPlay     = null;

const NUM_BARS = 28;
const BAR_GAP  = 3;

// ── Public API ────────────────────────────────────────────────────────────────

export function startWaveform(micAnalyser, playCtx, gainNode) {
  if (_raf) stopWaveform();

  _micAnalyser              = micAnalyser;
  _micAnalyser.fftSize      = 1024;
  _micAnalyser.smoothingTimeConstant = 0.8;
  _aiSpeaking               = false;
  _barsMic                  = new Float32Array(NUM_BARS);
  _barsPlay                 = new Float32Array(NUM_BARS);
  _freqMic                  = new Uint8Array(_micAnalyser.frequencyBinCount);

  if (playCtx && gainNode) {
    _playAnalyser                       = playCtx.createAnalyser();
    _playAnalyser.fftSize               = 1024;
    _playAnalyser.smoothingTimeConstant = 0.8;
    gainNode.connect(_playAnalyser);
    _freqPlay = new Uint8Array(_playAnalyser.frequencyBinCount);
  }

  const canvas = _getCanvas();
  if (!canvas) return;
  _getStrip()?.classList.add('wf-active');
  _scaleCanvas(canvas);
  _loop();
}

export function stopWaveform() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_playAnalyser) { try { _playAnalyser.disconnect(); } catch (_) {} _playAnalyser = null; }
  _micAnalyser = null;
  _aiSpeaking  = false;
  _freqMic = _freqPlay = _barsMic = _barsPlay = null;

  const canvas = _getCanvas();
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  _getStrip()?.classList.remove('wf-active');
}

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

export function setWaveformAISpeaking(speaking) {
  _aiSpeaking = speaking;

  if (speaking) {
    // Pulse only the most recent AI message bubble
    const msgs = document.querySelectorAll('.msg.ai');
    const last = msgs[msgs.length - 1];
    if (last) {
      // Read current subject from the badge CSS variable or state
      const badge = document.getElementById('subjectBadge');
      const color = (badge && getComputedStyle(badge).getPropertyValue('--subject-color').trim())
        || SUBJECT_COLORS.Other;
      last.style.setProperty('--speaking-color', color);
      last.classList.add('speaking');
    }
  } else {
    // Remove from ALL bubbles — prevents glow getting stuck
    document.querySelectorAll('.msg.ai.speaking').forEach(el => {
      el.classList.remove('speaking');
      el.style.removeProperty('--speaking-color');
    });
  }
}

// ── Loop ──────────────────────────────────────────────────────────────────────

function _loop() {
  _raf = requestAnimationFrame(_loop);
  if (!_micAnalyser) return;

  const canvas = _getCanvas();
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W   = canvas._dw || 200;
  const H   = canvas._dh || 36;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (_aiSpeaking && _playAnalyser) {
    _drawBars(ctx, W, H, _freqPlay, _playAnalyser, _barsPlay);
  } else {
    _drawBars(ctx, W, H, _freqMic,  _micAnalyser,  _barsMic);
  }
}

// ── Bar renderer ──────────────────────────────────────────────────────────────

function _drawBars(ctx, W, H, buf, analyser, smooth) {
  analyser.getByteFrequencyData(buf);

  const accent = _resolveColor();
  const barW   = (W - BAR_GAP * (NUM_BARS - 1)) / NUM_BARS;
  const maxH   = H - 6;
  // Only look at the first 40% of bins — that's where voice energy lives
  const usable = Math.floor(buf.length * 0.40);

  for (let i = 0; i < NUM_BARS; i++) {
    // Linear spread across usable bins
    const binIdx = Math.floor((i / NUM_BARS) * usable);
    // Normalise: analyser returns 0–255, typical speech peaks ~100–180
    const raw    = buf[binIdx] / 255;

    // Smooth per-bar
    smooth[i] += (raw - smooth[i]) * (raw > smooth[i] ? 0.35 : 0.1);

    // Apply a gentle curve so mid-loudness looks natural, not capped
    const v    = Math.pow(smooth[i], 1.4);
    const barH = Math.max(2, v * maxH);
    const x    = i * (barW + BAR_GAP);
    const y    = (H - barH) / 2;

    ctx.globalAlpha = 0.35 + v * 0.65;
    ctx.shadowColor = accent;
    ctx.shadowBlur  = v > 0.3 ? 4 + v * 8 : 0;
    ctx.fillStyle   = accent;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(1, barW), barH, 2);
    ctx.fill();
  }

  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getCanvas() { return document.getElementById('waveformCanvas'); }
function _getStrip()  { return document.getElementById('waveformStrip');  }

function _scaleCanvas(canvas) {
  const dpr      = window.devicePixelRatio || 1;
  const strip    = _getStrip();
  const displayW = strip ? strip.clientWidth  || 200 : 200;
  const displayH = strip ? strip.clientHeight || 36  : 36;
  canvas.width   = displayW * dpr;
  canvas.height  = displayH * dpr;
  canvas.getContext('2d').scale(dpr, dpr);
  canvas._dw = displayW;
  canvas._dh = displayH;
}

function _resolveColor() {
  try {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || '#555555';
  } catch (_) { return '#555555'; }
}

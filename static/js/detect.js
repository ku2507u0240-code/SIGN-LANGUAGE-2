/**
 * detect.js — Webcam-only live sign detection.
 *
 * BUG THAT WAS FIXED:
 *   signNameSmall = getElementById('signNameSmall') returned null because
 *   that element no longer exists in detect.html. Every call to showDetected /
 *   showNotDetected / showIdle threw "Cannot set properties of null (reading
 *   'style')" which crashed the prediction callback silently, freezing the UI.
 */
const PREDICT_MS  = 300;
const HISTORY_MAX = 10;

let hm               = null;
let currentLandmarks = null;
let predictInterval  = null;
let history          = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const videoEl       = document.getElementById('video');
const canvasEl      = document.getElementById('canvas');
const loadingEl     = document.getElementById('loading');
const statusDot     = document.getElementById('statusDot');
const statusTxt     = document.getElementById('statusTxt');
const meaningDisplay= document.getElementById('meaningDisplay');
const predictHint   = document.getElementById('predictHint');
const confFill      = document.getElementById('confFill');
const confText      = document.getElementById('confText');
const resultCard    = document.getElementById('resultCard');
const historyList   = document.getElementById('historyList');
const noSignsAlert  = document.getElementById('noSignsAlert');

// ── Display helpers ───────────────────────────────────────────────────────────
function showDetected(label, confidence) {
  const pct = Math.round(confidence * 100);
  meaningDisplay.textContent = label;
  meaningDisplay.className   = 'meaning-text meaning-detected';
  predictHint.textContent    = 'Sign Detected';
  predictHint.style.color    = 'var(--success)';
  confFill.style.width       = pct + '%';
  confText.textContent       = `Confidence: ${pct}%`;
  if (resultCard) resultCard.style.borderColor = 'rgba(16,185,129,0.35)';
  return pct;
}

function showNotDetected() {
  meaningDisplay.textContent = 'Not Detected';
  meaningDisplay.className   = 'meaning-text meaning-unknown';
  predictHint.textContent    = 'Sign Not in Database';
  predictHint.style.color    = 'var(--danger)';
  confFill.style.width       = '0%';
  confText.textContent       = 'Confidence: —';
  if (resultCard) resultCard.style.borderColor = 'rgba(239,68,68,0.3)';
}

function showIdle() {
  meaningDisplay.textContent = '?';
  meaningDisplay.className   = 'meaning-text meaning-idle';
  predictHint.textContent    = 'Show a sign to the camera…';
  predictHint.style.color    = 'var(--muted)';
  confFill.style.width       = '0%';
  confText.textContent       = 'Confidence: —';
  if (resultCard) resultCard.style.borderColor = 'var(--border)';
}

function updateStatus(text, cls) {
  statusTxt.textContent = text;
  statusDot.className   = 'status-dot ' + cls;
}

// ── History ───────────────────────────────────────────────────────────────────
function addHistory(label, pct) {
  if (history[0] && history[0].label === label) return;  // skip consecutive duplicates
  history.unshift({ label, pct, time: new Date().toLocaleTimeString() });
  if (history.length > HISTORY_MAX) history.pop();
  historyList.innerHTML = history.map(h => `
    <div class="history-item">
      <span class="history-name">${h.label}</span>
      <span class="history-conf">${h.pct}% &middot; ${h.time}</span>
    </div>`).join('');
}

// ── Prediction loop ───────────────────────────────────────────────────────────
async function runPredict() {
  if (!currentLandmarks) return;
  try {
    const res  = await fetch('/api/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ landmarks: currentLandmarks })
    });
    const data = await res.json();
    if (data.label) {
      const pct = showDetected(data.label, data.confidence);
      addHistory(data.label, pct);
    } else {
      showNotDetected();
    }
  } catch (err) {
    console.warn('Predict error:', err);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await fetch('/api/stats');
    const d = await r.json();
    if (d.sign_count === 0 && noSignsAlert) noSignsAlert.style.display = 'flex';
  } catch (_) {}

  try {
    hm = new HandsManager(videoEl, canvasEl, (lm) => {
      currentLandmarks = lm;
      if (lm) {
        updateStatus('Hand Detected — Detecting…', 'active');
      } else {
        updateStatus('No Hand Detected', '');
        showIdle();
      }
    });
    await hm.init();
    loadingEl.style.display = 'none';
    updateStatus('No Hand Detected', '');
    predictInterval = setInterval(runPredict, PREDICT_MS);
  } catch (err) {
    loadingEl.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px">
      Camera Error<br><small>${err.message}</small></div>`;
  }
}

init();

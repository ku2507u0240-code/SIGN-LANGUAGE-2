/**
 * add.js
 * Live detection panel updates in real-time while the hand moves.
 * Recording captures 50 landmark frames and saves them.
 */
const CAPTURE_FRAMES = 50;
const LIVE_MS        = 250;   // poll every 250ms = snappy real-time feedback

let hm               = null;
let currentLandmarks = null;
let isRecording      = false;
let capturedFrames   = [];
let recordingTimer   = null;
let countdownTimer   = null;
let liveTimer        = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const videoEl       = document.getElementById('video');
const canvasEl      = document.getElementById('canvas');
const loadingEl     = document.getElementById('loading');
const statusDot     = document.getElementById('statusDot');
const statusTxt     = document.getElementById('statusTxt');
const nameInput     = document.getElementById('signName');
const recordBtn     = document.getElementById('recordBtn');
const progressWrap  = document.getElementById('progressWrap');
const progressFill  = document.getElementById('progressFill');
const progressCount = document.getElementById('progressCount');
const alertEl       = document.getElementById('alert');
const galleryEl     = document.getElementById('gallery');

// Live detection panel
const livePanel     = document.getElementById('livePanel');
const liveDot       = document.getElementById('liveDot');
const liveSignName  = document.getElementById('liveSignName');
const liveSubtitle  = document.getElementById('liveSubtitle');
const liveBarFill   = document.getElementById('liveBarFill');
const livePct       = document.getElementById('livePct');

// ── Helpers ───────────────────────────────────────────────────────────────────
function showAlert(msg, type = 'success') {
  alertEl.className = `alert alert-${type} show`;
  alertEl.innerHTML = ({ success: '[OK]', error: '[Error]', info: '[Info]' }[type] || '') + ' ' + msg;
  clearTimeout(showAlert._t);
  showAlert._t = setTimeout(() => alertEl.classList.remove('show'), 5000);
}

function setStatus(text, cls) {
  statusTxt.textContent = text;
  statusDot.className = 'status-dot ' + cls;
}

// ── Live Detection Panel ───────────────────────────────────────────────────────
function setLiveKnown(label, confidence) {
  const pct = Math.round(confidence * 100);
  liveSignName.textContent = label;
  liveSignName.className   = 'live-sign-name lsn-known';
  liveSubtitle.textContent = `Detected — ${pct}% confidence`;
  liveBarFill.style.width  = pct + '%';
  livePct.textContent      = pct + '%';
  liveDot.className        = 'live-dot on';
  livePanel.className      = 'live-panel active-detection';
}

function setLiveUnknown() {
  liveSignName.textContent = 'Not in database';
  liveSignName.className   = 'live-sign-name lsn-unknown';
  liveSubtitle.textContent = 'This sign is not saved yet — record it below!';
  liveBarFill.style.width  = '0%';
  livePct.textContent      = '—';
  liveDot.className        = 'live-dot off';
  livePanel.className      = 'live-panel no-detection';
}

function setLiveIdle(msg) {
  liveSignName.textContent = '—';
  liveSignName.className   = 'live-sign-name lsn-idle';
  liveSubtitle.textContent = msg || 'Move your hand to see live detection';
  liveBarFill.style.width  = '0%';
  livePct.textContent      = '—';
  liveDot.className        = 'live-dot';
  livePanel.className      = 'live-panel';
}

// ── Live Detection Loop ────────────────────────────────────────────────────────
async function runLiveDetect() {
  if (!currentLandmarks) return;
  try {
    const res  = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landmarks: currentLandmarks })
    });
    const data = await res.json();
    if (data.label) {
      setLiveKnown(data.label, data.confidence);
    } else {
      setLiveUnknown();
    }
  } catch (_) {}
}

function startLiveLoop() {
  if (liveTimer) return;
  liveTimer = setInterval(runLiveDetect, LIVE_MS);
}

function stopLiveLoop() {
  clearInterval(liveTimer);
  liveTimer = null;
}

// ── MediaPipe init ────────────────────────────────────────────────────────────
async function init() {
  try {
    hm = new HandsManager(videoEl, canvasEl, (lm) => {
      currentLandmarks = lm;
      if (!isRecording) {
        if (lm) {
          setStatus('Hand Detected', 'active');
          startLiveLoop();
        } else {
          setStatus('No Hand Detected', '');
          stopLiveLoop();
          setLiveIdle('Show your hand to the camera');
        }
      }
    });
    await hm.init();
    loadingEl.style.display = 'none';
    setStatus('No Hand Detected', '');
    setLiveIdle('Show your hand to the camera');
    loadGallery();
  } catch (err) {
    loadingEl.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px">
      ❌ Camera Error<br><small>${err.message}</small></div>`;
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────
function startRecording() {
  const name = nameInput.value.trim();
  if (!name) {
    showAlert('Please enter a sign name first.', 'error');
    nameInput.focus();
    return;
  }
  if (!currentLandmarks) {
    showAlert('No hand detected. Show your hand first.', 'error');
    return;
  }

  stopLiveLoop();   // pause live detection during countdown + recording

  let count = 3;
  recordBtn.disabled = true;
  setStatus(`Get ready… ${count}`, 'active');
  setLiveIdle('Recording in ' + count + '…');

  const tick = () => {
    count--;
    if (count > 0) {
      setStatus(`Get ready… ${count}`, 'active');
      setLiveIdle('Recording in ' + count + '…');
      countdownTimer = setTimeout(tick, 1000);
    } else {
      beginCapture();
    }
  };
  countdownTimer = setTimeout(tick, 1000);
}

function beginCapture() {
  isRecording    = true;
  capturedFrames = [];
  progressWrap.style.display = 'flex';
  setStatus('Recording… Hold still!', 'recording');

  liveSignName.textContent = 'Recording…';
  liveSignName.className   = 'live-sign-name lsn-idle';
  liveSubtitle.textContent = 'Capturing your hand gesture…';
  liveDot.className        = 'live-dot off';
  livePanel.className      = 'live-panel';

  recordBtn.textContent = 'Stop';
  recordBtn.disabled    = false;
  recordBtn.onclick     = stopRecording;

  recordingTimer = setInterval(() => {
    if (currentLandmarks) {
      capturedFrames.push(JSON.parse(JSON.stringify(currentLandmarks)));
    }
    const pct = Math.min(100, Math.round((capturedFrames.length / CAPTURE_FRAMES) * 100));
    progressFill.style.width  = pct + '%';
    progressCount.textContent = `${capturedFrames.length} / ${CAPTURE_FRAMES}`;
    liveBarFill.style.width   = pct + '%';
    livePct.textContent       = pct + '%';

    if (capturedFrames.length >= CAPTURE_FRAMES) stopRecording();
  }, 80);
}

function stopRecording() {
  clearInterval(recordingTimer);
  clearTimeout(countdownTimer);
  isRecording = false;

  recordBtn.textContent = 'Start Recording';
  recordBtn.onclick     = startRecording;
  recordBtn.disabled    = false;

  if (capturedFrames.length < 5) {
    showAlert('Too few frames — please try again.', 'error');
    setStatus('No Hand Detected', '');
    progressWrap.style.display = 'none';
    setLiveIdle('Show your hand to the camera');
    startLiveLoop();
    return;
  }

  saveSign();
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveSign() {
  const name = nameInput.value.trim();
  setStatus('Saving…', 'active');
  liveSignName.textContent = 'Saving…';
  recordBtn.disabled = true;

  try {
    const res  = await fetch('/api/signs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, meaning: name, landmarks: capturedFrames })
    });
    const data = await res.json();

    if (data.success) {
      showAlert(`"${name}" saved with ${capturedFrames.length} frames.`, 'success');
      nameInput.value = '';
      progressFill.style.width = '0%';
      progressWrap.style.display = 'none';
      loadGallery();
    } else {
      showAlert(data.error || 'Save failed.', 'error');
    }
  } catch (err) {
    showAlert('Network error: ' + err.message, 'error');
  } finally {
    recordBtn.disabled = false;
    const hasHand = !!currentLandmarks;
    setStatus(hasHand ? 'Hand Detected' : 'No Hand Detected', hasHand ? 'active' : '');
    if (hasHand) {
      startLiveLoop();
    } else {
      setLiveIdle('Show your hand to the camera');
    }
  }
}

// ── Gallery ───────────────────────────────────────────────────────────────────
async function loadGallery() {
  try {
    const res   = await fetch('/api/signs');
    const signs = await res.json();
    if (signs.length === 0) {
      galleryEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-icon">&#9678;</div><p>No signs saved yet. Record your first one.</p></div>`;
      return;
    }
    galleryEl.innerHTML = signs.map(s => `
      <div class="sign-chip">
        <button class="btn-delete" onclick="deleteSign('${esc(s.name)}')">x</button>
        <div class="sign-name">${s.name}</div>
        <div class="sign-meta">${s.samples} frames</div>
        <div class="sign-meta">${new Date(s.created_at).toLocaleDateString()}</div>
      </div>`).join('');
  } catch (err) { console.error(err); }
}

function esc(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function deleteSign(name) {
  if (!confirm(`Delete "${name}" and all its training data?`)) return;
  try {
    await fetch(`/api/signs/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showAlert(`"${name}" deleted.`, 'info');
    loadGallery();
  } catch (err) {
    showAlert('Delete failed: ' + err.message, 'error');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
recordBtn.onclick = startRecording;
init();

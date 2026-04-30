/**
 * hands_utils.js
 * Shared MediaPipe Hands initialization and skeleton drawing.
 *
 * ROOT CAUSE OF CAMERA FREEZE:
 *   Setting canvasEl.width / canvasEl.height every frame — even to the same
 *   value — wipes the canvas context state AND triggers a full browser layout
 *   reflow on every MediaPipe result. After enough frames this stalls the
 *   render loop. Fix: only resize when dimensions actually change.
 *
 * Usage:
 *   const hm = new HandsManager(videoEl, canvasEl, onLandmarks);
 *   await hm.init();
 */
class HandsManager {
  constructor(videoEl, canvasEl, onLandmarks) {
    this.videoEl  = videoEl;
    this.canvasEl = canvasEl;
    this.ctx      = canvasEl.getContext('2d');
    this.onLandmarks = onLandmarks;   // (landmarks | null) => void
    this.hands    = null;
    this.camera   = null;
    this.ready    = false;
    this._cw      = 0;   // last known canvas width
    this._ch      = 0;   // last known canvas height
  }

  async init() {
    this.hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`
    });

    this.hands.setOptions({
      maxNumHands:            1,
      modelComplexity:        1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence:  0.5
    });

    this.hands.onResults((results) => this._onResults(results));

    this.camera = new Camera(this.videoEl, {
      onFrame: async () => {
        if (this.hands && !this._sending) {
          this._sending = true;
          try {
            await this.hands.send({ image: this.videoEl });
          } catch (_) {
            // swallow transient errors so the loop never dies
          } finally {
            this._sending = false;
          }
        }
      },
      width:  640,
      height: 480
    });

    await this.camera.start();
    this.ready = true;
  }

  _onResults(results) {
    const vw = this.videoEl.videoWidth  || 640;
    const vh = this.videoEl.videoHeight || 480;

    // ── KEY FIX: only resize canvas when dimensions actually change ──────────
    // Assigning to canvas.width or .height — even to the same value — resets
    // the entire 2D context (clears transforms, state, pixels) AND causes a
    // browser layout reflow. Doing this every frame is what caused the freeze.
    if (this._cw !== vw || this._ch !== vh) {
      this.canvasEl.width  = vw;
      this.canvasEl.height = vh;
      this._cw = vw;
      this._ch = vh;
    }

    const { ctx, canvasEl } = this;

    // Clear previous frame
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // Draw video frame mirrored (selfie view)
    ctx.save();
    ctx.translate(canvasEl.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.videoEl, 0, 0, canvasEl.width, canvasEl.height);

    // Draw hand skeleton if detected
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      drawConnectors(ctx, landmarks, HAND_CONNECTIONS,
        { color: '#22d3ee', lineWidth: 2 });          // cyan lines — matches new theme
      drawLandmarks(ctx, landmarks,
        { color: '#2563eb', fillColor: '#ffffff', lineWidth: 1, radius: 4 }); // blue dots
      ctx.restore();
      if (this.onLandmarks) this.onLandmarks(landmarks);
    } else {
      ctx.restore();
      if (this.onLandmarks) this.onLandmarks(null);
    }
  }

  stop() {
    if (this.camera) this.camera.stop();
    this.ready = false;
  }
}

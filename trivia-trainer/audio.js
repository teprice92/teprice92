// Audio helpers for listening rounds: decode a file, draw its waveform,
// cut a 5-15 second clip, and play a clip window.
window.TriviaAudio = (() => {
  const MIN_LEN = 5;
  const MAX_LEN = 15;

  async function decodeFile(file) {
    const bytes = await file.arrayBuffer();
    // An OfflineAudioContext decodes without needing a user gesture.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return ctx.decodeAudioData(bytes);
  }

  // Peak amplitude per bucket, 0..1, for drawing.
  function peaks(buffer, buckets) {
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / buckets));
    const out = new Float32Array(buckets);
    let max = 0;
    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      const end = Math.min(data.length, (b + 1) * size);
      for (let i = b * size; i < end; i += 16) peak = Math.max(peak, Math.abs(data[i]));
      out[b] = peak;
      max = Math.max(max, peak);
    }
    if (max > 0) for (let b = 0; b < buckets; b++) out[b] /= max;
    return out;
  }

  function drawWaveform(canvas, buffer, sel, colors) {
    const d = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * d;
    canvas.height = h * d;
    const ctx = canvas.getContext("2d");
    ctx.scale(d, d);
    const bars = Math.floor(w / 3);
    const p = peaks(buffer, bars);
    const x0 = (sel.start / buffer.duration) * w;
    const x1 = ((sel.start + sel.len) / buffer.duration) * w;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = colors.window;
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    ctx.globalAlpha = 1;
    for (let i = 0; i < bars; i++) {
      const x = i * 3;
      const bh = Math.max(2, p[i] * (h - 8));
      ctx.fillStyle = x >= x0 && x <= x1 ? colors.active : colors.idle;
      ctx.fillRect(x, (h - bh) / 2, 2, bh);
    }
  }

  function sliceBuffer(buffer, start, len) {
    const sr = buffer.sampleRate;
    const from = Math.floor(start * sr);
    const frames = Math.min(Math.floor(len * sr), buffer.length - from);
    const out = new AudioBuffer({ length: frames, numberOfChannels: Math.min(2, buffer.numberOfChannels), sampleRate: sr });
    const fade = Math.min(Math.floor(0.12 * sr), Math.floor(frames / 4));
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch).subarray(from, from + frames);
      const dst = out.getChannelData(ch);
      dst.set(src);
      for (let i = 0; i < fade; i++) {
        const g = i / fade;
        dst[i] *= g;
        dst[frames - 1 - i] *= g;
      }
    }
    return out;
  }

  // Preview a window of the decoded file. Returns a stop function.
  function preview(buffer, start, len, onEnd) {
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => { ctx.close(); onEnd && onEnd(); };
    src.start(0, start, len);
    return () => { try { src.stop(); } catch (e) { /* already stopped */ } };
  }

  function recorderType() {
    if (typeof MediaRecorder === "undefined") return null;
    const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
    return options.find((t) => MediaRecorder.isTypeSupported(t)) || null;
  }

  // Re-encode just the chosen window. Runs in real time (a 10 s clip takes 10 s).
  // Resolves { blob, uploadType } where uploadType is a container the asset store accepts.
  async function cutClip(buffer, start, len, onProgress) {
    const mime = recorderType();
    if (!mime) throw new Error("no_recorder");
    const clip = sliceBuffer(buffer, start, len);
    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = clip;
    src.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 128000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((resolve) => (rec.onstop = resolve));
    rec.start();
    src.start();
    const t0 = performance.now();
    const tick = setInterval(() => onProgress && onProgress(Math.min(1, (performance.now() - t0) / 1000 / clip.duration)), 200);
    await new Promise((resolve) => (src.onended = resolve));
    rec.stop();
    await done;
    clearInterval(tick);
    ctx.close();
    const type = mime.split(";")[0];
    return { blob: new Blob(chunks, { type }), uploadType: type === "audio/mp4" ? "video/mp4" : "video/webm" };
  }

  // Plays [start, end) of a clip URL. Returns a small controller.
  function clipPlayer(src, start, end, { onTick, onState } = {}) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = src;
    let raf = null;
    const len = Math.max(0.1, end - start);
    const loop = () => {
      const t = audio.currentTime - start;
      onTick && onTick(Math.min(1, Math.max(0, t / len)));
      if (audio.currentTime >= end) return stop();
      raf = requestAnimationFrame(loop);
    };
    function stop() {
      audio.pause();
      cancelAnimationFrame(raf);
      raf = null;
      onTick && onTick(0);
      onState && onState("stopped");
    }
    async function play() {
      try {
        audio.currentTime = start;
        await audio.play();
        onState && onState("playing");
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      } catch (e) {
        onState && onState(e && e.name === "NotAllowedError" ? "blocked" : "error");
      }
    }
    audio.addEventListener("error", () => onState && onState("error"));
    audio.addEventListener("ended", stop);
    return { play, stop, get playing() { return !audio.paused; }, destroy() { stop(); audio.removeAttribute("src"); audio.load(); } };
  }

  return { MIN_LEN, MAX_LEN, decodeFile, drawWaveform, preview, cutClip, recorderType, clipPlayer };
})();

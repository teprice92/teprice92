/* Fleet Command — board renderer, combat animations and synthesized sound.
 * Everything is drawn on <canvas> and every sound is generated with the
 * Web Audio API, so the game ships with zero image or audio files.
 */
(function (FC) {
  'use strict';

  FC.settings = { sound: true, vibrate: true, speed: 1 };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  FC.wait = function (ms) {
    return new Promise(function (res) { setTimeout(res, ms / FC.settings.speed); });
  };
  FC.buzz = function (pattern) {
    if (FC.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  };

  // ---- sound ----------------------------------------------------------------
  var Sound = FC.Sound = {
    ctx: null, out: null, noiseBuf: null,
    init: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.55;
        var comp = this.ctx.createDynamicsCompressor();
        this.out.connect(comp); comp.connect(this.ctx.destination);
        var len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (var k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      } catch (e) { this.ctx = null; }
    },
    ok: function () { return FC.settings.sound && this.ctx && this.ctx.state === 'running'; },
    env: function (node, t, a, peak, dur) {
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      node.connect(g); g.connect(this.out);
      return g;
    },
    noise: function (o) {
      var c = this.ctx, t = c.currentTime + (o.delay || 0);
      var src = c.createBufferSource(); src.buffer = this.noiseBuf;
      var f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
      f.frequency.setValueAtTime(o.f0, t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
      f.Q.value = o.q || 0.8;
      src.connect(f);
      this.env(f, t, o.a || 0.005, o.gain, o.dur);
      src.start(t, Math.random()); src.stop(t + o.dur + 0.05);
    },
    tone: function (o) {
      var c = this.ctx, t = c.currentTime + (o.delay || 0);
      var osc = c.createOscillator(); osc.type = o.wave || 'sine';
      osc.frequency.setValueAtTime(o.f0, t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
      this.env(osc, t, o.a || 0.005, o.gain, o.dur);
      osc.start(t); osc.stop(t + o.dur + 0.05);
    },
    play: function (name, big) {
      if (!this.ok()) return;
      var S = this;
      switch (name) {
        case 'cannon':
          S.noise({ f0: 600, f1: 90, dur: 0.35, gain: 0.5 });
          S.tone({ f0: 140, f1: 45, dur: 0.3, gain: 0.5 }); break;
        case 'whistle':
          S.tone({ f0: 1500, f1: 520, dur: 0.5, gain: 0.04, a: 0.1 }); break;
        case 'boom':
          S.noise({ f0: big ? 1400 : 1000, f1: 80, dur: big ? 1.6 : 1.0, gain: big ? 1 : 0.8 });
          S.tone({ f0: 90, f1: 30, dur: big ? 0.9 : 0.6, gain: 0.8 }); break;
        case 'splash':
          S.noise({ type: 'bandpass', f0: 1800, f1: 500, dur: 0.6, gain: 0.45, q: 0.6, a: 0.02 });
          S.noise({ type: 'highpass', f0: 3000, dur: 0.35, gain: 0.12, delay: 0.05 }); break;
        case 'ping':
          S.tone({ f0: 1250, dur: 1.1, gain: 0.25 });
          S.tone({ f0: 1250, dur: 0.8, gain: 0.07, delay: 0.42 }); break;
        case 'blip':
          S.tone({ f0: 1700, dur: 0.12, gain: 0.08 }); break;
        case 'jet':
          S.noise({ type: 'bandpass', f0: 250, f1: 1600, dur: 1.3, gain: 0.35, q: 1.5, a: 0.5 }); break;
        case 'torpedo':
          S.noise({ type: 'bandpass', f0: 380, f1: 700, dur: 1.2, gain: 0.3, q: 4, a: 0.1 }); break;
        case 'missile':
          S.noise({ type: 'highpass', f0: 1200, f1: 3000, dur: 0.5, gain: 0.18, a: 0.05 }); break;
        case 'zap':
          S.noise({ type: 'highpass', f0: 2500, dur: 0.2, gain: 0.6 });
          S.noise({ f0: 900, f1: 60, dur: 1.8, gain: 0.7, delay: 0.1 }); break;
        case 'kraken':
          S.tone({ wave: 'sawtooth', f0: 60, f1: 38, dur: 1.4, gain: 0.25, a: 0.3 });
          S.noise({ f0: 400, f1: 80, dur: 1.2, gain: 0.4, delay: 0.2 }); break;
        case 'shield':
          S.tone({ wave: 'triangle', f0: 260, f1: 980, dur: 0.7, gain: 0.2, a: 0.05 }); break;
        case 'deflect':
          S.tone({ wave: 'triangle', f0: 1900, f1: 700, dur: 0.35, gain: 0.25 }); break;
        case 'repair':
          [660, 880, 1180].forEach(function (f, k) { S.tone({ wave: 'square', f0: f, dur: 0.1, gain: 0.06, delay: k * 0.11 }); }); break;
        case 'mine':
          S.tone({ wave: 'square', f0: 220, dur: 0.12, gain: 0.08 });
          S.tone({ wave: 'square', f0: 180, dur: 0.12, gain: 0.08, delay: 0.14 }); break;
        case 'click':
          S.tone({ f0: 900, dur: 0.05, gain: 0.06 }); break;
        case 'turn':
          S.tone({ wave: 'triangle', f0: 520, dur: 0.18, gain: 0.12 });
          S.tone({ wave: 'triangle', f0: 780, dur: 0.25, gain: 0.12, delay: 0.12 }); break;
        case 'alarm':
          [0, 0.3].forEach(function (d) {
            S.tone({ wave: 'square', f0: 620, dur: 0.14, gain: 0.07, delay: d });
            S.tone({ wave: 'square', f0: 480, dur: 0.14, gain: 0.07, delay: d + 0.15 });
          }); break;
        case 'win':
          [523, 659, 784, 1047].forEach(function (f, k) { S.tone({ wave: 'triangle', f0: f, dur: 0.5, gain: 0.15, delay: k * 0.16 }); }); break;
        case 'lose':
          [392, 330, 262, 196].forEach(function (f, k) { S.tone({ wave: 'triangle', f0: f, dur: 0.6, gain: 0.15, delay: k * 0.22 }); }); break;
      }
    }
  };

  // ---- shared drawing helpers -------------------------------------------------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Draws one ship centred on (cx, cy), lying horizontally with the bow to the right.
  FC.drawShip = function (ctx, cls, cs, cx, cy, vertical, opts) {
    opts = opts || {};
    var spec = FC.SHIPS[cls], L = spec.size * cs, w = cs * (cls === 'SS' ? 0.46 : 0.6);
    ctx.save();
    ctx.translate(cx, cy);
    if (vertical) ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    var x0 = -L / 2 + cs * 0.1, x1 = L / 2 - cs * 0.06;

    // hull
    function hull() {
      ctx.beginPath();
      if (cls === 'SS') {
        ctx.ellipse(0, 0, L / 2 - cs * 0.08, w / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(x0 + w * 0.3, -w / 2);
        ctx.lineTo(x1 - cs * 0.55, -w / 2);
        ctx.quadraticCurveTo(x1 - cs * 0.1, -w / 2, x1, 0);
        ctx.quadraticCurveTo(x1 - cs * 0.1, w / 2, x1 - cs * 0.55, w / 2);
        ctx.lineTo(x0 + w * 0.3, w / 2);
        ctx.quadraticCurveTo(x0, w / 2, x0, w * 0.2);
        ctx.lineTo(x0, -w * 0.2);
        ctx.quadraticCurveTo(x0, -w / 2, x0 + w * 0.3, -w / 2);
      }
      ctx.closePath();
    }
    hull();
    var g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    var base = opts.tint || spec.hull;
    g.addColorStop(0, shade(base, 28)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -38));
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = cs * 0.18; ctx.shadowOffsetY = cs * 0.06;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, cs * 0.035); ctx.strokeStyle = 'rgba(10,20,28,0.7)'; ctx.stroke();

    // deck details
    var dk = shade(base, -22), lt = shade(base, 45);
    ctx.fillStyle = dk; ctx.strokeStyle = dk;
    var u = cs, k;
    function turret(x, dir) {
      ctx.fillStyle = shade(base, -30);
      ctx.beginPath(); ctx.arc(x, 0, w * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(base, -45); ctx.lineWidth = w * 0.09;
      ctx.beginPath(); ctx.moveTo(x, -w * 0.07); ctx.lineTo(x + dir * w * 0.55, -w * 0.07);
      ctx.moveTo(x, w * 0.07); ctx.lineTo(x + dir * w * 0.55, w * 0.07); ctx.stroke();
    }
    function bridge(x, len) {
      ctx.fillStyle = lt; rr(ctx, x - len / 2, -w * 0.24, len, w * 0.48, w * 0.08); ctx.fill();
      ctx.fillStyle = 'rgba(20,40,55,0.8)'; ctx.fillRect(x + len / 2 - w * 0.12, -w * 0.18, w * 0.08, w * 0.36);
    }
    switch (cls) {
      case 'CV':
        ctx.fillStyle = shade(base, -30); rr(ctx, x0 + u * 0.15, -w * 0.42, L - u * 0.5, w * 0.84, w * 0.1); ctx.fill();
        ctx.strokeStyle = 'rgba(240,240,230,0.55)'; ctx.lineWidth = Math.max(1, u * 0.03); ctx.setLineDash([u * 0.18, u * 0.14]);
        ctx.beginPath(); ctx.moveTo(x0 + u * 0.3, 0); ctx.lineTo(x1 - u * 0.5, 0); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = lt; rr(ctx, u * 0.4, -w * 0.5, u * 0.55, w * 0.22, 2); ctx.fill();
        break;
      case 'BB': case 'DN':
        bridge(-u * 0.1, u * 0.7);
        var tp = cls === 'DN' ? [-1.7, -1.0, 0.9, 1.6] : [-1.25, 0.75, 1.35];
        tp.forEach(function (p) { turret(p * u, p > 0 ? 1 : -1); });
        break;
      case 'SS':
        ctx.fillStyle = shade(base, -35);
        ctx.beginPath(); ctx.ellipse(-u * 0.15, 0, u * 0.32, w * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0 + u * 0.3, 0); ctx.lineTo(x1 - u * 0.3, 0); ctx.stroke();
        break;
      case 'AR':
        bridge(-u * 1.2, u * 0.5);
        ctx.fillStyle = shade(base, -35);
        for (k = 0; k < 8; k++) ctx.fillRect(-u * 0.6 + (k % 4) * u * 0.42, (k < 4 ? -1 : 1) * w * 0.22 - w * 0.12, u * 0.32, w * 0.24);
        break;
      default:
        bridge(-u * 0.25, u * 0.55);
        turret(L / 2 - u * 0.7, 1);
        if (cls === 'AE' || cls === 'CA') {
          ctx.strokeStyle = lt; ctx.lineWidth = w * 0.08;
          ctx.beginPath(); ctx.arc(-u * 0.25, 0, w * 0.3, -0.9, 0.9); ctx.stroke();
        }
        if (cls === 'RT') {
          ctx.strokeStyle = '#d9b25a'; ctx.lineWidth = w * 0.08;
          ctx.beginPath(); ctx.moveTo(-L / 2 + u * 0.5, w * 0.25); ctx.lineTo(-L / 2 + u * 0.9, -w * 0.3); ctx.stroke();
        }
        if (cls === 'ML') {
          ctx.fillStyle = '#2a2f33';
          for (k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-L / 2 + u * (0.35 + k * 0.17), 0, w * 0.1, 0, Math.PI * 2); ctx.fill(); }
        }
    }
    if (opts.sunk) {
      hull();
      ctx.fillStyle = 'rgba(28,14,8,0.62)';
      ctx.fill();
    }
    ctx.restore();
  };

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---- board ------------------------------------------------------------------
  function Board(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.view = null;
    this.fx = [];
    this.parts = [];
    this.shakeT = 0; this.shakeMag = 0;
    this.aim = null;
    this.drag = null;
    this.t = 0;
    Board.all.push(this);
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.layout(); }).observe(canvas);
  }
  Board.all = [];
  FC.Board = Board;

  Board.prototype.setView = function (view) {
    var resized = !this.view || this.view.size !== view.size || this.view.map !== view.map;
    this.view = view;
    if (resized) { this.fx = []; this.parts = []; this.layout(); }
  };

  Board.prototype.layout = function () {
    if (!this.view) return;
    var r = this.cv.getBoundingClientRect();
    if (!r.width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.W = r.width; this.H = r.width;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    var size = this.view.size;
    this.m = this.opts.labels === false ? 0 : Math.max(14, Math.round(this.W * 0.055));
    this.cs = (this.W - this.m) / size;
    this.bg = null;
  };

  Board.prototype.center = function (i) {
    var s = this.view.size;
    return { x: this.m + (i % s + 0.5) * this.cs, y: this.m + (Math.floor(i / s) + 0.5) * this.cs };
  };
  Board.prototype.cellAt = function (clientX, clientY) {
    var r = this.cv.getBoundingClientRect(), s = this.view.size;
    var x = Math.floor((clientX - r.left - this.m) / this.cs), y = Math.floor((clientY - r.top - this.m) / this.cs);
    if (x < 0 || y < 0 || x >= s || y >= s) return -1;
    return y * s + x;
  };

  // Static layer: sea colour, grid, labels and islands — redrawn only on resize.
  Board.prototype.buildBg = function () {
    var v = this.view, size = v.size, cs = this.cs, m = this.m;
    var c = document.createElement('canvas');
    c.width = this.cv.width; c.height = this.cv.height;
    var x = c.getContext('2d');
    x.scale(this.dpr, this.dpr);
    var sea = v.map.sea, g = x.createLinearGradient(0, m, 0, this.H);
    g.addColorStop(0, sea[0]); g.addColorStop(1, sea[1]);
    x.fillStyle = g; x.fillRect(m, m, this.W - m, this.H - m);
    var rg = x.createRadialGradient(this.W * 0.3, this.H * 0.25, 0, this.W * 0.3, this.H * 0.25, this.W * 0.8);
    rg.addColorStop(0, 'rgba(120,200,220,0.14)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(m, m, this.W - m, this.H - m);

    x.strokeStyle = 'rgba(200,235,245,0.09)'; x.lineWidth = 1;
    for (var k = 0; k <= size; k++) {
      x.beginPath(); x.moveTo(m + k * cs, m); x.lineTo(m + k * cs, this.H); x.stroke();
      x.beginPath(); x.moveTo(m, m + k * cs); x.lineTo(this.W, m + k * cs); x.stroke();
    }
    if (m) {
      x.fillStyle = 'rgba(190,215,225,0.6)';
      x.font = '600 ' + Math.round(Math.min(m * 0.62, cs * 0.5)) + 'px "IBM Plex Mono", ui-monospace, monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      for (k = 0; k < size; k++) {
        x.fillText(FC.colName(k), m + (k + 0.5) * cs, m / 2);
        x.fillText(String(k + 1), m / 2, m + (k + 0.5) * cs);
      }
    }
    // islands: rounded cells bridged to their neighbours so they read as landmasses
    var bl = v.blocked;
    function land(color, inset, rad) {
      x.fillStyle = color;
      for (var i = 0; i < bl.length; i++) {
        if (!bl[i]) continue;
        var cx = i % size, cy = Math.floor(i / size), px = m + cx * cs, py = m + cy * cs, w = cs - 2 * inset;
        rr(x, px + inset, py + inset, w, w, Math.max(1, rad)); x.fill();
        var R = cx < size - 1 && bl[i + 1], D = cy < size - 1 && bl[i + size];
        if (R) x.fillRect(px + cs - inset - 1, py + inset, 2 * inset + 2, w);
        if (D) x.fillRect(px + inset, py + cs - inset - 1, w, 2 * inset + 2);
        if (R && D && bl[i + size + 1]) x.fillRect(px + cs - inset - 1, py + cs - inset - 1, 2 * inset + 2, 2 * inset + 2);
      }
    }
    land('rgba(170,230,235,0.16)', -cs * 0.2, cs * 0.5);
    land('rgba(170,230,235,0.14)', -cs * 0.08, cs * 0.42);
    land('#c9b27a', cs * 0.06, cs * 0.34);
    land('#5d8a4c', cs * 0.2, cs * 0.26);
    for (k = 0; k < bl.length; k++) {
      if (!bl[k]) continue;
      var q = this.center(k), h = (k * 2654435761) >>> 0;
      x.fillStyle = 'rgba(30,55,28,0.8)';
      x.beginPath(); x.arc(q.x + ((h % 7) - 3) * cs * 0.05, q.y + (((h >> 3) % 7) - 3) * cs * 0.05, cs * 0.09, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(120,100,70,0.7)';
      x.beginPath(); x.arc(q.x + (((h >> 6) % 9) - 4) * cs * 0.06, q.y + (((h >> 9) % 9) - 4) * cs * 0.06, cs * 0.05, 0, Math.PI * 2); x.fill();
    }
    this.bg = c;
    void self;
  };

  Board.prototype.shake = function (mag) {
    if (reduceMotion) return;
    this.shakeMag = Math.max(this.shakeMag, mag); this.shakeT = 0.35;
  };

  Board.prototype.isVisible = function () {
    return this.cv.offsetParent !== null;
  };

  Board.prototype.frame = function (dt) {
    if (!this.view) return;
    if (!this.W) this.layout();
    if (!this.W) return;
    this.t += dt;
    var ctx = this.ctx, v = this.view, cs = this.cs, m = this.m, t = this.t, self = this;
    if (!this.bg) this.buildBg();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    var sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      var s = this.shakeMag * Math.max(0, this.shakeT / 0.35);
      sx = (Math.random() - 0.5) * s; sy = (Math.random() - 0.5) * s;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);
    ctx.drawImage(this.bg, 0, 0, this.W, this.H);

    // moving swell lines
    ctx.save();
    ctx.beginPath(); ctx.rect(m, m, this.W - m, this.H - m); ctx.clip();
    ctx.strokeStyle = 'rgba(210,245,255,0.05)'; ctx.lineWidth = 1.2;
    var rows = v.size * 2;
    for (var k = 0; k < rows; k++) {
      var y0 = m + (k + 0.5) * (this.H - m) / rows;
      ctx.beginPath();
      for (var xx = m; xx <= this.W; xx += 6) {
        var yy = y0 + Math.sin(xx * 0.035 + t * 1.1 + k * 1.7) * cs * 0.08 + Math.sin(xx * 0.011 - t * 0.6 + k) * cs * 0.05;
        if (xx === m) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    // glints
    for (k = 0; k < v.size * 3; k++) {
      var ph = (t * 0.5 + k * 0.618) % 1, gx = m + ((k * 0.7548 * 997) % 1) * (this.W - m), gy = m + ((k * 0.5698 * 991) % 1) * (this.H - m);
      ctx.fillStyle = 'rgba(255,255,255,' + (Math.sin(ph * Math.PI) * 0.12).toFixed(3) + ')';
      ctx.fillRect(gx, gy, 2, 1);
    }
    ctx.restore();

    var G = v.grid;
    // recon counts in the label gutter
    if (G && G.recon && m) {
      G.recon.forEach(function (r) {
        var c = r.o ? { x: m + (r.n + 0.5) * cs, y: m / 2 } : { x: m / 2, y: m + (r.n + 0.5) * cs };
        ctx.fillStyle = r.count ? '#e0a63a' : '#4fd1c5';
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.min(m, cs) * 0.46, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#061722';
        ctx.font = '700 ' + Math.round(Math.min(m, cs) * 0.55) + 'px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(r.count), c.x, c.y + 0.5);
      });
    }

    // ships (own fleet, or sunk enemy wrecks)
    if (v.ships) {
      v.ships.forEach(function (sh, idx) {
        if (self.drag && self.drag.idx === idx) return;
        if (!v.own && !sh.sunk && !v.reveal) return;
        var a = self.center(sh.cells[0]), b = self.center(sh.cells[sh.cells.length - 1]);
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (v.own && !sh.sunk) {
          // gentle bob + stern wake
          var bob = Math.sin(t * 1.6 + idx) * cs * 0.015;
          cy += sh.d ? 0 : bob; cx += sh.d ? bob : 0;
          var st = self.center(sh.cells[0]), dx = sh.d ? 0 : -1, dy = sh.d ? -1 : 0;
          var sx0 = st.x + dx * cs * 0.42, sy0 = st.y + dy * cs * 0.42;
          ctx.lineWidth = Math.max(1, cs * 0.04); ctx.lineCap = 'round';
          for (var w = 0; w < 3; w++) {
            var off = (t * 0.6 + w / 3) % 1, len = cs * (0.15 + off * 0.45), spr = cs * (0.06 + off * 0.22);
            ctx.strokeStyle = 'rgba(230,250,255,' + (0.28 * (1 - off)).toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(sx0 + dx * len - dy * spr, sy0 + dy * len - dx * spr);
            ctx.lineTo(sx0 + dx * len * 0.6, sy0 + dy * len * 0.6);
            ctx.lineTo(sx0 + dx * len + dy * spr, sy0 + dy * len + dx * spr);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        FC.drawShip(ctx, sh.c, cs, cx, cy, sh.d, { sunk: sh.sunk, alpha: (!v.own && !sh.sunk) ? 0.6 : 1 });
      });
    }

    if (G) this.drawMarks(ctx, G, v);

    // aiming preview
    if (this.aim) {
      var A = this.aim, pulse = 0.5 + Math.sin(t * 6) * 0.5;
      ctx.fillStyle = A.bad ? 'rgba(255,90,60,0.22)' : 'rgba(224,166,58,' + (0.18 + pulse * 0.12).toFixed(3) + ')';
      ctx.strokeStyle = A.bad ? 'rgba(255,90,60,0.8)' : 'rgba(255,210,120,0.85)';
      ctx.lineWidth = 1.5;
      (A.cells || []).forEach(function (c) {
        var p = self.center(c);
        ctx.fillRect(p.x - cs / 2 + 1, p.y - cs / 2 + 1, cs - 2, cs - 2);
        ctx.strokeRect(p.x - cs / 2 + 1.5, p.y - cs / 2 + 1.5, cs - 3, cs - 3);
      });
      if (A.center >= 0) this.drawReticle(ctx, this.center(A.center), A.bad);
    }

    // drag ghost during placement
    if (this.drag && this.drag.ship) {
      var d = this.drag;
      FC.drawShip(ctx, d.ship.c, cs, d.x, d.y, d.ship.d, { alpha: 0.85, tint: d.bad ? '#b5543f' : null });
    }

    // particles + effects
    this.updateParts(dt, ctx);
    for (k = this.fx.length - 1; k >= 0; k--) {
      var f = this.fx[k];
      f.age += dt;
      if (f.draw(ctx, f.age, dt) === false || f.age > f.life) {
        if (f.done) f.done();
        this.fx.splice(k, 1);
      }
    }
    ctx.restore();
  };

  Board.prototype.drawReticle = function (ctx, p, bad) {
    var cs = this.cs, r = cs * 0.42, a = this.t * 1.6;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = bad ? '#ff5a3c' : '#ffd27a'; ctx.lineWidth = 2;
    ctx.rotate(a);
    for (var k = 0; k < 4; k++) {
      ctx.beginPath(); ctx.arc(0, 0, r, k * Math.PI / 2 + 0.25, k * Math.PI / 2 + Math.PI / 2 - 0.25); ctx.stroke();
    }
    ctx.rotate(-a);
    ctx.beginPath();
    ctx.moveTo(-r * 1.25, 0); ctx.lineTo(-r * 0.45, 0); ctx.moveTo(r * 0.45, 0); ctx.lineTo(r * 1.25, 0);
    ctx.moveTo(0, -r * 1.25); ctx.lineTo(0, -r * 0.45); ctx.moveTo(0, r * 0.45); ctx.lineTo(0, r * 1.25);
    ctx.stroke();
    ctx.restore();
  };

  Board.prototype.drawMarks = function (ctx, G, v) {
    var cs = this.cs, t = this.t, self = this, N = G.shot.length;
    // shield
    if (G.shield && G.shield.length) {
      var set = {};
      G.shield.forEach(function (c) { set[c] = 1; });
      var size = v.size;
      ctx.fillStyle = 'rgba(110,190,255,' + (0.14 + Math.sin(t * 3) * 0.04).toFixed(3) + ')';
      G.shield.forEach(function (c) { var p = self.center(c); ctx.fillRect(p.x - cs / 2, p.y - cs / 2, cs, cs); });
      ctx.strokeStyle = 'rgba(150,215,255,0.85)'; ctx.lineWidth = 2;
      ctx.setLineDash([cs * 0.25, cs * 0.12]); ctx.lineDashOffset = -t * 20;
      G.shield.forEach(function (c) {
        var p = self.center(c), x = c % size, y = Math.floor(c / size), h = cs / 2;
        ctx.beginPath();
        if (y === 0 || !set[c - size]) { ctx.moveTo(p.x - h, p.y - h); ctx.lineTo(p.x + h, p.y - h); }
        if (y === size - 1 || !set[c + size]) { ctx.moveTo(p.x - h, p.y + h); ctx.lineTo(p.x + h, p.y + h); }
        if (x === 0 || !set[c - 1]) { ctx.moveTo(p.x - h, p.y - h); ctx.lineTo(p.x - h, p.y + h); }
        if (x === size - 1 || !set[c + 1]) { ctx.moveTo(p.x + h, p.y - h); ctx.lineTo(p.x + h, p.y + h); }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    for (var i = 0; i < N; i++) {
      var s = G.shot[i], p;
      if (s === 1) {
        p = this.center(i);
        ctx.fillStyle = 'rgba(225,240,248,0.85)';
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(225,240,248,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.27, 0, Math.PI * 2); ctx.stroke();
      } else if (s === 2) {
        p = this.center(i);
        var gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cs * 0.55);
        gl.addColorStop(0, 'rgba(255,170,70,' + (0.75 + Math.sin(t * 9 + i) * 0.15).toFixed(3) + ')');
        gl.addColorStop(0.45, 'rgba(255,80,40,0.45)');
        gl.addColorStop(1, 'rgba(255,60,30,0)');
        ctx.fillStyle = gl; ctx.fillRect(p.x - cs / 2, p.y - cs / 2, cs, cs);
        ctx.fillStyle = '#ffe0a0';
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.1, 0, Math.PI * 2); ctx.fill();
        if (!reduceMotion && Math.random() < 0.35) this.flame(p.x, p.y);
      } else if (s === 3) {
        p = this.center(i);
        ctx.fillStyle = 'rgba(15,12,10,0.55)';
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.34, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,140,60,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.2, 0, Math.PI * 2); ctx.stroke();
      }
      if (!s && G.intel[i]) {
        p = this.center(i);
        if (G.intel[i] === 2) {
          var pu = 0.6 + Math.sin(t * 4 + i) * 0.4, r = cs * 0.22;
          ctx.strokeStyle = 'rgba(255,190,80,' + pu.toFixed(3) + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.stroke();
          ctx.fillStyle = 'rgba(255,190,80,0.25)'; ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(79,209,197,0.45)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(p.x - cs * 0.1, p.y - cs * 0.1); ctx.lineTo(p.x + cs * 0.1, p.y + cs * 0.1);
          ctx.moveTo(p.x + cs * 0.1, p.y - cs * 0.1); ctx.lineTo(p.x - cs * 0.1, p.y + cs * 0.1); ctx.stroke();
        }
      }
      if (!s && G.repaired[i]) {
        p = this.center(i);
        ctx.strokeStyle = 'rgba(120,230,140,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - cs * 0.1, p.y); ctx.lineTo(p.x + cs * 0.1, p.y); ctx.moveTo(p.x, p.y - cs * 0.1); ctx.lineTo(p.x, p.y + cs * 0.1); ctx.stroke();
      }
      if (v.own && G.mine && G.mine[i] && !s) {
        p = this.center(i);
        ctx.fillStyle = '#20272c'; ctx.strokeStyle = '#20272c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.17, 0, Math.PI * 2); ctx.fill();
        for (var sp = 0; sp < 6; sp++) {
          var an = sp * Math.PI / 3;
          ctx.beginPath(); ctx.moveTo(p.x + Math.cos(an) * cs * 0.15, p.y + Math.sin(an) * cs * 0.15);
          ctx.lineTo(p.x + Math.cos(an) * cs * 0.26, p.y + Math.sin(an) * cs * 0.26); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,70,50,' + (0.5 + Math.sin(t * 5) * 0.5).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.05, 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  // ---- particles ---------------------------------------------------------------
  Board.prototype.part = function (o) {
    if (this.parts.length > 900) return;
    o.age = 0; this.parts.push(o);
  };
  Board.prototype.flame = function (x, y) {
    var cs = this.cs;
    this.part({ kind: 'fire', x: x + (Math.random() - 0.5) * cs * 0.3, y: y, vx: (Math.random() - 0.5) * 6, vy: -cs * (0.6 + Math.random() * 0.6),
      life: 0.5 + Math.random() * 0.4, size: cs * (0.1 + Math.random() * 0.1), drag: 0.98 });
    if (Math.random() < 0.4) this.part({ kind: 'smoke', x: x, y: y - cs * 0.2, vx: 4 + Math.random() * 6, vy: -cs * 0.5, life: 1.6, size: cs * 0.14, drag: 0.99 });
  };
  Board.prototype.updateParts = function (dt, ctx) {
    var P = this.parts;
    for (var k = P.length - 1; k >= 0; k--) {
      var p = P[k];
      p.age += dt;
      if (p.age >= p.life) { P.splice(k, 1); continue; }
      p.vy += (p.g || 0) * dt;
      p.vx *= p.drag || 1; p.vy *= p.drag || 1;
      p.x += p.vx * dt; p.y += p.vy * dt;
      var f = p.age / p.life, a = 1 - f;
      switch (p.kind) {
        case 'fire':
          ctx.fillStyle = f < 0.3 ? 'rgba(255,230,140,' + a + ')' : f < 0.6 ? 'rgba(255,130,40,' + a * 0.9 + ')' : 'rgba(120,60,40,' + a * 0.6 + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - f * 0.5), 0, Math.PI * 2); ctx.fill(); break;
        case 'smoke':
          ctx.fillStyle = 'rgba(40,40,44,' + (a * 0.4).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + f * 2.2), 0, Math.PI * 2); ctx.fill(); break;
        case 'spark':
          ctx.strokeStyle = 'rgba(255,220,150,' + a + ')'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke(); break;
        case 'water':
          ctx.fillStyle = 'rgba(225,245,255,' + (a * 0.9).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - f * 0.4), 0, Math.PI * 2); ctx.fill(); break;
        case 'debris':
          ctx.fillStyle = 'rgba(30,30,30,' + a + ')';
          ctx.fillRect(p.x, p.y, p.size, p.size); break;
        case 'trail':
          ctx.fillStyle = 'rgba(200,205,210,' + (a * 0.35).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + f), 0, Math.PI * 2); ctx.fill(); break;
        case 'green':
          ctx.fillStyle = 'rgba(120,240,150,' + a + ')';
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); break;
      }
    }
  };

  // ---- one-shot effects (each returns a Promise) --------------------------------
  Board.prototype.snd = function (name, big) { if (!this.opts.silent) Sound.play(name, big); };
  Board.prototype.clearFx = function () {
    this.fx.forEach(function (f) { if (f.done) f.done(); });
    this.fx = []; this.parts = [];
  };
  Board.prototype.add = function (life, draw) {
    var self = this;
    return new Promise(function (res) {
      if (!self.view) return res();
      self.fx.push({ age: 0, life: life / FC.settings.speed, draw: function (ctx, age, dt) { return draw.call(self, ctx, age * FC.settings.speed, dt); }, done: res });
    });
  };

  Board.prototype.ring = function (x, y, r0, r1, life, color, width) {
    return this.add(life, function (ctx, age) {
      var f = Math.min(1, age / life);
      ctx.strokeStyle = color.replace('A', (1 - f).toFixed(3)); ctx.lineWidth = width * (1 - f * 0.6);
      ctx.beginPath(); ctx.arc(x, y, r0 + (r1 - r0) * (1 - Math.pow(1 - f, 2)), 0, Math.PI * 2); ctx.stroke();
    });
  };

  Board.prototype.explode = function (i, big) {
    var p = this.center(i), cs = this.cs, k;
    this.snd('boom', big);
    this.shake(big ? cs * 0.6 : cs * 0.3);
    var n = reduceMotion ? 8 : (big ? 46 : 26);
    for (k = 0; k < n; k++) {
      var a = Math.random() * Math.PI * 2, sp = cs * (1 + Math.random() * (big ? 5 : 3.2));
      this.part({ kind: 'fire', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cs, life: 0.35 + Math.random() * 0.45, size: cs * (0.12 + Math.random() * 0.18), drag: 0.9 });
    }
    for (k = 0; k < n / 2; k++) {
      var a2 = Math.random() * Math.PI * 2, s2 = cs * (2 + Math.random() * 5);
      this.part({ kind: 'spark', x: p.x, y: p.y, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2, g: cs * 9, life: 0.5 + Math.random() * 0.4, drag: 0.97 });
      this.part({ kind: 'debris', x: p.x, y: p.y, vx: Math.cos(a2) * s2 * 0.5, vy: Math.sin(a2) * s2 * 0.5 - cs * 2, g: cs * 10, life: 0.8, size: Math.max(2, cs * 0.06), drag: 0.98 });
    }
    for (k = 0; k < 6; k++) this.part({ kind: 'smoke', x: p.x, y: p.y, vx: (Math.random() - 0.5) * cs, vy: -cs * Math.random(), life: 1.8, size: cs * 0.2, drag: 0.97 });
    this.ring(p.x, p.y, cs * 0.2, cs * (big ? 2.4 : 1.5), 0.5, 'rgba(255,230,180,A)', 3);
    return this.add(0.28, function (ctx, age) {
      var f = age / 0.28, r = cs * (big ? 1.3 : 0.9) * (0.5 + f);
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(255,255,230,' + (1 - f) + ')'); g.addColorStop(0.4, 'rgba(255,170,60,' + (0.8 * (1 - f)) + ')'); g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    });
  };

  Board.prototype.splash = function (i) {
    var p = this.center(i), cs = this.cs, k;
    this.snd('splash');
    var n = reduceMotion ? 6 : 26;
    for (k = 0; k < n; k++) {
      this.part({ kind: 'water', x: p.x + (Math.random() - 0.5) * cs * 0.3, y: p.y, vx: (Math.random() - 0.5) * cs * 1.6, vy: -cs * (2 + Math.random() * 3.5), g: cs * 12, life: 0.55 + Math.random() * 0.3, size: cs * (0.05 + Math.random() * 0.07), drag: 0.99 });
    }
    this.ring(p.x, p.y, cs * 0.1, cs * 0.9, 0.9, 'rgba(230,250,255,A)', 2);
    return this.ring(p.x, p.y, cs * 0.05, cs * 0.55, 0.7, 'rgba(230,250,255,A)', 2.5);
  };

  Board.prototype.popText = function (i, text, color) {
    var p = this.center(i), cs = this.cs, W = this.W;
    return this.add(1.1, function (ctx, age) {
      var f = age / 1.1;
      ctx.save();
      ctx.globalAlpha = f < 0.15 ? f / 0.15 : 1 - Math.max(0, (f - 0.6) / 0.4);
      ctx.font = Math.round(Math.max(16, cs * 0.75)) + 'px "Saira Stencil One", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var x = Math.max(cs * 1.6, Math.min(W - cs * 1.6, p.x)), y = p.y - cs * 0.6 - f * cs * 0.8;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(4,14,20,0.85)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
      ctx.restore();
    });
  };

  // Shell arcs in from off-board: from the bottom when you fire, from the top
  // when the enemy fires at you.
  Board.prototype.shell = function (i, delay) {
    var self = this, p = this.center(i), cs = this.cs, fromTop = this.view.own;
    var x0 = this.W / 2 + (Math.random() - 0.5) * this.W * 0.4, y0 = fromTop ? -cs : this.H + cs;
    var life = 0.6;
    this.snd('cannon');
    this.snd('whistle');
    return FC.wait(delay || 0).then(function () {
      return self.add(life, function (ctx, age) {
        var f = Math.min(1, age / life), h = cs * 3;
        var x = x0 + (p.x - x0) * f, y = y0 + (p.y - y0) * f - Math.sin(f * Math.PI) * h;
        var sz = cs * (0.12 + Math.sin(f * Math.PI) * 0.08);
        self.part({ kind: 'trail', x: x, y: y, vx: 0, vy: 0, life: 0.5, size: sz * 0.8 });
        ctx.fillStyle = '#ffe8b0'; ctx.shadowColor = '#ffb040'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // shadow on the water
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(x0 + (p.x - x0) * f, y0 + (p.y - y0) * f, sz, sz * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      });
    });
  };

  Board.prototype.missiles = function (cells) {
    var self = this;
    this.snd('missile');
    return Promise.all(cells.map(function (c, k) {
      var p = self.center(c), cs = self.cs, x0 = (k % 2 ? self.W * 0.1 : self.W * 0.9), y0 = self.view.own ? -cs : self.H + cs;
      return FC.wait(k * 140).then(function () {
        return self.add(0.7, function (ctx, age) {
          var f = Math.min(1, age / 0.7), e = f * f;
          var cx = x0 + (p.x - x0) * e, cy = y0 + (p.y - y0) * f - Math.sin(f * Math.PI) * cs * 2;
          self.part({ kind: 'trail', x: cx, y: cy, vx: 0, vy: 0, life: 0.6, size: cs * 0.08 });
          self.part({ kind: 'fire', x: cx, y: cy, vx: 0, vy: 0, life: 0.12, size: cs * 0.08 });
          ctx.fillStyle = '#e8eef2'; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.08, 0, Math.PI * 2); ctx.fill();
        });
      });
    }));
  };

  // Three jets sweep along the strike line; resolves as the bombs land.
  Board.prototype.planes = function (cells, o) {
    var self = this, cs = this.cs, a = this.center(cells[0]), b = this.center(cells[cells.length - 1]);
    var dx = o ? 0 : 1, dy = o ? 1 : 0;
    var sx = a.x - dx * this.W * 0.6, sy = a.y - dy * this.H * 0.6, ex = b.x + dx * this.W * 0.6, ey = b.y + dy * this.H * 0.6;
    var life = 1.5;
    this.snd('jet');
    var draw = function (ctx, age) {
      var f = Math.min(1, age / life);
      for (var k = 0; k < 3; k++) {
        var off = (k - 1) * cs * 0.7, lag = Math.abs(k - 1) * 0.04;
        var ff = Math.max(0, f - lag), x = sx + (ex - sx) * ff + dy * off, y = sy + (ey - sy) * ff - dx * off;
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(ey - sy, ex - sx));
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        jet(ctx, cs * 0.5, cs * 0.5, cs * 0.9);
        ctx.fillStyle = '#cfd8de';
        jet(ctx, 0, 0, cs * 0.9);
        ctx.restore();
      }
    };
    function jet(ctx, ox, oy, s) {
      ctx.beginPath();
      ctx.moveTo(ox + s * 0.6, oy); ctx.lineTo(ox - s * 0.1, oy - s * 0.55); ctx.lineTo(ox - s * 0.25, oy - s * 0.55);
      ctx.lineTo(ox - s * 0.05, oy - s * 0.08); ctx.lineTo(ox - s * 0.45, oy - s * 0.08); ctx.lineTo(ox - s * 0.6, oy - s * 0.25);
      ctx.lineTo(ox - s * 0.55, oy); ctx.lineTo(ox - s * 0.6, oy + s * 0.25); ctx.lineTo(ox - s * 0.45, oy + s * 0.08);
      ctx.lineTo(ox - s * 0.05, oy + s * 0.08); ctx.lineTo(ox - s * 0.25, oy + s * 0.55); ctx.lineTo(ox - s * 0.1, oy + s * 0.55);
      ctx.closePath(); ctx.fill();
    }
    this.add(life, draw);
    // time when the lead jet is over the first cell
    var total = Math.hypot(ex - sx, ey - sy), first = Math.hypot(a.x - sx, a.y - sy);
    return FC.wait(life * 1000 * first / total);
  };

  Board.prototype.torpedo = function (path, hitAt) {
    var self = this, cs = this.cs, pts = path.map(function (c) { return self.center(c); });
    if (!pts.length) return Promise.resolve();
    var a = pts[0], b = pts[pts.length - 1];
    var dirx = Math.sign(b.x - a.x) || (pts.length > 1 ? 0 : 1), diry = Math.sign(b.y - a.y);
    if (!dirx && !diry) { if (path.length === 1) dirx = 1; }
    var sx = a.x - dirx * cs * 0.8, sy = a.y - diry * cs * 0.8;
    var dur = 0.35 + pts.length * 0.09;
    this.snd('torpedo');
    return this.add(dur, function (ctx, age) {
      var f = Math.min(1, age / dur), x = sx + (b.x - sx) * f, y = sy + (b.y - sy) * f;
      ctx.strokeStyle = 'rgba(235,250,255,0.55)'; ctx.lineWidth = cs * 0.12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = 'rgba(235,250,255,0.2)'; ctx.lineWidth = cs * 0.35; ctx.stroke();
      ctx.fillStyle = '#2b3338';
      ctx.beginPath(); ctx.arc(x, y, cs * 0.1, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.5) self.part({ kind: 'water', x: x, y: y, vx: (Math.random() - 0.5) * cs, vy: (Math.random() - 0.5) * cs, life: 0.4, size: cs * 0.05 });
      void hitAt;
    });
  };

  Board.prototype.homing = function (i) {
    var self = this, cs = this.cs, p = this.center(i), x0 = this.W * 0.5, y0 = this.view.own ? 0 : this.H;
    var dur = 1.1;
    this.snd('torpedo');
    return this.add(dur, function (ctx, age) {
      var f = Math.min(1, age / dur);
      var x = x0 + (p.x - x0) * f + Math.sin(f * 12) * cs * 0.4 * (1 - f), y = y0 + (p.y - y0) * f;
      self.part({ kind: 'water', x: x, y: y, vx: 0, vy: 0, life: 0.6, size: cs * 0.07 });
      ctx.fillStyle = '#ff5a3c'; ctx.beginPath(); ctx.arc(x, y, cs * 0.09, 0, Math.PI * 2); ctx.fill();
    });
  };

  Board.prototype.sonar = function (center, cells, contacts) {
    var self = this, cs = this.cs, p = this.center(center);
    this.snd('ping');
    contacts.forEach(function (c, k) { setTimeout(function () { self.snd('blip'); }, 450 + k * 120); });
    return this.add(1.3, function (ctx, age) {
      var f = age / 1.3;
      for (var k = 0; k < 3; k++) {
        var ff = (f * 1.4 - k * 0.2);
        if (ff <= 0 || ff >= 1) continue;
        ctx.strokeStyle = 'rgba(79,209,197,' + (1 - ff).toFixed(3) + ')'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 1.8 * ff, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(79,209,197,' + (0.12 * (1 - f)).toFixed(3) + ')';
      cells.forEach(function (c) { var q = self.center(c); ctx.fillRect(q.x - cs / 2, q.y - cs / 2, cs, cs); });
      var an = f * Math.PI * 4;
      ctx.strokeStyle = 'rgba(120,255,230,' + (0.7 * (1 - f)).toFixed(3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(an) * cs * 1.6, p.y + Math.sin(an) * cs * 1.6); ctx.stroke();
    });
  };

  Board.prototype.recon = function (cells, o) {
    var self = this, cs = this.cs, a = this.center(cells[0]), b = this.center(cells[cells.length - 1]);
    var dur = 1.3;
    this.snd('jet');
    return this.add(dur, function (ctx, age) {
      var f = Math.min(1, age / dur), x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      ctx.fillStyle = 'rgba(79,209,197,0.14)';
      if (o) ctx.fillRect(a.x - cs / 2, a.y - cs / 2, cs, y - a.y + cs / 2);
      else ctx.fillRect(a.x - cs / 2, a.y - cs / 2, x - a.x + cs / 2, cs);
      ctx.save(); ctx.translate(x, y); ctx.rotate(o ? Math.PI / 2 : 0);
      ctx.fillStyle = '#d6e2e8';
      ctx.beginPath(); ctx.moveTo(cs * 0.4, 0); ctx.lineTo(-cs * 0.2, -cs * 0.5); ctx.lineTo(-cs * 0.05, 0); ctx.lineTo(-cs * 0.2, cs * 0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
  };

  Board.prototype.shieldUp = function (cells, center) {
    var p = this.center(center), cs = this.cs;
    this.snd('shield');
    return this.add(0.8, function (ctx, age) {
      var f = Math.min(1, age / 0.8);
      ctx.strokeStyle = 'rgba(150,215,255,' + (1 - f * 0.6).toFixed(3) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, cs * 2.1 * f, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(110,190,255,' + (0.25 * (1 - f)).toFixed(3) + ')';
      ctx.fill();
      void cells;
    });
  };

  Board.prototype.deflect = function (i) {
    var p = this.center(i), cs = this.cs;
    this.snd('deflect');
    for (var k = 0; k < 14; k++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = cs * (2 + Math.random() * 3);
      this.part({ kind: 'spark', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: cs * 6, life: 0.5, drag: 0.96 });
    }
    return this.add(0.5, function (ctx, age) {
      var f = age / 0.5;
      ctx.fillStyle = 'rgba(160,220,255,' + (0.6 * (1 - f)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, cs * (0.4 + f * 0.5), 0, Math.PI * 2); ctx.fill();
    });
  };

  Board.prototype.repairFx = function (i) {
    var p = this.center(i), cs = this.cs;
    this.snd('repair');
    for (var k = 0; k < 22; k++) {
      this.part({ kind: 'green', x: p.x + (Math.random() - 0.5) * cs, y: p.y + (Math.random() - 0.5) * cs, vx: 0, vy: -cs * (0.5 + Math.random()), life: 0.9 });
    }
    return this.ring(p.x, p.y, cs * 0.6, cs * 0.1, 0.7, 'rgba(120,240,150,A)', 3);
  };

  Board.prototype.mineDrop = function (i) {
    var p = this.center(i), cs = this.cs;
    this.snd('mine');
    return this.ring(p.x, p.y, cs * 0.05, cs * 0.6, 0.7, 'rgba(230,250,255,A)', 2);
  };

  Board.prototype.lightning = function (i) {
    var p = this.center(i), self = this, W = this.W, H = this.H, cs = this.cs;
    var pts = [{ x: p.x + (Math.random() - 0.5) * W * 0.3, y: 0 }];
    for (var k = 1; k < 9; k++) pts.push({ x: pts[0].x + (p.x - pts[0].x) * k / 9 + (Math.random() - 0.5) * cs * 1.2, y: p.y * k / 9 });
    pts.push(p);
    this.snd('zap');
    this.shake(cs * 0.4);
    return this.add(0.45, function (ctx, age) {
      var f = age / 0.45, a = f < 0.2 ? 1 : (1 - f) * (Math.random() < 0.3 ? 0.3 : 1);
      ctx.fillStyle = 'rgba(220,230,255,' + (0.35 * a).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(240,245,255,' + a + ')'; ctx.lineWidth = 3; ctx.shadowColor = '#9fc4ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); pts.forEach(function (q, n) { if (n) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
      ctx.shadowBlur = 0;
      void self;
    });
  };

  Board.prototype.kraken = function (i) {
    var p = this.center(i), cs = this.cs;
    this.snd('kraken');
    this.shake(cs * 0.3);
    return this.add(1.2, function (ctx, age) {
      var f = Math.min(1, age / 1.2), rise = Math.sin(f * Math.PI);
      ctx.strokeStyle = '#5b2a4f'; ctx.lineCap = 'round';
      for (var k = -1; k <= 1; k++) {
        var bx = p.x + k * cs * 0.6, h = cs * 1.6 * rise * (k ? 0.7 : 1);
        ctx.lineWidth = cs * (k ? 0.18 : 0.26);
        ctx.beginPath(); ctx.moveTo(bx, p.y + cs * 0.3);
        ctx.quadraticCurveTo(bx + Math.sin(age * 6 + k) * cs * 0.6, p.y - h * 0.5, bx + Math.cos(age * 5 + k) * cs * 0.4, p.y - h);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(230,250,255,' + (0.6 * rise).toFixed(3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + cs * 0.3, cs * 1.1, cs * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    });
  };

  // ---- animation loop -------------------------------------------------------------
  var last = 0;
  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    Board.all.forEach(function (b) { if (b.isVisible()) b.frame(dt); });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.addEventListener('resize', function () { Board.all.forEach(function (b) { b.layout(); }); });
})(window.FC = window.FC || {});

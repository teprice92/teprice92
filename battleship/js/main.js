/* Fleet Command — screens, fleet builder, battle controller and game flow. */
(function (FC) {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // ---- small helpers -----------------------------------------------------------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('fc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('fc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del: function (k) { try { localStorage.removeItem('fc.' + k); } catch (e) { /* ignore */ } }
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function cleanName(s, d) {
    s = String(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').trim().slice(0, 16);
    return s || d;
  }

  function show(id) {
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'scr-' + id); });
    App.screen = id;
  }
  function openOv(id) { $('#' + id).classList.add('open'); }
  function closeOv(id) { $('#' + id).classList.remove('open'); }

  var toastBox = null;
  function toast(msg, kind) {
    toastBox = toastBox || $('#toasts');
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    toastBox.appendChild(t);
    while (toastBox.children.length > 3) toastBox.removeChild(toastBox.firstChild);
    setTimeout(function () { t.remove(); }, 2700);
  }
  var bannerT = null;
  function banner(main, sub, color) {
    var b = $('#banner');
    b.classList.remove('show');
    void b.offsetWidth;
    b.querySelector('.banner-main').textContent = main;
    b.querySelector('.banner-main').style.color = color || '';
    b.querySelector('.banner-sub').textContent = sub || '';
    b.classList.add('show');
    clearTimeout(bannerT);
    bannerT = setTimeout(function () { b.classList.remove('show'); }, 1700);
  }

  // ---- settings ----------------------------------------------------------------
  Object.assign(FC.settings, store.get('settings', {}));
  function saveSettings() { store.set('settings', FC.settings); syncSettingsUI(); }
  function syncSettingsUI() {
    $('#set-sound').checked = FC.settings.sound;
    $('#set-vibrate').checked = FC.settings.vibrate;
    $$('#set-speed .seg-btn').forEach(function (b) { b.classList.toggle('on', +b.dataset.speed === FC.settings.speed); });
    $('#b-sound').style.opacity = FC.settings.sound ? 1 : 0.35;
  }

  var AI_NAMES = { easy: 'Ensign Byte', normal: 'Captain Circuit', hard: 'Admiral Kraken' };

  var App = {
    screen: 'menu', mode: null, level: store.get('level', 'normal'), mapId: store.get('map', 'open'),
    names: [store.get('name', ''), store.get('name2', '')],
    classes: [store.get('classes', null), null],
    fleets: [null, null], seed: 0, net: null, battle: null, onlineTab: 'host'
  };

  // ---- menu attract mode ---------------------------------------------------------
  var menuBoard, menuState;
  function menuInit() {
    menuBoard = new FC.Board($('#menu-sea'), { labels: false, silent: true });
    var map = FC.mapById('open');
    function reset() {
      var fleet = FC.randomFleet(FC.CLASSIC_FLEET, map);
      var N = map.size * map.size;
      var grid = { shot: new Uint8Array(N), intel: new Uint8Array(N), repaired: new Uint8Array(N), mine: new Uint8Array(N), recon: [], shield: null };
      var ships = fleet.map(function (s) { return { c: s.c, x: s.x, y: s.y, d: s.d, cells: FC.shipCells(s, map.size), sunk: false }; });
      menuState = { grid: grid, ships: ships, n: 0 };
      menuBoard.setView({ map: map, size: map.size, blocked: FC.terrainOf(map), grid: grid, ships: ships, own: true });
    }
    reset();
    setInterval(function () {
      if (App.screen !== 'menu' || document.hidden) return;
      if (menuState.n++ > 26) return reset();
      var i = Math.floor(Math.random() * 100);
      if (menuState.grid.shot[i]) return;
      menuBoard.shell(i).then(function () {
        var hit = menuState.ships.some(function (s) { return s.cells.indexOf(i) >= 0; });
        menuState.grid.shot[i] = hit ? 2 : 1;
        if (hit) menuBoard.explode(i); else menuBoard.splash(i);
      });
    }, 1400);
    var saved = store.get('online', null);
    if (saved && Date.now() - saved.at < 12 * 3600e3 && saved.local && saved.local.f) {
      var b = $('#m-rejoin');
      b.textContent = 'Rejoin online room ' + saved.code;
      b.classList.remove('hidden');
      b.onclick = function () { b.classList.add('hidden'); rejoinOnline(saved); };
    }
  }

  // ---- setup screen ---------------------------------------------------------------
  function drawMapPreview(cv, map) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = 140;
    cv.width = W * dpr; cv.height = W * dpr;
    var x = cv.getContext('2d'); x.scale(dpr, dpr);
    var g = x.createLinearGradient(0, 0, 0, W); g.addColorStop(0, map.sea[0]); g.addColorStop(1, map.sea[1]);
    x.fillStyle = g; x.fillRect(0, 0, W, W);
    var cs = W / map.size;
    x.strokeStyle = 'rgba(200,235,245,0.1)';
    for (var k = 0; k <= map.size; k++) {
      x.beginPath(); x.moveTo(k * cs, 0); x.lineTo(k * cs, W); x.moveTo(0, k * cs); x.lineTo(W, k * cs); x.stroke();
    }
    var bl = FC.terrainOf(map);
    for (k = 0; k < bl.length; k++) {
      if (!bl[k]) continue;
      var cx = (k % map.size + 0.5) * cs, cy = (Math.floor(k / map.size) + 0.5) * cs;
      x.fillStyle = '#c9b27a'; x.beginPath(); x.arc(cx, cy, cs * 0.66, 0, 7); x.fill();
      x.fillStyle = '#4f7a45'; x.beginPath(); x.arc(cx, cy, cs * 0.4, 0, 7); x.fill();
    }
    if (map.event) {
      x.font = '600 11px "IBM Plex Mono", monospace'; x.fillStyle = 'rgba(255,210,122,0.9)';
      x.fillText(map.event.kind === 'lightning' ? 'ϟ STORM' : '∿ KRAKEN', 6, W - 8);
    }
    if (map.seaMines) {
      x.font = '600 11px "IBM Plex Mono", monospace'; x.fillStyle = 'rgba(255,140,110,0.95)';
      x.fillText('✶ MINES', 6, W - 8);
    }
  }

  function buildMapList() {
    var box = $('#s-maps');
    box.innerHTML = '';
    FC.MAPS.forEach(function (m) {
      var b = el('button', 'map-card' + (m.id === App.mapId ? ' on' : ''));
      b.type = 'button';
      var cv = el('canvas'); b.appendChild(cv);
      b.appendChild(el('b', null, m.name));
      b.appendChild(el('span', 'fine', m.size + '×' + m.size + ' · ' + m.budget + ' fleet pts'));
      b.appendChild(el('span', 'fine', m.blurb));
      b.onclick = function () {
        App.mapId = m.id; store.set('map', m.id);
        $$('.map-card').forEach(function (c) { c.classList.remove('on'); }); b.classList.add('on');
      };
      box.appendChild(b);
      drawMapPreview(cv, m);
    });
  }

  function startSetup(mode) {
    App.mode = mode;
    $('#s-title').textContent = { ai: 'Battle the Computer', local: 'Pass & Play', online: 'Play a Friend Online' }[mode];
    $('#s-name1').value = App.names[0];
    $('#s-name2').value = App.names[1];
    $('#s-name1-label').textContent = mode === 'local' ? 'Player 1 name' : 'Your name';
    $('#s-name2-wrap').classList.toggle('hidden', mode !== 'local');
    $('#s-ai').classList.toggle('hidden', mode !== 'ai');
    $('#s-online-tabs').classList.toggle('hidden', mode !== 'online');
    $$('#s-level .seg-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.level === App.level); });
    setOnlineTab(mode === 'online' ? App.onlineTab : 'host');
    buildMapList();
    show('setup');
  }
  function setOnlineTab(tab) {
    App.onlineTab = tab;
    $$('#s-online-tabs .seg-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    var join = App.mode === 'online' && tab === 'join';
    $('#s-join').classList.toggle('hidden', !join);
    $('#s-maps-wrap').classList.toggle('hidden', join);
    $('#s-go').textContent = App.mode === 'online' ? (join ? 'Join room' : 'Create room') : 'Build fleet';
  }

  function setupGo() {
    App.names[0] = cleanName($('#s-name1').value, App.mode === 'local' ? 'Player 1' : 'Captain');
    store.set('name', $('#s-name1').value.trim());
    if (App.mode === 'local') {
      App.names[1] = cleanName($('#s-name2').value, 'Player 2');
      store.set('name2', $('#s-name2').value.trim());
    }
    App.seed = (Math.random() * 4294967295) >>> 0;
    if (App.mode === 'ai') {
      App.names[1] = AI_NAMES[App.level];
      var map = FC.mapById(App.mapId);
      App.fleets[1] = FC.randomFleet(aiClasses(map), map);
      openBuilder(0, function (fleet) { App.fleets[0] = fleet; startBattle(); });
    } else if (App.mode === 'local') {
      openBuilder(0, function (f0) {
        App.fleets[0] = f0;
        handoff(App.names[1], [], 'Build your fleet', function () {
          openBuilder(1, function (f1) {
            App.fleets[1] = f1;
            startBattle();
          });
        });
      });
    } else {
      if (App.onlineTab === 'join') {
        var code = FC.cleanCode($('#s-code').value);
        if (code.length !== 5) { toast('Room codes are 5 letters or numbers.', 'bad'); return; }
        startOnline(code, false);
      } else {
        startOnline(FC.newRoomCode(), true);
      }
    }
  }

  function aiClasses(map) {
    for (var tries = 0; tries < 50; tries++) {
      var pool = FC.SHIP_ORDER.slice().sort(function () { return Math.random() - 0.5; }), out = [];
      pool.concat(pool).forEach(function (c) {
        var next = out.concat([c]);
        if (next.length <= FC.RULES.maxShips && FC.fleetPoints(next) <= map.budget &&
            next.filter(function (x) { return x === c; }).length <= (Math.random() < 0.3 ? 2 : 1)) out = next;
      });
      if (!FC.validateComposition(out, map)) return out;
    }
    return FC.CLASSIC_FLEET.slice();
  }

  // ---- fleet builder ---------------------------------------------------------------
  var builder = null;
  function emptyGrid(N) {
    return { shot: new Uint8Array(N), intel: new Uint8Array(N), repaired: new Uint8Array(N), mine: new Uint8Array(N), recon: [], shield: null };
  }

  function openBuilder(p, onReady, opts) {
    opts = opts || {};
    var map = FC.mapById(opts.mapId || App.mapId), size = map.size, blocked = FC.terrainOf(map);
    var classes = (App.classes[p] && !FC.validateComposition(App.classes[p], map)) ? App.classes[p].slice() : FC.CLASSIC_FLEET.slice();
    var prev = App.fleets[p];
    var fleet = (prev && !FC.validateFleet(prev, map)) ? prev.map(function (s) { return Object.assign({}, s); }) : FC.randomFleet(classes, map);
    classes = fleet.map(function (s) { return s.c; });
    var board = builder ? builder.board : new FC.Board($('#f-board'));
    builder = { board: board, map: map, fleet: fleet, p: p, onReady: onReady };
    $('#f-title').textContent = (App.mode === 'local' ? App.names[p] + ': ' : '') + 'Build your fleet';
    $('#f-map').textContent = map.name;
    $('#f-rule').textContent = FC.RULES.minShips + '–' + FC.RULES.maxShips + ' ships, max ' + FC.RULES.maxPerClass + ' of a class. Every ship brings its own ability.';
    $('#f-back').onclick = opts.onBack || function () { show(App.mode === 'online' ? 'menu' : 'setup'); if (App.mode === 'online') leaveOnline(); };

    function valid(s, skip) {
      var cells = FC.shipCells(s, size);
      if (!cells) return false;
      return cells.every(function (c) {
        if (blocked[c]) return false;
        return !builder.fleet.some(function (o, k) { return k !== skip && FC.shipCells(o, size).indexOf(c) >= 0; });
      });
    }
    builder.valid = valid;

    function placeNew(c) {
      for (var t = 0; t < 500; t++) {
        var s = { c: c, x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size), d: Math.random() < 0.5 ? 0 : 1 };
        if (valid(s, -1)) return s;
      }
      return null;
    }
    function setClasses(next) {
      var pool = builder.fleet.slice(), kept = [];
      var need = [];
      next.forEach(function (c) {
        var k = pool.findIndex(function (s) { return s.c === c; });
        if (k >= 0) kept.push(pool.splice(k, 1)[0]); else need.push(c);
      });
      builder.fleet = kept;
      for (var n = 0; n < need.length; n++) {
        var s = placeNew(need[n]);
        if (!s) { builder.fleet = FC.randomFleet(next, map) || builder.fleet; break; }
        builder.fleet.push(s);
      }
      render();
    }
    builder.setClasses = setClasses;

    function render() {
      var cls = builder.fleet.map(function (s) { return s.c; });
      var pts = FC.fleetPoints(cls);
      $('#f-pts').textContent = pts + ' / ' + map.budget;
      var m = $('#f-meter');
      m.style.width = Math.min(100, pts / map.budget * 100) + '%';
      m.classList.toggle('over', pts > map.budget);
      var err = FC.validateComposition(cls, map);
      $('#f-err').textContent = err || (builder.fleet.length + ' ships · ' + (map.budget - pts) + ' pts left');
      $('#f-err').classList.toggle('err', !!err);
      $('#f-ready').disabled = !!err;
      board.setView({
        map: map, size: size, blocked: blocked, grid: emptyGrid(size * size), own: true,
        ships: builder.fleet.map(function (s) { return { c: s.c, x: s.x, y: s.y, d: s.d, cells: FC.shipCells(s, size), sunk: false }; })
      });
      renderList(cls, pts);
    }
    builder.render = render;

    function renderList(cls, pts) {
      var ul = $('#f-list');
      ul.innerHTML = '';
      FC.SHIP_ORDER.forEach(function (c) {
        var spec = FC.SHIPS[c], ab = FC.ABILITIES[spec.ability];
        var n = cls.filter(function (x) { return x === c; }).length;
        var li = el('li', 'ship-row' + (n ? ' has' : ''));
        var cv = el('canvas'); li.appendChild(cv);
        var mid = el('div');
        mid.style.minWidth = '0';
        mid.appendChild(el('div', 'nm', spec.name));
        var abl = el('div', 'ab');
        abl.appendChild(el('b', null, ab.name));
        abl.appendChild(document.createTextNode(' · ' + ab.cost + ' CP'));
        mid.appendChild(abl);
        mid.appendChild(el('div', 'ab mono', 'Size ' + spec.size + ' · ' + spec.pts + ' pts'));
        li.appendChild(mid);
        var stp = el('div', 'stepper');
        var minus = el('button', null, '−'), plus = el('button', null, '+');
        minus.type = plus.type = 'button';
        minus.setAttribute('aria-label', 'Remove ' + spec.name);
        plus.setAttribute('aria-label', 'Add ' + spec.name);
        minus.disabled = !n;
        plus.disabled = n >= FC.RULES.maxPerClass || cls.length >= FC.RULES.maxShips || pts + spec.pts > map.budget;
        minus.onclick = function () {
          var k = cls.lastIndexOf(c), next = cls.slice(); next.splice(k, 1); setClasses(next);
        };
        plus.onclick = function () { setClasses(cls.concat([c])); };
        stp.appendChild(minus); stp.appendChild(el('span', null, String(n))); stp.appendChild(plus);
        li.appendChild(stp);
        ul.appendChild(li);
        drawShipIcon(cv, c, 64, 26);
      });
    }

    render();
    show('fleet');
  }

  function drawShipIcon(cv, c, w, h) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    var x = cv.getContext('2d'); x.scale(dpr, dpr);
    var cs = Math.min(h, w / FC.SHIPS[c].size);
    FC.drawShip(x, c, cs, w / 2, h / 2, 0, {});
  }

  function builderPointer() {
    var cv = $('#f-board'), drag = null;
    function local(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function candidate(e) {
      var B = builder, s = B.fleet[drag.idx], size = B.map.size;
      var i = B.board.cellAt(e.clientX, e.clientY);
      if (i < 0) return null;
      var gx = i % size, gy = Math.floor(i / size);
      return { c: s.c, d: s.d, x: s.d ? gx : gx - drag.k, y: s.d ? gy - drag.k : gy };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!builder) return;
      var B = builder, i = B.board.cellAt(e.clientX, e.clientY);
      if (i < 0) return;
      var idx = B.fleet.findIndex(function (s) { return FC.shipCells(s, B.map.size).indexOf(i) >= 0; });
      if (idx < 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      drag = { idx: idx, k: FC.shipCells(B.fleet[idx], B.map.size).indexOf(i), sx: e.clientX, sy: e.clientY, moved: false, cell: i };
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var B = builder;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
      drag.moved = true;
      var s = B.fleet[drag.idx], L = FC.SHIPS[s.c].size, cs = B.board.cs, p = local(e);
      var off = ((L - 1) / 2 - drag.k) * cs;
      var cand = candidate(e);
      B.board.drag = { idx: drag.idx, ship: s, x: p.x + (s.d ? 0 : off), y: p.y + (s.d ? off : 0), bad: !cand || !B.valid(cand, drag.idx) };
    });
    function end(e) {
      if (!drag) return;
      var B = builder, s = B.fleet[drag.idx], size = B.map.size;
      if (drag.moved) {
        var cand = candidate(e);
        if (cand && B.valid(cand, drag.idx)) { B.fleet[drag.idx] = cand; FC.Sound.play('click'); }
      } else {
        // rotate around the tapped cell, sliding along if it doesn't fit
        var gx = drag.cell % size, gy = Math.floor(drag.cell / size), L = FC.SHIPS[s.c].size, nd = s.d ? 0 : 1, done = false;
        for (var sh = 0; sh < L * 2 && !done; sh++) {
          var k = drag.k + (sh % 2 ? -Math.ceil(sh / 2) : Math.ceil(sh / 2));
          if (k < 0 || k >= L) continue;
          var r = { c: s.c, d: nd, x: nd ? gx : gx - k, y: nd ? gy - k : gy };
          if (B.valid(r, drag.idx)) { B.fleet[drag.idx] = r; done = true; }
        }
        if (done) FC.Sound.play('click'); else toast('No room to rotate here.', 'bad');
      }
      B.board.drag = null;
      drag = null;
      B.render();
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', function () { if (drag) { builder.board.drag = null; drag = null; } });

    $('#f-random').onclick = function () {
      var B = builder, cls = B.fleet.map(function (s) { return s.c; });
      B.fleet = FC.randomFleet(cls, B.map) || B.fleet; B.render();
    };
    $('#f-classic').onclick = function () {
      builder.fleet = FC.randomFleet(FC.CLASSIC_FLEET, builder.map); builder.render();
    };
    $('#f-ready').onclick = function () {
      var B = builder, err = FC.validateFleet(B.fleet, B.map);
      if (err) { toast(err, 'bad'); return; }
      var cls = B.fleet.map(function (s) { return s.c; });
      App.classes[B.p] = cls;
      if (B.p === 0) store.set('classes', cls);
      B.onReady(B.fleet.map(function (s) { return { c: s.c, x: s.x, y: s.y, d: s.d }; }));
    };
  }

  // ---- handoff (pass & play) -----------------------------------------------------
  function handoff(name, report, button, cb) {
    $('#h-name').textContent = name;
    var ul = $('#h-report');
    ul.innerHTML = '';
    report.forEach(function (r) { ul.appendChild(el('li', r.hit ? 'hit' : '', r.text)); });
    $('#h-ready').textContent = button || "I'm ready";
    $('#h-ready').onclick = function () { closeOv('ov-handoff'); cb(); };
    openOv('ov-handoff');
  }

  // ---- battle ----------------------------------------------------------------------
  function snapshot(st) {
    return {
      grids: st.grids.map(function (G) {
        return {
          shot: G.shot.slice(), intel: G.intel.slice(), repaired: G.repaired.slice(), mine: G.mine.slice(),
          shield: G.shield ? G.shield.slice() : null,
          recon: G.recon.map(function (r) { return Object.assign({}, r); }),
          ships: G.ships.map(function (s) { return { c: s.c, x: s.x, y: s.y, d: s.d, cells: s.cells, sunk: s.sunk }; })
        };
      }),
      cp: st.cp.slice()
    };
  }

  function Battle(st, cfg) {
    this.st = st;
    this.cfg = cfg;          // {mode, me(), names, level, onAction(a, idx), net}
    this.board = Battle.board || (Battle.board = new FC.Board($('#b-board')));
    this.disp = snapshot(st);
    this.busy = false;
    this.sel = null; this.orient = 0; this.aimCell = -1;
    this.viewMode = 'enemy';
    this.over = false;
    this.report = [];
    this.lastMsg = '';
    this.remoteQueue = [];
    this.board.clearFx();
    Battle.current = this;
  }
  Battle.prototype.me = function () { return this.cfg.me(); };
  Battle.prototype.myTurn = function () {
    var st = this.st;
    if (st.winner >= 0 || this.busy) return false;
    if (this.cfg.mode === 'ai') return st.current === 0;
    if (this.cfg.mode === 'online') return st.current === this.cfg.net.me;
    return st.current === this.me();
  };
  Battle.prototype.name = function (p) { return this.cfg.names[p]; };

  Battle.prototype.setView = function (mode, keepFx) {
    if (mode !== this.viewMode && !keepFx) this.board.clearFx();
    this.viewMode = mode;
    $$('#b-tabs .seg-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.view === mode); });
    this.renderBoard();
  };
  Battle.prototype.renderBoard = function () {
    var me = this.me(), g = this.viewMode === 'enemy' ? 1 - me : me, D = this.disp.grids[g], st = this.st;
    this.board.setView({ map: st.map, size: st.size, blocked: st.blocked, grid: D, ships: D.ships, own: this.viewMode === 'own', reveal: this.over });
    this.board.aim = this.aimFor();
  };
  Battle.prototype.viewForGrid = function (g) { return g === this.me() ? 'own' : 'enemy'; };

  Battle.prototype.aimFor = function () {
    if (!this.myTurn()) return null;
    var st = this.st, me = this.me(), id = this.sel, i = this.aimCell;
    if (id && FC.ABILITIES[id].target === 'none') return null;
    if (i < 0) return null;
    var wantOwn = id && FC.ABILITIES[id].target === 'own';
    if ((this.viewMode === 'own') !== !!wantOwn) return null;
    var cells = FC.patternCells(id || 'fire', st.size, i, this.orient);
    return { cells: cells, center: i, bad: !this.aimValid() };
  };
  Battle.prototype.aimValid = function () {
    var st = this.st, me = this.me(), foe = 1 - me, i = this.aimCell, id = this.sel;
    if (id && FC.ABILITIES[id].target === 'none') return true;
    if (i < 0) return false;
    var O = st.grids[me];
    switch (id) {
      case null: case undefined: case 'quick': return FC.targetable(st, foe, i);
      case 'air': case 'cross': case 'doom': return !st.blocked[i];
      case 'swarm': case 'sonar':
        return FC.patternCells(id, st.size, i).some(function (c) { return FC.targetable(st, foe, c); });
      case 'repair': return O.shipAt[i] >= 0 && O.shot[i] === 2 && !O.ships[O.shipAt[i]].sunk;
      case 'mine': return !st.blocked[i] && O.shipAt[i] < 0 && !O.shot[i] && !O.mine[i];
      default: return true;
    }
  };

  Battle.prototype.hud = function () {
    var st = this.st, me = this.me(), self = this, mine = this.myTurn();
    var cur = this.busy && this.actor != null ? this.actor : st.current;
    var t = $('#b-turn');
    if (st.winner >= 0) {
      t.textContent = this.cfg.mode === 'local' ? this.name(st.winner) + ' wins' : st.winner === me ? 'Victory' : 'Defeat';
      t.className = 'turn';
    }
    else if (cur === me || (this.cfg.mode === 'local')) {
      t.textContent = this.cfg.mode === 'local' ? this.name(cur) + "'s turn" : 'Your turn';
      t.className = 'turn mine';
    } else { t.textContent = this.name(1 - me) + "'s turn"; t.className = 'turn theirs'; }
    $('#b-sub').textContent = 'Round ' + (Math.floor((this.busy ? this.turnAtStart : st.turn) / 2) + 1) + ' · ' + st.map.name;

    // enemy roster
    $('#b-enemy-name').textContent = this.name(1 - me);
    var ro = $('#b-enemy-roster'); ro.innerHTML = '';
    this.disp.grids[1 - me].ships.forEach(function (s) {
      var c = el('span', 'rs' + (s.sunk ? ' sunk' : ''), s.c);
      c.title = FC.SHIPS[s.c].name;
      ro.appendChild(c);
    });
    var own = this.disp.grids[me].ships, afloat = own.filter(function (s) { return !s.sunk; }).length;
    $$('#b-tabs .seg-btn')[1].textContent = 'My fleet ' + afloat + '/' + own.length;

    // command points
    var cp = this.disp.cp[me], cost = this.sel ? FC.ABILITIES[this.sel].cost : 0;
    var pips = $('#b-cp');
    if (pips.children.length !== FC.RULES.cpMax) {
      pips.innerHTML = '';
      for (var k = 0; k < FC.RULES.cpMax; k++) pips.appendChild(el('i'));
    }
    Array.prototype.forEach.call(pips.children, function (p, k) {
      p.className = k < cp ? (k >= cp - cost ? 'cost' : 'on') : '';
    });
    $('#b-cp-num').textContent = cp;

    // ability cards
    var box = $('#b-abilities'); box.innerHTML = '';
    FC.fleetAbilities(st, me).forEach(function (a) {
      var ab = FC.ABILITIES[a.id], block = FC.abilityBlock(st, me, a.id);
      var sunk = !FC.classAfloat(st, me, a.cls);
      var card = el('button', 'ab-card');
      card.type = 'button';
      if (sunk) card.classList.add('sunk');
      else if (block || !mine) card.classList.add('off');
      else card.classList.add('ready');
      if (self.sel === a.id) card.classList.add('sel');
      card.appendChild(el('span', 'cls', FC.SHIPS[a.cls].name.toUpperCase()));
      card.appendChild(el('span', 'nm', ab.name));
      card.appendChild(el('span', 'cost', ab.cost + ' CP'));
      card.appendChild(el('span', 'tag', ab.ends ? 'Ends turn' : 'Free action'));
      card.onclick = function () { self.pickAbility(a.id); };
      box.appendChild(card);
    });

    // action buttons
    var fire = $('#b-fire'), sel = this.sel ? FC.ABILITIES[this.sel] : null;
    fire.textContent = sel ? (sel.target === 'none' ? 'Launch ' : '') + sel.name : 'Fire';
    fire.disabled = !mine || !this.aimValid() || (sel && sel.target !== 'none' && this.aimCell < 0);
    $('#b-cancel').classList.toggle('hidden', !this.sel);
    $('#b-rotate').classList.toggle('hidden', !(sel && sel.rotate));
    $('#b-log').innerHTML = '';
    $('#b-log').textContent = this.lastMsg || (this.busy || st.winner >= 0 ? '' : mine ? (sel ? sel.desc : 'Tap the enemy grid to aim, then fire.') : 'Waiting for ' + this.name(st.current) + '…');
    this.board.aim = this.aimFor();
  };

  Battle.prototype.pickAbility = function (id) {
    var st = this.st, me = this.me(), ab = FC.ABILITIES[id];
    FC.Sound.init();
    if (!this.myTurn()) { toast(ab.name + ': ' + ab.desc); return; }
    var block = FC.abilityBlock(st, me, id);
    if (block) { toast(ab.name + ': ' + block, 'bad'); return; }
    if (this.sel === id) { this.sel = null; }
    else {
      this.sel = id; this.orient = 0;
      FC.Sound.play('click');
      if (ab.target === 'own') { this.aimCell = -1; this.setView('own'); }
      else if (ab.target === 'enemy' && this.viewMode !== 'enemy') { this.aimCell = -1; this.setView('enemy'); }
    }
    this.lastMsg = '';
    this.hud();
  };

  Battle.prototype.tapCell = function (i) {
    if (!this.myTurn() || i < 0) return;
    var id = this.sel, ab = id ? FC.ABILITIES[id] : null;
    if (ab && ab.target === 'none') return;
    var wantOwn = ab && ab.target === 'own';
    if ((this.viewMode === 'own') !== !!wantOwn) {
      if (!ab && this.viewMode === 'own') toast('Switch to Enemy waters to fire.');
      return;
    }
    if (i === this.aimCell && this.aimValid()) { this.commit(); return; }
    this.aimCell = i;
    this.lastMsg = '';
    FC.Sound.play('click');
    this.hud();
  };

  Battle.prototype.commit = function () {
    if (!this.myTurn()) return;
    var a = this.sel ? { t: 'ab', a: this.sel, i: Math.max(0, this.aimCell), o: this.orient } : { t: 'fire', i: this.aimCell };
    if (!this.aimValid()) return;
    this.submit(a, true);
  };

  // Apply an action to the real state, then animate its events.
  Battle.prototype.submit = function (a, local) {
    var st = this.st, idx = st.actions, actor = st.current;
    this.actor = actor; this.turnAtStart = st.turn;
    var r = FC.applyAction(st, a);
    if (r.error) { if (local) toast(r.error, 'bad'); return false; }
    if (local && this.cfg.onAction) this.cfg.onAction(a, idx);
    this.sel = null; this.aimCell = -1; this.orient = 0;
    this.play(r.events, actor, a);
    return true;
  };

  Battle.prototype.say = function (msg) { this.lastMsg = msg; $('#b-log').textContent = msg; };

  Battle.prototype.play = async function (events, actor, action) {
    var self = this, st = this.st, me = this.me(), b = this.board, size = st.size;
    var D = this.disp, mineAct = actor === me || this.cfg.mode === 'local';
    var actorName = this.name(actor);
    this.busy = true;
    this.hud();
    var cellName = function (i) { return FC.cellName(i, size); };
    var stagger = 0, multi = false;
    if (action && action.t === 'ab') {
      var ab = FC.ABILITIES[action.a];
      banner(ab.name, actorName, mineAct ? '' : '#ff9b85');
      await FC.wait(500);
    }
    var turnChanged = false;
    for (var k = 0; k < events.length; k++) {
      var e = events[k], G = D.grids[e.g];
      var vw = e.g != null ? this.viewForGrid(e.g) : null;
      if (vw && vw !== this.viewMode && e.k !== 'shieldoff' && !(e.k === 'mineset' && e.g !== me)) {
        this.setView(vw);
        await FC.wait(350);
      }
      var ownGrid = e.g === me;
      switch (e.k) {
        case 'launch':
          multi = e.cells.length > 1;
          stagger = multi ? (e.src === 'air' ? 150 : 110) : 0;
          if (e.src === 'gun') await b.shell(e.cells[0]);
          else if (e.src === 'air') await b.planes(e.cells, e.o);
          else if (e.src === 'cross' || e.src === 'doom') {
            await Promise.all(e.cells.map(function (c, n) { return b.shell(c, n * 70); }));
          } else if (e.src === 'swarm') await b.missiles(e.cells);
          else if (e.src === 'torp') await b.torpedo(e.cells, e.hit);
          else if (e.src === 'hunter') await b.homing(e.cells[0]);
          break;
        case 'impact':
          G.shot[e.i] = e.r === 'miss' ? 1 : (e.r === 'mine' || e.r === 'seamine') ? 3 : 2;
          G.intel[e.i] = 0; G.repaired[e.i] = 0;
          if (e.r === 'mine') G.mine[e.i] = 0;
          var shipName = '';
          if (e.r === 'hit' || e.r === 'sunk') shipName = FC.SHIPS[st.grids[e.g].ships[st.grids[e.g].shipAt[e.i]].c].name;
          if (e.r === 'miss') {
            b.splash(e.i);
            if (!multi) b.popText(e.i, 'MISS', '#cfe6ee');
            this.say(ownGrid ? 'Incoming fire missed at ' + cellName(e.i) + '.' : 'Miss at ' + cellName(e.i) + '.');
          } else if (e.r === 'hit') {
            b.explode(e.i, false);
            if (!multi) b.popText(e.i, 'HIT', '#ffb070');
            if (ownGrid) { FC.buzz([60, 40, 90]); this.say('Your ' + shipName + ' was hit at ' + cellName(e.i) + '!'); }
            else { FC.buzz(25); this.say('Direct hit at ' + cellName(e.i) + '!'); }
          } else if (e.r === 'sunk') {
            G.ships[e.ship].sunk = true;
            b.explode(e.i, true);
            b.popText(e.i, 'SUNK', '#ff6a4a');
            FC.buzz(ownGrid ? [200, 80, 260] : [80, 40, 80]);
            banner(shipName + ' sunk', ownGrid ? 'You lost your ' + shipName : 'Enemy ' + shipName + ' destroyed', ownGrid ? '#ff9b85' : '');
            this.say(ownGrid ? 'Your ' + shipName + ' went down.' : 'You sank the enemy ' + shipName + '!');
            if (!ownGrid) FC.Sound.play('turn');
            await FC.wait(500);
          } else {
            b.explode(e.i, true);
            b.popText(e.i, 'MINE!', '#ffcf70');
            this.say(e.r === 'seamine' ? 'A sea mine detonated at ' + cellName(e.i) + '!' : 'A hidden mine exploded at ' + cellName(e.i) + '!');
            await FC.wait(450);
          }
          if (this.cfg.mode === 'local' && !ownGrid) this.report.push({ hit: e.r !== 'miss', text: cellName(e.i) + ' — ' + (e.r === 'miss' ? 'miss' : e.r === 'hit' ? 'HIT on your ' + shipName : e.r === 'sunk' ? 'your ' + shipName + ' was SUNK' : 'mine detonated') });
          this.hudLite();
          await FC.wait(multi ? stagger : 420);
          break;
        case 'deflect':
          b.deflect(e.i);
          b.popText(e.i, 'BLOCKED', '#a8dcff');
          this.say('Aegis shield deflected the shot at ' + cellName(e.i) + '.');
          await FC.wait(multi ? stagger : 450);
          break;
        case 'backfire':
          banner('Mine blowback', 'The blast hits ' + (e.g === me ? 'your' : 'their') + ' fleet', '#ffcf70');
          await FC.wait(300);
          await b.shell(e.i);
          break;
        case 'scan':
          await b.sonar(e.center, e.cells, e.contacts);
          e.cells.forEach(function (c) { G.intel[c] = e.contacts.indexOf(c) >= 0 ? 2 : 1; });
          if (this.cfg.mode === 'local') this.report.push({ text: 'Enemy sonar swept your waters around ' + cellName(e.center) + '.' });
          this.say(ownGrid ? 'Enemy sonar swept your waters.' : 'Sonar: ' + (e.contacts.length ? e.contacts.length + ' contact' + (e.contacts.length > 1 ? 's' : '') + ' found.' : 'nothing there.'));
          await FC.wait(300);
          break;
        case 'recon':
          await b.recon(e.cells, e.o);
          G.recon = G.recon.filter(function (r) { return !(r.o === e.o && r.n === e.n); });
          G.recon.push({ o: e.o, n: e.n, count: e.count });
          this.say((ownGrid ? 'Enemy recon: ' : 'Recon: ') + (e.o ? 'column ' + FC.colName(e.n) : 'row ' + (e.n + 1)) + ' holds ' + e.count + ' intact hull cell' + (e.count === 1 ? '' : 's') + '.');
          await FC.wait(300);
          break;
        case 'shield':
          G.shield = e.cells.slice();
          await b.shieldUp(e.cells, e.center);
          this.say(ownGrid ? 'Aegis shield is up until your next turn.' : 'The enemy raised an Aegis shield.');
          break;
        case 'shieldoff':
          G.shield = null;
          break;
        case 'repair':
          G.shot[e.i] = 0; G.repaired[e.i] = 1;
          await b.repairFx(e.i);
          this.say(ownGrid ? 'Damage control repaired ' + cellName(e.i) + '.' : 'The enemy repaired a hull section at ' + cellName(e.i) + '.');
          break;
        case 'mineset':
          if (e.g === me) { G.mine[e.i] = 1; await b.mineDrop(e.i); this.say('Mine deployed at ' + cellName(e.i) + '. Hidden from the enemy.'); }
          else this.say('The enemy did something in their own waters…');
          break;
        case 'hazard':
          banner(e.name, e.g === me ? 'Your fleet' : this.name(e.g) + "'s fleet", '#a8c8ff');
          await FC.wait(400);
          if (e.kind === 'lightning') await b.lightning(e.i); else await b.kraken(e.i);
          break;
        case 'note':
          this.say(e.text);
          await FC.wait(500);
          break;
        case 'turn':
          turnChanged = true;
          break;
        case 'win':
          break;
      }
    }
    await FC.wait(450);
    this.disp = snapshot(st);
    this.busy = false;
    this.afterTurn(turnChanged);
  };

  Battle.prototype.hudLite = function () {
    var me = this.me(), self = this, ro = $('#b-enemy-roster');
    Array.prototype.forEach.call(ro.children, function (c, k) {
      c.classList.toggle('sunk', self.disp.grids[1 - me].ships[k].sunk);
    });
  };

  Battle.prototype.afterTurn = function (turnChanged) {
    var st = this.st, self = this;
    if (st.winner >= 0) { this.finish(); return; }
    var mode = this.cfg.mode;
    if (mode === 'local' && turnChanged) {
      var next = st.current, report = this.report.length ? this.report : [{ text: 'No damage to your fleet.' }];
      this.report = [];
      this.lastMsg = '';
      handoff(this.name(next), report.slice(-8), "I'm ready", function () {
        self.viewer = next;
        self.disp = snapshot(st);
        self.setView('enemy');
        self.hud();
        banner('Your turn', self.name(next));
        FC.Sound.play('turn');
      });
      return;
    }
    this.hud();
    if (this.myTurn()) {
      if (turnChanged) {
        this.lastMsg = '';
        setTimeout(function () {
          if (!self.myTurn()) return;
          self.setView('enemy');
          self.hud();
          banner('Your turn');
          FC.Sound.play('turn');
        }, 500);
      } else if (this.viewMode !== 'enemy') {
        this.setView('enemy');
      }
      this.hud();
    } else if (mode === 'ai') {
      setTimeout(function () { self.aiStep(); }, turnChanged ? 900 : 550);
    } else if (mode === 'online') {
      this.pumpRemote();
    }
  };

  Battle.prototype.aiStep = function () {
    var st = this.st;
    if (st.winner >= 0 || st.current !== 1 || this.busy || App.battle !== this) return;
    var a = FC.aiChoose(st, 1, this.cfg.level);
    if (!this.submit(a, false)) {
      var free = [];
      for (var c = 0; c < st.N; c++) if (FC.targetable(st, 0, c)) free.push(c);
      this.submit({ t: 'fire', i: free[Math.floor(Math.random() * free.length)] }, false);
    }
  };

  // Online: apply the opponent's next action when it has arrived.
  Battle.prototype.pumpRemote = function () {
    if (this.busy || this.st.winner >= 0 || App.battle !== this) return;
    var net = this.cfg.net, st = this.st;
    if (st.current === net.me) return;
    var a = net.remoteAction(st.actions);
    if (a) {
      if (!this.submit(a, false)) toast('Your buddy sent a move this device could not apply.', 'bad');
    }
  };

  Battle.prototype.finish = function () {
    var st = this.st, me = this.me(), self = this;
    this.over = true;
    if (this.cfg.mode === 'online') App.phase = 'over';
    this.disp = snapshot(st);
    this.renderBoard();
    this.hud();
    var win = st.winner;
    var t = $('#r-title');
    if (this.cfg.mode === 'local') {
      t.textContent = this.name(win) + ' wins'; t.className = 'result-title win';
      FC.Sound.play('win');
    } else {
      var won = win === me;
      t.textContent = won ? 'Victory' : 'Defeat'; t.className = 'result-title ' + (won ? 'win' : 'lose');
      FC.Sound.play(won ? 'win' : 'lose');
      FC.buzz(won ? [100, 60, 100, 60, 200] : [400]);
    }
    $('#r-sub').textContent = this.name(win) + ' sank the last enemy ship in round ' + (Math.floor(st.turn / 2) + 1) + '.';
    var box = $('#r-stats'); box.innerHTML = '';
    var players = this.cfg.mode === 'local' ? [0, 1] : [me];
    players.forEach(function (p) {
      var S = st.stats[p];
      var acc = S.shots ? Math.round(S.hits / S.shots * 100) : 0;
      [[self.cfg.mode === 'local' ? self.name(p) : 'Shots fired', self.cfg.mode === 'local' ? S.shots + ' shots' : S.shots],
       ['Accuracy', acc + '%'], ['Ships sunk', S.sunk], ['Abilities used', S.abilities]].forEach(function (r) {
        var d = el('div'); d.appendChild(el('b', null, String(r[1]))); d.appendChild(el('span', null, r[0])); box.appendChild(d);
      });
    });
    $('#r-again').textContent = this.cfg.mode === 'online' && !this.cfg.net.host ? 'Ask for a rematch' : 'Rematch';
    setTimeout(function () { if (App.battle === self) openOv('ov-result'); }, 1300);
  };

  function battlePointer() {
    var cv = $('#b-board'), down = false;
    cv.addEventListener('pointerdown', function (e) {
      FC.Sound.init();
      var B = App.battle; if (!B) return;
      down = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var B = App.battle; if (!B || !down || !B.myTurn()) return;
      var i = B.board.cellAt(e.clientX, e.clientY);
      if (i >= 0 && i !== B.aimCell) {
        var ab = B.sel ? FC.ABILITIES[B.sel] : null;
        if ((B.viewMode === 'own') !== !!(ab && ab.target === 'own')) return;
        B.aimCell = i; B.dragAim = true; B.hud();
      }
    });
    cv.addEventListener('pointerup', function (e) {
      var B = App.battle; if (!B || !down) return;
      down = false;
      if (B.dragAim) { B.dragAim = false; return; }
      B.tapCell(B.board.cellAt(e.clientX, e.clientY));
    });
    cv.addEventListener('pointercancel', function () { down = false; });
    $$('#b-tabs .seg-btn').forEach(function (b) {
      b.onclick = function () { var B = App.battle; if (B && !B.busy) { B.setView(b.dataset.view); B.hud(); } };
    });
    $('#b-fire').onclick = function () { var B = App.battle; if (B) B.commit(); };
    $('#b-cancel').onclick = function () { var B = App.battle; if (B) { B.sel = null; B.aimCell = -1; if (B.viewMode === 'own') B.setView('enemy'); B.hud(); } };
    $('#b-rotate').onclick = function () { var B = App.battle; if (B) { B.orient ^= 1; FC.Sound.play('click'); B.hud(); } };
    $('#b-menu').onclick = function () { $('#p-quit').textContent = 'Leave battle'; $('#p-quit').dataset.armed = ''; openOv('ov-pause'); };
    $('#b-sound').onclick = function () { FC.settings.sound = !FC.settings.sound; FC.Sound.init(); saveSettings(); };
    $('#p-quit').onclick = function () {
      var q = $('#p-quit');
      if (!q.dataset.armed) { q.dataset.armed = '1'; q.textContent = 'Tap again to leave'; return; }
      closeOv('ov-pause');
      quitToMenu();
    };
  }

  function startBattle(opts) {
    opts = opts || {};
    var st = opts.st || FC.createGame({ mapId: App.mapId, seed: App.seed, fleets: App.fleets });
    var net = App.net;
    var B = new Battle(st, {
      mode: App.mode, names: opts.names || App.names.slice(), level: App.level, net: net,
      me: function () { return App.mode === 'online' ? net.me : App.mode === 'ai' ? 0 : (B.viewer || 0); },
      onAction: net ? function (a, idx) { net.pushAction(a, idx); } : null
    });
    B.viewer = 0;
    App.battle = B;
    closeOv('ov-result');
    show('battle');
    B.setView('enemy');
    B.hud();
    $('#b-net').classList.add('hidden');
    if (App.mode === 'local') {
      handoff(App.names[0], [], 'Start the battle', function () { banner('Battle stations', App.names[0] + ' fires first'); FC.Sound.play('alarm'); });
    } else if (st.winner >= 0) {
      B.finish();
    } else {
      var first = st.current === B.me();
      banner(opts.resumed ? 'Rejoined' : 'Battle stations', first ? 'You fire first' : B.name(st.current) + ' fires first');
      FC.Sound.play('alarm');
      if (App.mode === 'online') setTimeout(function () { B.pumpRemote(); }, 900);
    }
  }

  function quitToMenu() {
    App.battle = null;
    if (Battle.board) Battle.board.clearFx();
    closeOv('ov-result');
    if (App.net) leaveOnline();
    show('menu');
  }

  function rematch() {
    closeOv('ov-result');
    if (App.mode === 'online') { App.net.rematch(); return; }
    App.seed = (Math.random() * 4294967295) >>> 0;
    App.battle = null;
    if (App.mode === 'ai') {
      var map = FC.mapById(App.mapId);
      App.fleets[1] = FC.randomFleet(aiClasses(map), map);
      openBuilder(0, function (f) { App.fleets[0] = f; startBattle(); });
    } else {
      setupGo();
    }
  }

  // ---- online session --------------------------------------------------------------
  function Online(code, host, saved) {
    this.code = code; this.host = host; this.me = host ? 0 : 1;
    this.local = saved || { v: 1, h: host ? 1 : 0, n: App.names[0], g: host ? 1 : 0, m: App.mapId, s: App.seed, f: '', r: 0, a: [] };
    this.local.n = App.names[0] || this.local.n;
    this.remote = null;
    this.status = 'connecting';
    this.wasConnected = false;
  }
  Online.prototype.start = function () {
    var self = this;
    $('#l-code').textContent = this.code;
    lobbyStatus(this.host ? 'Opening room…' : 'Looking for room ' + this.code + '…', '');
    $('#l-help').classList.toggle('hidden', !this.host);
    show('lobby');
    App.phase = 'lobby';
    return FC.openLink(this.code, this.host).then(function (link) {
      if (App.net !== self) { link.close(); return; }
      self.link = link;
      $('#l-transport').textContent = link.kind === 'room'
        ? 'Connected through Claude. Your buddy needs access to this page.'
        : 'Direct peer-to-peer connection.';
      link.on('status', function (s) { self.onStatus(s); });
      link.on('data', function (d) { self.onData(d); });
      self.push();
    }).catch(function (err) {
      lobbyStatus(err && err.message ? err.message : 'Could not connect.', 'bad');
    });
  };
  Online.prototype.push = function () {
    if (this.link) this.link.send(JSON.parse(JSON.stringify(this.local)));
    store.set('online', { code: this.code, host: this.host, local: this.local, at: Date.now() });
  };
  Online.prototype.onStatus = function (s) {
    this.status = s;
    if (s === 'code-taken') { lobbyStatus('That room code is busy. Go back and try again.', 'bad'); return; }
    if (s === 'connected') { this.wasConnected = true; $('#b-net').classList.add('hidden'); }
    if (App.phase === 'lobby' && !this.remote) {
      if (s === 'offline') lobbyStatus('Offline. Check your connection.', 'bad');
      else if (s === 'searching') lobbyStatus(this.host ? 'Waiting for your buddy to join…' : 'Looking for room ' + this.code + '…', '');
    }
    if (App.phase === 'battle' && s !== 'connected' && this.wasConnected) $('#b-net').classList.remove('hidden');
  };
  Online.prototype.onData = function (d) {
    if (!d || d.v !== 1 || !!d.h === this.host) return;
    d.n = cleanName(d.n, this.host ? 'Guest' : 'Host');
    var fresh = !this.remote;
    this.remote = d;
    $('#b-net').classList.add('hidden');
    if (!this.host) {
      // The host owns the game settings; a new game number means a new game.
      if (d.g !== this.local.g) {
        if (!FC.MAPS.some(function (m) { return m.id === d.m; })) return;
        this.local.g = d.g; this.local.m = d.m; this.local.s = d.s >>> 0;
        this.local.f = ''; this.local.r = 0; this.local.a = []; this.local.rq = 0;
        this.push();
        App.mapId = d.m; App.seed = d.s >>> 0;
        if (!fresh) toast(d.n + ' started a rematch.', 'good');
        App.phase = 'fleet';
        this.openFleet();
        return;
      }
    } else if (d.g !== this.local.g) {
      return; // guest still catching up to the current game
    }
    if (fresh && App.phase === 'lobby') toast(d.n + ' is here.', 'good');
    if (this.host && d.rq === this.local.g && App.phase === 'over' && !this.rqShown) { this.rqShown = true; toast(d.n + ' wants a rematch.', 'good'); }
    this.advance();
  };
  // Decide which screen we should be on from both players' status.
  Online.prototype.advance = function () {
    var L = this.local, R = this.remote;
    if (!R || R.g !== L.g) return;
    if (App.phase === 'lobby') {
      if (L.f && L.r) { App.phase = 'wait'; }
      else { App.phase = 'fleet'; this.openFleet(); return; }
    }
    if (App.phase === 'wait' || App.phase === 'fleet') {
      if (L.f && L.r && R.f && R.r) { this.begin(); return; }
      if (App.phase === 'wait') lobbyStatus(R.n + ' is still deploying their fleet…', '');
    }
    if (App.phase === 'battle' && App.battle) App.battle.pumpRemote();
  };
  Online.prototype.openFleet = function () {
    var self = this;
    openBuilder(0, function (fleet) {
      self.local.f = FC.encodeFleet(fleet); self.local.r = 1;
      App.fleets[0] = fleet;
      self.push();
      App.phase = 'wait';
      $('#l-help').classList.add('hidden');
      lobbyStatus('Fleet deployed. Waiting for ' + (self.remote ? self.remote.n : 'your buddy') + '…', '');
      show('lobby');
      self.advance();
    }, { mapId: this.local.m, onBack: function () { leaveOnline(); show('menu'); } });
  };
  Online.prototype.begin = function () {
    var L = this.local, R = this.remote, map = FC.mapById(L.m);
    var mineF = FC.decodeFleet(L.f), theirs = FC.decodeFleet(R.f);
    if (!theirs || FC.validateFleet(theirs, map)) { lobbyStatus("Your buddy's fleet didn't pass the rules check. Ask them to rebuild it.", 'bad'); return; }
    var fleets = this.me === 0 ? [mineF, theirs] : [theirs, mineF];
    var st = FC.createGame({ mapId: L.m, seed: L.s >>> 0, fleets: fleets });
    // Replay any moves already made (rejoining after a reload).
    var resumed = false;
    for (var guard = 0; guard < 2000; guard++) {
      var src = st.current === this.me ? L.a : R.a;
      var a = findAction(src, st.actions);
      if (!a || st.winner >= 0) break;
      if (FC.applyAction(st, a).error) break;
      resumed = true;
    }
    App.mode = 'online'; App.mapId = L.m; App.seed = L.s >>> 0;
    App.phase = 'battle';
    startBattle({ st: st, resumed: resumed, names: this.me === 0 ? [L.n, R.n] : [R.n, L.n] });
  };
  function findAction(list, idx) {
    var pre = idx + ':';
    for (var k = 0; k < (list || []).length; k++) {
      if (typeof list[k] === 'string' && list[k].indexOf(pre) === 0) return FC.decodeAction(list[k].slice(pre.length));
    }
    return null;
  }
  Online.prototype.remoteAction = function (idx) { return this.remote ? findAction(this.remote.a, idx) : null; };
  Online.prototype.pushAction = function (a, idx) { this.local.a.push(idx + ':' + FC.encodeAction(a)); this.push(); };
  Online.prototype.rematch = function () {
    App.battle = null;
    if (this.host) {
      this.local.g++; this.local.s = (Math.random() * 4294967295) >>> 0;
      this.local.f = ''; this.local.r = 0; this.local.a = [];
      this.rqShown = false;
      this.push();
      App.phase = 'fleet';
      this.openFleet();
    } else {
      this.local.rq = this.local.g;
      this.push();
      App.phase = 'over';
      lobbyStatus('Asked ' + (this.remote ? this.remote.n : 'the host') + ' for a rematch…', '');
      $('#l-help').classList.add('hidden');
      show('lobby');
    }
  };
  Online.prototype.close = function () { if (this.link) this.link.close(); };

  function lobbyStatus(text, kind) {
    $('#l-status').textContent = text;
    $('#l-dot').className = 'dot' + (kind === 'bad' ? ' bad' : kind === 'ok' ? ' ok' : '');
  }
  function startOnline(code, host) {
    if (App.net) App.net.close();
    App.mode = 'online';
    App.fleets = [null, null];
    App.net = new Online(code, host);
    App.net.start();
  }
  function rejoinOnline(saved) {
    App.mode = 'online';
    App.names[0] = cleanName(saved.local.n, 'Captain');
    App.mapId = saved.local.m; App.seed = saved.local.s >>> 0;
    App.net = new Online(saved.code, saved.host, saved.local);
    App.net.start();
  }
  function leaveOnline() {
    if (App.net) App.net.close();
    App.net = null;
    App.phase = null;
    store.del('online');
  }

  // ---- ship guide ----------------------------------------------------------------
  function buildGuide() {
    var g = $('#g-body');
    g.innerHTML = '';
    function sec(t) { g.appendChild(el('h3', 'guide-sec', t)); }
    function p(t) { g.appendChild(el('p', 'guide-p', t)); }
    sec('How a turn works');
    p('Each turn you either fire one shot or use an attack ability. Both end your turn. Abilities marked “Free action” (sonar, shields, repairs, mines, recon, quick shot) don\'t end your turn, so you can use them first and still fire. Each ability can be used once per turn.');
    sec('Command points');
    p('You earn ' + FC.RULES.cpPerTurn + ' command point (CP) at the start of every turn and ' + FC.RULES.cpPerSink + ' more for every enemy ship you sink. You can hold up to ' + FC.RULES.cpMax + '. Spend them on cheap tricks now, or bank them for something devastating like the Doomsday Salvo.');
    p('An ability belongs to its ship class. When every ship of that class is sunk, you lose the ability. Protect the ships whose abilities you rely on.');
    sec('Ship classes');
    FC.SHIP_ORDER.forEach(function (c) {
      var s = FC.SHIPS[c], a = FC.ABILITIES[s.ability];
      var row = el('div', 'guide-ship');
      var cv = el('canvas'); row.appendChild(cv);
      var d = el('div');
      d.appendChild(el('div', 'nm', s.name));
      d.appendChild(el('div', 'meta', 'Size ' + s.size + ' · ' + s.pts + ' fleet pts · ' + a.cost + ' CP · ' + (a.ends ? 'ends turn' : 'free action')));
      var ab = el('div', 'ab'); ab.appendChild(el('b', null, a.name + ': ')); ab.appendChild(document.createTextNode(a.desc)); d.appendChild(ab);
      row.appendChild(d);
      g.appendChild(row);
      drawShipIcon(cv, c, 84, 30);
    });
    sec('Maps');
    FC.MAPS.forEach(function (m) { p(m.name + ' (' + m.size + '×' + m.size + ', ' + m.budget + ' fleet pts): ' + m.blurb); });
    sec('Reading the board');
    p('White dot: miss. Burning glow: hit. Amber diamond: sonar contact. Teal ×: sonar says clear. Numbers in the edge gutter: recon counts for that row or column. Dashed blue outline: an Aegis shield. Green ring: a section the enemy repaired, so it can be hit again.');
    sec('Online play');
    p('Host a room and send your buddy the 5-letter code. Each phone runs the full game and they swap moves, so there is no server to set up. If a phone locks or reloads, open the game again and tap “Rejoin online room”.');
  }

  // ---- wiring ------------------------------------------------------------------------
  function init() {
    syncSettingsUI();
    document.addEventListener('pointerdown', function () { FC.Sound.init(); }, { once: true });
    $$('[data-go]').forEach(function (b) { b.onclick = function () { FC.Sound.init(); startSetup(b.dataset.go); }; });
    $$('[data-open]').forEach(function (b) { b.onclick = function () { if (b.dataset.open === 'ov-guide') buildGuide(); openOv(b.dataset.open); }; });
    $$('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('.overlay').classList.remove('open'); }; });
    $$('[data-back]').forEach(function (b) { b.onclick = function () { show('menu'); }; });
    $$('#s-level .seg-btn').forEach(function (b) {
      b.onclick = function () { App.level = b.dataset.level; store.set('level', App.level); $$('#s-level .seg-btn').forEach(function (x) { x.classList.toggle('on', x === b); }); };
    });
    $$('#s-online-tabs .seg-btn').forEach(function (b) { b.onclick = function () { setOnlineTab(b.dataset.tab); }; });
    $('#s-code').addEventListener('input', function (e) { e.target.value = FC.cleanCode(e.target.value); });
    $('#s-go').onclick = setupGo;
    $('#l-leave').onclick = function () { leaveOnline(); show('menu'); };
    $('#l-copy').onclick = function () {
      var code = $('#l-code').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast('Code copied.', 'good'); }, function () { toast('Copy failed. The code is ' + code + '.'); });
      else toast('The code is ' + code + '.');
    };
    $('#set-sound').onchange = function (e) { FC.settings.sound = e.target.checked; FC.Sound.init(); saveSettings(); };
    $('#set-vibrate').onchange = function (e) { FC.settings.vibrate = e.target.checked; saveSettings(); };
    $$('#set-speed .seg-btn').forEach(function (b) { b.onclick = function () { FC.settings.speed = +b.dataset.speed; saveSettings(); }; });
    $('#r-again').onclick = rematch;
    $('#r-menu').onclick = quitToMenu;
    $('#r-view').onclick = function () { closeOv('ov-result'); var B = App.battle; if (B) { B.setView('enemy'); B.hud(); } };
    builderPointer();
    battlePointer();
    menuInit();
    window.FleetCommand = App;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.FC = window.FC || {});

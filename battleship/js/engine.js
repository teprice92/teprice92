/* Fleet Command — deterministic rules engine.
 *
 * Every random roll comes from a seeded RNG keyed on the game seed and the
 * action count, so two devices that replay the same action list always end
 * up in exactly the same state. That is what makes online play work without
 * a game server: players only exchange their fleets and their actions.
 */
(function (FC) {
  'use strict';

  // ---- seeded randomness ---------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash() {
    var h = 2166136261;
    for (var k = 0; k < arguments.length; k++) {
      var v = arguments[k] | 0;
      for (var b = 0; b < 4; b++) {
        h ^= (v >>> (b * 8)) & 255;
        h = Math.imul(h, 16777619);
      }
    }
    return h >>> 0;
  }
  FC.rng = function () { return mulberry32(hash.apply(null, arguments)); };
  FC.hash = hash;
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  // ---- geometry -------------------------------------------------------------
  function shipCells(s, size) {
    var n = FC.SHIPS[s.c].size, out = [];
    for (var k = 0; k < n; k++) {
      var x = s.x + (s.d ? 0 : k), y = s.y + (s.d ? k : 0);
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      out.push(y * size + x);
    }
    return out;
  }
  FC.shipCells = shipCells;

  function terrainOf(map) {
    var N = map.size * map.size, blocked = new Uint8Array(N);
    if (map.terrain) {
      for (var y = 0; y < map.size; y++)
        for (var x = 0; x < map.size; x++)
          if (map.terrain[y][x] === '#') blocked[y * map.size + x] = 1;
    }
    return blocked;
  }
  FC.terrainOf = terrainOf;

  function area(size, i, r) {
    var cx = i % size, cy = Math.floor(i / size), out = [];
    for (var y = cy - r; y <= cy + r; y++)
      for (var x = cx - r; x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < size && y < size) out.push(y * size + x);
    return out;
  }
  function line(size, i, o, len) {
    var cx = i % size, cy = Math.floor(i / size), out = [];
    if (len >= size) len = size;
    var start = Math.max(0, Math.min((o ? cy : cx) - Math.floor(len / 2), size - len));
    for (var k = 0; k < len; k++) out.push(o ? (start + k) * size + cx : cy * size + start + k);
    return out;
  }
  function fullLine(size, i, o) {
    var cx = i % size, cy = Math.floor(i / size), out = [];
    for (var k = 0; k < size; k++) out.push(o ? k * size + cx : cy * size + k);
    return out;
  }
  function cross(size, i) {
    var cx = i % size, cy = Math.floor(i / size), out = [i];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var x = cx + d[0], y = cy + d[1];
      if (x >= 0 && y >= 0 && x < size && y < size) out.push(y * size + x);
    });
    return out;
  }

  // Cells an ability would touch — used both for rules and for the aiming preview.
  FC.patternCells = function (id, size, i, o) {
    switch (id) {
      case 'air': return line(size, i, o, 5);
      case 'cross': return cross(size, i);
      case 'doom': case 'sonar': case 'shield': return area(size, i, 1);
      case 'swarm': return area(size, i, 2);
      case 'torp': case 'recon': return fullLine(size, i, o);
      default: return [i];
    }
  };

  // ---- fleets ---------------------------------------------------------------
  FC.fleetPoints = function (classes) {
    return classes.reduce(function (s, c) { return s + FC.SHIPS[c].pts; }, 0);
  };

  FC.validateComposition = function (classes, map) {
    var R = FC.RULES;
    if (classes.length < R.minShips) return 'Pick at least ' + R.minShips + ' ships.';
    if (classes.length > R.maxShips) return 'At most ' + R.maxShips + ' ships.';
    var counts = {};
    for (var k = 0; k < classes.length; k++) {
      if (!FC.SHIPS[classes[k]]) return 'Unknown ship class.';
      counts[classes[k]] = (counts[classes[k]] || 0) + 1;
      if (counts[classes[k]] > R.maxPerClass) return 'At most ' + R.maxPerClass + ' of each class.';
    }
    if (FC.fleetPoints(classes) > map.budget) return 'Over the ' + map.budget + '-point fleet budget.';
    return null;
  };

  FC.validateFleet = function (fleet, map) {
    if (!Array.isArray(fleet)) return 'No fleet.';
    var err = FC.validateComposition(fleet.map(function (s) { return s.c; }), map);
    if (err) return err;
    var blocked = terrainOf(map), used = new Uint8Array(map.size * map.size);
    for (var k = 0; k < fleet.length; k++) {
      var cells = shipCells(fleet[k], map.size);
      if (!cells) return 'A ship is off the map.';
      for (var j = 0; j < cells.length; j++) {
        if (blocked[cells[j]]) return 'A ship is on an island.';
        if (used[cells[j]]) return 'Ships overlap.';
        used[cells[j]] = 1;
      }
    }
    return null;
  };

  // Place the given classes at random legal positions. Keeps one empty cell
  // between ships when it can, which tends to look and play better.
  FC.randomFleet = function (classes, map, rng) {
    rng = rng || Math.random;
    var size = map.size, blocked = terrainOf(map);
    for (var attempt = 0; attempt < 200; attempt++) {
      var used = new Uint8Array(size * size), fleet = [], ok = true;
      var spacing = attempt < 120;
      var order = classes.slice().sort(function (a, b) { return FC.SHIPS[b].size - FC.SHIPS[a].size; });
      for (var k = 0; k < order.length && ok; k++) {
        var placed = false;
        for (var t = 0; t < 300 && !placed; t++) {
          var d = rng() < 0.5 ? 0 : 1;
          var s = { c: order[k], x: Math.floor(rng() * size), y: Math.floor(rng() * size), d: d };
          var cells = shipCells(s, size);
          if (!cells) continue;
          var bad = cells.some(function (c) {
            if (blocked[c] || used[c]) return true;
            if (!spacing) return false;
            return area(size, c, 1).some(function (n) { return used[n]; });
          });
          if (bad) continue;
          cells.forEach(function (c) { used[c] = 1; });
          fleet.push(s); placed = true;
        }
        ok = placed;
      }
      if (ok) return fleet;
    }
    return null;
  };

  FC.encodeFleet = function (fleet) {
    return fleet.map(function (s) { return s.c + s.x.toString(36) + s.y.toString(36) + s.d; }).join('');
  };
  FC.decodeFleet = function (str) {
    var out = [];
    if (typeof str !== 'string' || str.length % 5) return null;
    for (var k = 0; k < str.length; k += 5) {
      out.push({ c: str.substr(k, 2), x: parseInt(str[k + 2], 36), y: parseInt(str[k + 3], 36), d: str[k + 4] === '1' ? 1 : 0 });
    }
    return out;
  };

  // ---- actions --------------------------------------------------------------
  // {t:'fire', i} or {t:'ab', a:abilityId, i, o}
  FC.encodeAction = function (a) {
    return a.t === 'fire' ? 'f' + a.i : 'a' + a.a + '.' + (a.i | 0) + '.' + (a.o | 0);
  };
  FC.decodeAction = function (s) {
    if (typeof s !== 'string') return null;
    if (s[0] === 'f') return { t: 'fire', i: parseInt(s.slice(1), 10) };
    var p = s.slice(1).split('.');
    if (p.length !== 3 || !FC.ABILITIES[p[0]]) return null;
    return { t: 'ab', a: p[0], i: parseInt(p[1], 10), o: parseInt(p[2], 10) ? 1 : 0 };
  };

  // ---- game state -----------------------------------------------------------
  FC.createGame = function (opts) {
    var map = FC.mapById(opts.mapId), size = map.size, N = size * size;
    var st = {
      map: map, size: size, N: N, seed: opts.seed >>> 0,
      blocked: terrainOf(map),
      grids: [], cp: [0, 1], current: 0, turn: 0, actions: 0,
      used: {}, winner: -1,
      stats: [0, 1].map(function () { return { shots: 0, hits: 0, abilities: 0, sunk: 0 }; })
    };
    for (var g = 0; g < 2; g++) {
      var G = {
        ships: [], shipAt: new Int16Array(N).fill(-1),
        shot: new Uint8Array(N),      // 0 none, 1 miss, 2 hit, 3 detonated mine
        intel: new Uint8Array(N),     // 0 unknown, 1 clear, 2 contact
        repaired: new Uint8Array(N),
        mine: new Uint8Array(N),      // mines laid by this grid's owner
        seaMine: new Uint8Array(N),   // neutral map mines
        recon: [], shield: null
      };
      opts.fleets[g].forEach(function (s, idx) {
        var cells = shipCells(s, size);
        G.ships.push({ c: s.c, x: s.x, y: s.y, d: s.d, cells: cells, hits: cells.map(function () { return false; }), sunk: false });
        cells.forEach(function (c) { G.shipAt[c] = idx; });
      });
      if (map.seaMines) {
        var r = FC.rng(st.seed, g, 991), free = [];
        for (var i = 0; i < N; i++) if (!st.blocked[i] && G.shipAt[i] < 0) free.push(i);
        for (var m = 0; m < map.seaMines && free.length; m++) {
          G.seaMine[free.splice(Math.floor(r() * free.length), 1)[0]] = 1;
        }
      }
      st.grids.push(G);
    }
    st.cp[0] = Math.min(FC.RULES.cpMax, st.cp[0] + FC.RULES.cpPerTurn);
    return st;
  };

  function intactCells(G) {
    var out = [];
    G.ships.forEach(function (s) {
      if (s.sunk) return;
      s.cells.forEach(function (c, k) { if (!s.hits[k]) out.push(c); });
    });
    return out;
  }
  FC.intactCells = intactCells;

  FC.classAfloat = function (st, p, cls) {
    return st.grids[p].ships.some(function (s) { return s.c === cls && !s.sunk; });
  };

  // Abilities this player's fleet carries (one entry per class).
  FC.fleetAbilities = function (st, p) {
    var seen = {}, out = [];
    st.grids[p].ships.forEach(function (s) {
      if (seen[s.c]) return;
      seen[s.c] = 1;
      out.push({ cls: s.c, id: FC.SHIPS[s.c].ability });
    });
    return out;
  };

  // Why this ability can't be used right now, or null if it can.
  FC.abilityBlock = function (st, p, id) {
    var cls = Object.keys(FC.SHIPS).find(function (c) { return FC.SHIPS[c].ability === id; });
    if (!st.grids[p].ships.some(function (s) { return s.c === cls; })) return 'Not in your fleet';
    if (!FC.classAfloat(st, p, cls)) return FC.SHIPS[cls].name + ' sunk';
    if (st.used[id]) return 'Used this turn';
    if (st.cp[p] < FC.ABILITIES[id].cost) return 'Needs ' + FC.ABILITIES[id].cost + ' CP';
    return null;
  };

  FC.targetable = function (st, g, i) {
    return !st.blocked[i] && st.grids[g].shot[i] === 0;
  };

  function checkWin(st, g, ev) {
    if (st.winner >= 0) return;
    if (st.grids[g].ships.every(function (s) { return s.sunk; })) {
      st.winner = 1 - g;
      ev.push({ k: 'win', p: st.winner });
    }
  }

  // Resolve damage on grid g at cell i. attacker = player index, or -1 for
  // map hazards and mine blowback.
  function hitCell(st, g, i, src, ev, attacker, rng) {
    if (st.winner >= 0 || st.blocked[i]) return;
    var G = st.grids[g];
    if (G.shot[i]) return;
    var hazard = attacker < 0;
    if (!hazard && G.shield && G.shield.indexOf(i) >= 0) {
      ev.push({ k: 'deflect', g: g, i: i });
      return;
    }
    G.intel[i] = 0;
    G.repaired[i] = 0;
    if (G.seaMine[i]) {
      G.seaMine[i] = 0; G.shot[i] = 3;
      ev.push({ k: 'impact', g: g, i: i, r: 'seamine' });
      cross(st.size, i).slice(1).forEach(function (n) { hitCell(st, g, n, 'blast', ev, attacker, rng); });
      return;
    }
    if (G.mine[i]) {
      G.mine[i] = 0; G.shot[i] = 3;
      ev.push({ k: 'impact', g: g, i: i, r: 'mine' });
      if (attacker >= 0) {
        var targets = intactCells(st.grids[attacker]);
        if (targets.length) {
          var j = pick(rng, targets);
          ev.push({ k: 'backfire', g: attacker, i: j, from: i });
          hitCell(st, attacker, j, 'backfire', ev, -1, rng);
        }
      }
      return;
    }
    var si = G.shipAt[i];
    if (si >= 0) {
      var ship = G.ships[si];
      G.shot[i] = 2;
      ship.hits[ship.cells.indexOf(i)] = true;
      if (attacker >= 0) st.stats[attacker].hits++;
      if (ship.hits.every(Boolean)) {
        ship.sunk = true;
        st.cp[1 - g] = Math.min(FC.RULES.cpMax, st.cp[1 - g] + FC.RULES.cpPerSink);
        st.stats[1 - g].sunk++;
        ev.push({ k: 'impact', g: g, i: i, r: 'sunk', ship: si, src: src });
        checkWin(st, g, ev);
      } else {
        ev.push({ k: 'impact', g: g, i: i, r: 'hit', src: src });
      }
    } else {
      G.shot[i] = 1;
      ev.push({ k: 'impact', g: g, i: i, r: 'miss', src: src });
    }
  }

  function endTurn(st, ev) {
    st.current = 1 - st.current;
    st.turn++;
    st.used = {};
    var p = st.current, R = FC.RULES;
    if (st.grids[p].shield) {
      st.grids[p].shield = null;
      ev.push({ k: 'shieldoff', g: p });
    }
    st.cp[p] = Math.min(R.cpMax, st.cp[p] + R.cpPerTurn);
    var hz = st.map.event;
    if (hz && p === 0 && (st.turn / 2) % hz.every === 0) {
      var rng = FC.rng(st.seed, st.turn, 4242);
      for (var g = 0; g < 2 && st.winner < 0; g++) {
        var free = [];
        for (var i = 0; i < st.N; i++) if (FC.targetable(st, g, i)) free.push(i);
        if (!free.length) continue;
        var c = pick(rng, free);
        ev.push({ k: 'hazard', kind: hz.kind, name: hz.name, g: g, i: c });
        hitCell(st, g, c, hz.kind, ev, -1, rng);
      }
    }
    if (st.winner < 0) ev.push({ k: 'turn', p: p });
  }

  // Apply one action for the current player. Returns {events} or {error}.
  FC.applyAction = function (st, a) {
    if (st.winner >= 0) return { error: 'Game over' };
    if (!a) return { error: 'Bad action' };
    var p = st.current, foe = 1 - p, E = st.grids[foe], O = st.grids[p], ev = [];
    var size = st.size, i = a.i | 0;
    if (i < 0 || i >= st.N) return { error: 'Off the map' };
    var rng = FC.rng(st.seed, st.actions, 17);

    if (a.t === 'fire') {
      if (!FC.targetable(st, foe, i)) return { error: 'Pick a new target' };
      st.stats[p].shots++;
      ev.push({ k: 'launch', src: 'gun', g: foe, cells: [i] });
      hitCell(st, foe, i, 'gun', ev, p, rng);
      st.actions++;
      if (st.winner < 0) endTurn(st, ev);
      return { events: ev };
    }

    var id = a.a, ab = FC.ABILITIES[id];
    if (a.t !== 'ab' || !ab) return { error: 'Bad action' };
    var block = FC.abilityBlock(st, p, id);
    if (block) return { error: block };
    var cells, k;
    // Pay up front so a sink bonus earned by this ability isn't eaten by the cap.
    st.cp[p] -= ab.cost;
    function fail(msg) { st.cp[p] += ab.cost; return { error: msg }; }

    switch (id) {
      case 'air': case 'cross': case 'doom':
        if (st.blocked[i]) return fail('Aim at open water');
        cells = FC.patternCells(id, size, i, a.o).filter(function (c) { return !st.blocked[c]; });
        ev.push({ k: 'launch', src: id, g: foe, cells: cells, o: a.o, center: i });
        cells.forEach(function (c) { hitCell(st, foe, c, id, ev, p, rng); });
        st.stats[p].shots += cells.length;
        break;
      case 'swarm':
        var pool = FC.patternCells(id, size, i).filter(function (c) { return FC.targetable(st, foe, c); });
        if (!pool.length) return fail('Nothing left to hit there');
        cells = [];
        for (k = 0; k < 4 && pool.length; k++) cells.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        ev.push({ k: 'launch', src: id, g: foe, cells: cells, center: i });
        cells.forEach(function (c) { hitCell(st, foe, c, id, ev, p, rng); });
        st.stats[p].shots += cells.length;
        break;
      case 'torp':
        var run = FC.patternCells(id, size, i, a.o), path = [], end = -1;
        for (k = 0; k < run.length; k++) {
          var c = run[k];
          path.push(c);
          if (st.blocked[c]) break;
          if (E.shield && E.shield.indexOf(c) >= 0) { end = c; break; }
          if (E.shot[c]) continue;
          if (E.shipAt[c] >= 0 || E.mine[c] || E.seaMine[c]) { end = c; break; }
        }
        ev.push({ k: 'launch', src: 'torp', g: foe, cells: path, o: a.o, hit: end });
        if (end >= 0) hitCell(st, foe, end, 'torp', ev, p, rng);
        else ev.push({ k: 'note', text: 'Torpedo ran clear — no contact.' });
        st.stats[p].shots++;
        break;
      case 'hunter':
        var targets = intactCells(E);
        if (!targets.length) return fail('No targets');
        i = pick(rng, targets);
        ev.push({ k: 'launch', src: 'hunter', g: foe, cells: [i] });
        hitCell(st, foe, i, 'hunter', ev, p, rng);
        st.stats[p].shots++;
        break;
      case 'quick':
        if (!FC.targetable(st, foe, i)) return fail('Pick a new target');
        ev.push({ k: 'launch', src: 'gun', g: foe, cells: [i] });
        hitCell(st, foe, i, 'quick', ev, p, rng);
        st.stats[p].shots++;
        break;
      case 'sonar':
        cells = FC.patternCells(id, size, i).filter(function (c) { return FC.targetable(st, foe, c); });
        var contacts = [];
        cells.forEach(function (c) {
          var on = E.shipAt[c] >= 0;
          E.intel[c] = on ? 2 : 1;
          if (on) contacts.push(c);
        });
        ev.push({ k: 'scan', g: foe, center: i, cells: cells, contacts: contacts });
        break;
      case 'recon':
        var ln = FC.patternCells(id, size, i, a.o), count = 0;
        ln.forEach(function (c) { if (E.shipAt[c] >= 0 && E.shot[c] !== 2) count++; });
        var idx = a.o ? i % size : Math.floor(i / size);
        E.recon = E.recon.filter(function (r) { return !(r.o === (a.o | 0) && r.n === idx); });
        E.recon.push({ o: a.o | 0, n: idx, count: count, turn: st.turn });
        ev.push({ k: 'recon', g: foe, o: a.o | 0, n: idx, cells: ln, count: count });
        break;
      case 'shield':
        O.shield = FC.patternCells(id, size, i).filter(function (c) { return !st.blocked[c]; });
        ev.push({ k: 'shield', g: p, cells: O.shield, center: i });
        break;
      case 'repair':
        var si = O.shipAt[i];
        if (si < 0 || O.shot[i] !== 2 || O.ships[si].sunk) return fail('Tap a damaged section of a ship that is still afloat');
        O.shot[i] = 0; O.repaired[i] = 1;
        O.ships[si].hits[O.ships[si].cells.indexOf(i)] = false;
        ev.push({ k: 'repair', g: p, i: i });
        break;
      case 'mine':
        if (st.blocked[i] || O.shipAt[i] >= 0 || O.shot[i] || O.mine[i]) return fail('Tap empty, untouched water in your own zone');
        O.mine[i] = 1;
        ev.push({ k: 'mineset', g: p, i: i });
        break;
    }

    st.used[id] = true;
    st.stats[p].abilities++;
    st.actions++;
    if (ab.ends && st.winner < 0) endTurn(st, ev);
    return { events: ev };
  };
})(window.FC = window.FC || {});

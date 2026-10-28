/* Fleet Command — computer opponent.
 *
 * The AI only uses what a human could see on the enemy board (shots,
 * sonar contacts, recon counts, sunk ships). It builds a probability map
 * of where the remaining ships can fit and picks the best shot or ability.
 */
(function (FC) {
  'use strict';

  function density(st, p) {
    var g = 1 - p, E = st.grids[g], size = st.size, N = st.N;
    var D = new Float64Array(N), closed = new Uint8Array(N), hot = new Uint8Array(N);
    for (var c = 0; c < N; c++) {
      var sh = E.shot[c];
      if (st.blocked[c] || sh === 1 || sh === 3 || E.intel[c] === 1) closed[c] = 1;
      else if (sh === 2) {
        if (E.ships[E.shipAt[c]].sunk) closed[c] = 1; else hot[c] = 1;
      }
    }
    E.recon.forEach(function (r) {
      if (r.count) return;
      for (var k = 0; k < size; k++) closed[r.o ? k * size + r.n : r.n * size + k] = 1;
    });
    var shielded = E.shield || [];
    E.ships.forEach(function (ship) {
      if (ship.sunk) return;
      var L = FC.SHIPS[ship.c].size;
      for (var d = 0; d < 2; d++) {
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var cells = FC.shipCells({ c: ship.c, x: x, y: y, d: d }, size);
            if (!cells) continue;
            var ok = true, hits = 0, contacts = 0;
            for (var k = 0; k < L; k++) {
              if (closed[cells[k]]) { ok = false; break; }
              if (hot[cells[k]]) hits++;
              if (E.intel[cells[k]] === 2) contacts++;
            }
            if (!ok) continue;
            var w = (1 + hits * hits * 30) * (1 + contacts * 4);
            for (k = 0; k < L; k++) if (!E.shot[cells[k]]) D[cells[k]] += w;
          }
        }
      }
    });
    for (c = 0; c < N; c++) {
      if (!FC.targetable(st, g, c) || shielded.indexOf(c) >= 0) D[c] = 0;
      else if (E.intel[c] === 2) D[c] += 40;
    }
    return { D: D, hunting: hot.some(Boolean) };
  }

  function argmax(D) {
    var best = -1, bv = -1;
    for (var c = 0; c < D.length; c++) {
      var v = D[c] + Math.random() * 0.01;
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  function bestPattern(st, D, id, orients) {
    var best = { v: 0, i: -1, o: 0 };
    orients.forEach(function (o) {
      for (var c = 0; c < st.N; c++) {
        if (st.blocked[c]) continue;
        var cells = FC.patternCells(id, st.size, c, o), v = 0;
        for (var k = 0; k < cells.length; k++) v += D[cells[k]];
        if (id === 'swarm') v = v / Math.max(1, cells.filter(function (x) { return D[x] > 0; }).length) * 4;
        if (id === 'torp') v = v / st.size * 2.5;
        if (v > best.v) best = { v: v, i: c, o: o };
      }
    });
    return best;
  }

  FC.aiChoose = function (st, p, level) {
    var r = density(st, p), D = r.D, cp = st.cp[p];
    var O = st.grids[p], E = st.grids[1 - p];
    var can = function (id) { return !FC.abilityBlock(st, p, id); };
    var target = argmax(D);

    if (level === 'easy') {
      if (Math.random() < 0.15) {
        var opts = ['cross', 'air', 'swarm', 'hunter'].filter(can);
        if (opts.length) return { t: 'ab', a: opts[0], i: target, o: Math.random() < 0.5 ? 0 : 1 };
      }
      if (!r.hunting || Math.random() < 0.4) {
        var free = [];
        for (var c = 0; c < st.N; c++) if (FC.targetable(st, 1 - p, c)) free.push(c);
        return { t: 'fire', i: free[Math.floor(Math.random() * free.length)] };
      }
      return { t: 'fire', i: target };
    }

    var hard = level === 'hard';
    var keep = hard && FC.classAfloat(st, p, 'DN') && cp < 8 ? 2 : 0;

    // Damage control first: fix the most damaged ship still afloat.
    if (can('repair') && cp >= (hard ? 4 : 6)) {
      var worst = null;
      O.ships.forEach(function (s) {
        if (s.sunk) return;
        var n = s.hits.filter(Boolean).length;
        if (n && (!worst || n > worst.n)) worst = { n: n, i: s.cells[s.hits.indexOf(true)] };
      });
      if (worst && worst.n >= 2) return { t: 'ab', a: 'repair', i: worst.i, o: 0 };
    }
    // Shield a ship the enemy is closing in on.
    if (can('shield') && cp >= 5) {
      var exposed = O.ships.find(function (s) { return !s.sunk && s.hits.some(Boolean); });
      if (exposed) return { t: 'ab', a: 'shield', i: exposed.cells[Math.floor(exposed.cells.length / 2)], o: 0 };
    }
    if (can('mine') && cp >= 6 && Math.random() < 0.35) {
      var water = [];
      for (var w = 0; w < st.N; w++) if (!st.blocked[w] && O.shipAt[w] < 0 && !O.shot[w] && !O.mine[w]) water.push(w);
      if (water.length) return { t: 'ab', a: 'mine', i: water[Math.floor(Math.random() * water.length)], o: 0 };
    }
    // Intel when nothing is wounded.
    if (!r.hunting && can('sonar') && cp >= 2 + keep) {
      var sp = bestPattern(st, D, 'sonar', [0]);
      if (sp.i >= 0) return { t: 'ab', a: 'sonar', i: sp.i, o: 0 };
    }
    if (!r.hunting && can('recon') && cp >= 3 + keep && Math.random() < 0.5) {
      var rp = bestPattern(st, D, 'recon', [0, 1]);
      if (rp.i >= 0) return { t: 'ab', a: 'recon', i: rp.i, o: rp.o };
    }

    var single = D[target] || 1, choice = null, factor = hard ? 0.25 : 0.4;
    ['doom', 'air', 'cross', 'swarm', 'torp'].forEach(function (id) {
      if (!can(id)) return;
      var cost = FC.ABILITIES[id].cost;
      if (id !== 'doom' && cp - cost < keep) return;
      var bp = bestPattern(st, D, id, FC.ABILITIES[id].rotate ? [0, 1] : [0]);
      var score = bp.v / (1 + cost * factor);
      if (bp.i >= 0 && score > single && (!choice || score > choice.score)) {
        choice = { score: score, a: { t: 'ab', a: id, i: bp.i, o: bp.o } };
      }
    });
    if (!r.hunting && can('hunter') && cp - 4 >= keep) {
      var hs = single * 2.6 / (1 + 4 * factor);
      if (!choice || hs > choice.score) choice = { score: hs, a: { t: 'ab', a: 'hunter', i: 0, o: 0 } };
    }
    if (choice) return choice.a;
    if (can('quick') && cp >= 4 + keep && D[target] > 0) return { t: 'ab', a: 'quick', i: target, o: 0 };
    if (target < 0 || !FC.targetable(st, 1 - p, target)) {
      for (var f = 0; f < st.N; f++) if (FC.targetable(st, 1 - p, f)) return { t: 'fire', i: f };
    }
    return { t: 'fire', i: target };
  };
})(window.FC = window.FC || {});

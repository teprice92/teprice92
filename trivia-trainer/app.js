(() => {
  const CATS = window.TRIVIA_CATEGORIES;
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const PACK = (window.TRIVIA_PACKS && window.TRIVIA_PACKS.questions) || [];
  const QUESTIONS = [...window.TRIVIA_QUESTIONS, ...PACK.filter((q) => CAT[q.c])];
  const BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
  const STORE_KEY = "trivia-night-trainer-v1";
  const TIME_LIMIT = 20; // seconds per question when the timer is on
  const FRESH_DAYS = 21; // pack questions this new count as "fresh"
  const LETTERS = ["A", "B", "C", "D"];
  // A real answer from each category, shown huge on its card.
  const TEASERS = { pop: "Wakanda", music: "Thriller", history: "1492", geo: "0°", sci: "Au", sports: "147", random: "88" };
  const ROTATOR = [
    ["ancient Rome", "history"], ["90s sitcoms", "pop"], ["the periodic table", "sci"], ["ABBA", "music"],
    ["world capitals", "geo"], ["snooker", "sports"], ["Q-tips", "random"], ["Pixar", "pop"],
    ["the Magna Carta", "history"], ["octopus hearts", "sci"], ["Prince", "music"], ["the Bosphorus", "geo"],
  ];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const catVar = (id) => `var(--c-${id})`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const isFresh = (q) => Boolean(q.added) && (Date.now() - Date.parse(q.added)) / 864e5 <= FRESH_DAYS;
  const FRESH_COUNT = QUESTIONS.filter(isFresh).length;

  // ---------- Saved progress (this browser only) ----------
  const freshStats = () => ({ cats: {}, seen: {}, missed: [], rounds: 0, bestStreak: 0, prefs: null });
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.cats && s.seen && Array.isArray(s.missed)) return s;
    } catch (e) { /* storage blocked or empty */ }
    return freshStats();
  }
  function saveStats() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
  }
  let stats = loadStats();
  stats.missed = stats.missed.filter((id) => BY_ID[id]);

  const prefs = Object.assign(
    { cats: CATS.map((c) => c.id), diff: "any", len: 10, mode: "mc", timer: true, fresh: false },
    stats.prefs || {}
  );
  prefs.cats = prefs.cats.filter((id) => CAT[id]);
  if (!FRESH_COUNT) prefs.fresh = false;

  // ---------- Home: hero ----------
  function startRotator() {
    const el = $("rot-word");
    let i = 0;
    const set = () => {
      const [word, cat] = ROTATOR[i];
      el.textContent = word;
      el.style.setProperty("--rot", catVar(cat));
    };
    set();
    setInterval(() => {
      if ($("home").hidden || document.hidden) return;
      i = (i + 1) % ROTATOR.length;
      if (reduceMotion) return set();
      el.classList.add("out");
      setTimeout(() => {
        set();
        el.classList.remove("out");
        el.classList.add("in");
        setTimeout(() => el.classList.remove("in"), 600);
      }, 340);
    }, 2600);
  }

  function renderHero() {
    const items = [
      [QUESTIONS.length, "questions"],
      [CATS.length, "categories"],
      [stats.rounds, "rounds you've played"],
    ];
    let html = items.map(([n, l]) => `<li><b>${n}</b><span>${l}</span></li>`).join("");
    if (FRESH_COUNT) html += `<li class="fresh"><b>+${FRESH_COUNT}</b><span>fresh this month</span></li>`;
    $("hero-stats").innerHTML = html;
  }

  function renderTicker() {
    const facts = shuffle(QUESTIONS.filter((q) => q.n && q.n.length < 120)).slice(0, 14).map((q) => q.n);
    const row = facts.map((f) => `<span>${esc(f)}</span>`).join("");
    $("ticker").innerHTML = row + row.replace(/<span>/g, '<span aria-hidden="true">');
  }

  // ---------- Home: setup ----------
  const DIFFS = [["any", "Mixed"], ["1", "Easy"], ["2", "Medium"], ["3", "Hard"]];
  const LENS = [[10, "10"], [20, "20"], [0, "All"]];
  const TIMERS = [[true, "20 seconds"], [false, "Off"]];
  const MODES = [["mc", "Multiple choice"], ["recall", "Pub rules (no options)"]];
  const FRESH_OPTS = [[false, "Everything"], [true, "Only fresh"]];
  const MODE_HINTS = {
    mc: "Pick from four answers. Good for learning new facts.",
    recall: "Say or write your answer, reveal it, then mark yourself honestly. This is how real quiz nights work.",
  };

  function segmented(el, items, current, onPick) {
    el.innerHTML = "";
    for (const [val, label] of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(val === current));
      b.textContent = label;
      b.addEventListener("click", () => onPick(val));
      el.appendChild(b);
    }
  }

  function filteredPool() {
    return QUESTIONS.filter((q) =>
      prefs.cats.includes(q.c) &&
      (prefs.diff === "any" || String(q.d) === prefs.diff) &&
      (!prefs.fresh || isFresh(q))
    );
  }

  function catAccuracy(id) {
    const s = stats.cats[id];
    return s && s.seen ? Math.round((s.right / s.seen) * 100) : null;
  }

  function buildDeck() {
    const grid = $("cat-grid");
    grid.innerHTML = "";
    for (const c of CATS) {
      const n = QUESTIONS.filter((q) => q.c === c.id).length;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile reveal-on-scroll";
      b.dataset.cat = c.id;
      b.style.setProperty("--cat", catVar(c.id));
      b.innerHTML = `
        <span class="tile-top"><span class="tile-count">${n} questions</span><span class="tile-check" aria-hidden="true"></span></span>
        <span class="tile-body">
          <span class="tile-name">${esc(c.name)}</span>
          <span class="tile-blurb">${esc(c.blurb)}</span>
          <span class="tile-score"></span>
        </span>
        <span class="tile-teaser" aria-hidden="true">${esc(TEASERS[c.id] || "?")}</span>`;
      b.addEventListener("click", () => {
        prefs.cats = prefs.cats.includes(c.id) ? prefs.cats.filter((x) => x !== c.id) : [...prefs.cats, c.id];
        persistPrefs();
        renderSetup();
      });
      if (!reduceMotion) {
        b.addEventListener("pointermove", (e) => {
          if (e.pointerType !== "mouse") return;
          const r = b.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          b.style.setProperty("--ry", `${x * 8}deg`);
          b.style.setProperty("--rx", `${-y * 8}deg`);
        });
        b.addEventListener("pointerleave", () => {
          b.style.setProperty("--rx", "0deg");
          b.style.setProperty("--ry", "0deg");
        });
      }
      grid.appendChild(b);
    }
  }

  function renderSetup() {
    for (const tile of $("cat-grid").children) {
      const id = tile.dataset.cat;
      tile.setAttribute("aria-pressed", String(prefs.cats.includes(id)));
      const acc = catAccuracy(id);
      tile.querySelector(".tile-score").textContent = acc === null ? "Not played yet" : `Your accuracy: ${acc}%`;
    }
    $("cats-toggle").textContent = prefs.cats.length ? "Select none" : "Select all";

    segmented($("seg-mode"), MODES, prefs.mode, (v) => { prefs.mode = v; persistPrefs(); renderSetup(); });
    segmented($("seg-diff"), DIFFS, prefs.diff, (v) => { prefs.diff = v; persistPrefs(); renderSetup(); });
    segmented($("seg-len"), LENS, prefs.len, (v) => { prefs.len = v; persistPrefs(); renderSetup(); });
    segmented($("seg-timer"), TIMERS, prefs.timer, (v) => { prefs.timer = v; persistPrefs(); renderSetup(); });
    $("fresh-rule").hidden = !FRESH_COUNT;
    if (FRESH_COUNT) segmented($("seg-fresh"), FRESH_OPTS, prefs.fresh, (v) => { prefs.fresh = v; persistPrefs(); renderSetup(); });
    $("timer-rule").hidden = prefs.mode !== "mc";
    $("mode-hint").textContent = MODE_HINTS[prefs.mode];

    const pool = filteredPool();
    const take = prefs.len ? Math.min(prefs.len, pool.length) : pool.length;
    $("start").disabled = pool.length === 0;
    const diffLabel = DIFFS.find(([v]) => v === prefs.diff)[1];
    $("dock-summary").innerHTML = pool.length
      ? `${take} questions <span class="muted">· ${prefs.cats.length} of ${CATS.length} categories · ${diffLabel} · ${prefs.mode === "mc" ? "Multiple choice" : "Pub rules"}</span>`
      : `<span class="muted">No questions match. Pick at least one category.</span>`;
    const m = stats.missed.length;
    $("drill").disabled = m === 0;
    $("drill").textContent = m ? `Drill ${m} misses` : "No misses yet";

    renderWheel();
    renderHero();
  }

  function persistPrefs() {
    stats.prefs = { ...prefs };
    saveStats();
  }

  // The wheel: one slice per category; its length shows your accuracy there.
  function renderWheel() {
    const cx = 100, cy = 100, R = 96, hub = 30;
    const step = (Math.PI * 2) / CATS.length;
    let slices = "";
    let totalSeen = 0, totalRight = 0;
    CATS.forEach((c, i) => {
      const s = stats.cats[c.id] || { seen: 0, right: 0 };
      totalSeen += s.seen; totalRight += s.right;
      const acc = s.seen ? s.right / s.seen : 0;
      const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
      const wedge = (r) => {
        const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
        return `M${cx},${cy} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`;
      };
      slices += `<path d="${wedge(R)}" fill="${catVar(c.id)}" fill-opacity="0.16" stroke="var(--bg)" stroke-width="3"/>`;
      if (acc > 0) {
        slices += `<path class="slice" style="--i:${i}" d="${wedge(hub + (R - hub) * acc)}" fill="${catVar(c.id)}" stroke="var(--bg)" stroke-width="3"><title>${esc(c.name)}: ${Math.round(acc * 100)}%</title></path>`;
      }
    });
    const overall = totalSeen ? Math.round((totalRight / totalSeen) * 100) + "%" : "–";
    $("wheel").innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="Accuracy by category, ${overall} overall">
      ${slices}
      <circle cx="${cx}" cy="${cy}" r="${hub + 6}" fill="var(--bg)"/>
      <text class="hub-num" x="${cx}" y="${cy + 6}" text-anchor="middle">${overall}</text>
      <text class="hub-lbl" x="${cx}" y="${cy + 19}" text-anchor="middle">OVERALL</text>
    </svg>`;

    $("cat-stats").innerHTML = CATS.map((c) => {
      const s = stats.cats[c.id];
      const acc = catAccuracy(c.id);
      const label = acc === null ? "not played" : `${s.right}/${s.seen} · ${acc}%`;
      return `<li style="--cat:${catVar(c.id)}"><span class="dot"></span><span>${esc(c.name)}</span><span class="bar"><span style="width:${acc || 0}%"></span></span><span class="pct">${label}</span></li>`;
    }).join("");

    $("tally").innerHTML = `
      <div><dt>Rounds</dt><dd>${stats.rounds}</dd></div>
      <div><dt>Answered</dt><dd>${totalSeen}</dd></div>
      <div><dt>Best streak</dt><dd>${stats.bestStreak}</dd></div>`;
  }

  // ---------- Confetti ----------
  const confetti = (() => {
    const canvas = $("confetti");
    const ctx = canvas.getContext("2d");
    let parts = [];
    let raf = null;
    const colors = () => {
      const cs = getComputedStyle(document.documentElement);
      return CATS.map((c) => cs.getPropertyValue(`--c-${c.id}`).trim() || "#ffb21e");
    };
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.vy += 0.32 * p.d;
        p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life / 30);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = parts.length ? requestAnimationFrame(frame) : null;
    }
    return function burst(x, y, count = 60, spread = 1) {
      if (reduceMotion) return;
      const d = window.devicePixelRatio || 1;
      if (!raf) {
        canvas.width = innerWidth * d;
        canvas.height = innerHeight * d;
      }
      const palette = colors();
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
        const speed = (6 + Math.random() * 9) * d;
        parts.push({
          d, x: x * d, y: y * d, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          w: (6 + Math.random() * 6) * d, h: (8 + Math.random() * 8) * d,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
          color: palette[i % palette.length], life: 70 + Math.random() * 40,
        });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };
  })();

  function floatPlus(x, y) {
    if (reduceMotion) return;
    const el = document.createElement("span");
    el.className = "plus";
    el.textContent = "+1";
    el.style.left = x + "px";
    el.style.top = y + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  // ---------- Round ----------
  let round = null;
  let timerId = null;

  function pickQuestions(pool, n) {
    // Questions you've seen least come first, so repeat rounds stay fresh.
    const ordered = shuffle(pool).sort((a, b) => (stats.seen[a.id] || 0) - (stats.seen[b.id] || 0));
    return shuffle(n ? ordered.slice(0, n) : ordered);
  }

  function startRound(qs) {
    if (!qs.length) return;
    round = { qs, i: 0, score: 0, streak: 0, results: [], mode: prefs.mode, timer: prefs.mode === "mc" && prefs.timer };
    show("play");
    renderQuestion();
  }

  function show(screen) {
    for (const id of ["home", "play", "results"]) $(id).hidden = id !== screen;
    $("topnav").hidden = screen !== "home";
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderStreak() {
    const n = round.streak;
    const lit = Math.min(n, 5);
    let html = "";
    for (let i = 0; i < 5; i++) html += `<i class="${i < lit ? "on" : ""}"></i>`;
    if (n >= 3) html += `<b>${n} in a row</b>`;
    $("streak").innerHTML = html;
    $("streak").classList.toggle("hot", n >= 5);
  }

  function renderMeta() {
    const q = round.qs[round.i];
    $("q-meta").textContent = `${round.i + 1} / ${round.qs.length} · ${"●".repeat(q.d)}${"○".repeat(3 - q.d)} · ${round.score} pts`;
    $("progress-fill").style.width = `${(round.results.length / round.qs.length) * 100}%`;
  }

  function restartAnim(el, cls) {
    el.classList.remove("enter", "shake");
    void el.offsetWidth; // reflow so the animation plays again
    el.classList.add(cls);
  }

  function renderQuestion() {
    const q = round.qs[round.i];
    round.answered = false;
    round.revealed = false;

    $("play").style.setProperty("--cat", catVar(q.c));
    $("q-cat").textContent = CAT[q.c].name + (isFresh(q) ? " · fresh" : "");
    $("ghost-num").textContent = String(round.i + 1).padStart(2, "0");
    $("q-text").textContent = q.q;
    $("note").hidden = true;
    $("reveal").hidden = true;
    renderMeta();
    renderStreak();
    restartAnim($("card"), "enter");

    const opts = $("options");
    opts.innerHTML = "";
    if (round.mode === "mc") {
      round.choices = shuffle([q.a, ...q.w]);
      round.choices.forEach((choice, idx) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "opt";
        b.innerHTML = `<span class="bubble">${LETTERS[idx]}</span><span>${esc(choice)}</span>`;
        b.addEventListener("click", () => answerChoice(idx));
        li.appendChild(b);
        opts.appendChild(li);
      });
      opts.hidden = false;
      setActions([]);
      $("keys").textContent = "A–D or 1–4 to answer · Enter for next";
    } else {
      opts.hidden = true;
      setActions([{ label: "Reveal answer", cls: "btn-big", fn: reveal }]);
      $("keys").textContent = "Space to reveal · Y got it · N missed it";
    }
    startTimer();
  }

  function setActions(list, feedback) {
    const box = $("card-actions");
    box.innerHTML = "";
    if (feedback) {
      const p = document.createElement("p");
      p.className = "feedback " + feedback.cls;
      p.textContent = feedback.text;
      box.appendChild(p);
    }
    for (const a of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (a.cls || "");
      b.textContent = a.label;
      b.addEventListener("click", a.fn);
      box.appendChild(b);
    }
  }

  function startTimer() {
    stopTimer();
    const bar = $("timer");
    bar.hidden = !round.timer;
    if (!round.timer) return;
    const fill = $("timer-fill");
    const end = performance.now() + TIME_LIMIT * 1000;
    const tick = () => {
      const left = Math.max(0, end - performance.now());
      fill.style.transform = `scaleX(${left / (TIME_LIMIT * 1000)})`;
      bar.classList.toggle("low", left < 5000);
      if (left <= 0) { stopTimer(); answerChoice(null); return; }
      timerId = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopTimer() {
    if (timerId) cancelAnimationFrame(timerId);
    timerId = null;
  }

  function celebrate(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const big = round.streak >= 3;
    confetti(x, y, big ? 90 : 45, big ? 1.3 : 0.9);
    floatPlus(x, r.top);
  }

  function answerChoice(idx) {
    if (round.answered) return;
    stopTimer();
    const q = round.qs[round.i];
    const correctIdx = round.choices.indexOf(q.a);
    const ok = idx === correctIdx;
    const buttons = [...$("options").querySelectorAll(".opt")];
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === correctIdx) b.classList.add("correct");
      else if (i === idx) b.classList.add("wrong");
      else b.classList.add("faded");
    });
    const text = ok
      ? pick(["Correct!", "Nailed it.", "Got it.", "Easy points."])
      : idx === null ? `Time's up. It was ${q.a}.` : `Not quite. It was ${q.a}.`;
    finishQuestion(ok, idx === null ? null : round.choices[idx], { cls: ok ? "good" : "bad", text });
    if (ok) celebrate(buttons[correctIdx]);
  }

  function reveal() {
    if (round.revealed) return;
    round.revealed = true;
    const q = round.qs[round.i];
    $("reveal-answer").textContent = q.a;
    $("reveal").hidden = false;
    showNote(q);
    setActions([
      { label: "Got it (Y)", cls: "btn-good", fn: (e) => markRecall(true, e.currentTarget) },
      { label: "Missed it (N)", cls: "btn-bad", fn: () => markRecall(false) },
    ]);
  }

  function markRecall(ok, el) {
    if (round.answered) return;
    finishQuestion(ok, null, null);
    if (ok) celebrate(el || $("reveal"));
    setTimeout(next, reduceMotion ? 0 : ok ? 450 : 350);
  }

  function showNote(q) {
    $("note").textContent = q.n || "";
    $("note").hidden = !q.n;
  }

  function finishQuestion(ok, picked, feedback) {
    const q = round.qs[round.i];
    round.answered = true;
    round.results.push({ id: q.id, ok, picked });
    if (ok) { round.score++; round.streak++; } else { round.streak = 0; }
    stats.bestStreak = Math.max(stats.bestStreak, round.streak);

    const cs = stats.cats[q.c] || (stats.cats[q.c] = { seen: 0, right: 0 });
    cs.seen++;
    if (ok) cs.right++;
    stats.seen[q.id] = (stats.seen[q.id] || 0) + 1;
    stats.missed = stats.missed.filter((id) => id !== q.id);
    if (!ok) stats.missed.push(q.id);
    saveStats();

    renderMeta();
    renderStreak();
    if (!ok && !reduceMotion) restartAnim($("card"), "shake");
    if (round.mode === "recall") return;
    showNote(q);
    const last = round.i === round.qs.length - 1;
    setActions([{ label: last ? "See results" : "Next question", cls: "btn-big", fn: next }], feedback);
    $("card-actions").querySelector(".btn").focus({ preventScroll: true });
  }

  function next() {
    if (!round) return;
    if (round.i < round.qs.length - 1) {
      round.i++;
      renderQuestion();
    } else {
      endRound();
    }
  }

  function countUp(el, to) {
    if (reduceMotion || to === 0) { el.textContent = to; return; }
    const start = performance.now(), dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function endRound() {
    stopTimer();
    if (!round || !round.results.length) { show("home"); renderSetup(); return; }
    if (!$("results").hidden) return;
    stats.rounds++;
    saveStats();
    const total = round.results.length;
    const pct = round.score / total;
    const verdicts = [
      [0.9, "Ringer.", "The other teams should be worried."],
      [0.7, "Podium finish.", "Solid round. Drill the misses and you're winning."],
      [0.5, "Mid-table.", "Respectable. Your misses below are tomorrow's points."],
      [0.3, "Bonus-round hopeful.", "Keep practising. Every miss is now on your drill list."],
      [0, "Wooden spoon.", "Everyone starts here. Retry the misses and watch this climb."],
    ];
    const [, head, tail] = verdicts.find(([min]) => pct >= min);
    $("score-of").textContent = `/${total}`;
    $("verdict").innerHTML = `<strong>${head}</strong>${tail}`;

    const byCat = {};
    for (const r of round.results) {
      const c = BY_ID[r.id].c;
      (byCat[c] || (byCat[c] = { n: 0, ok: 0 })).n++;
      if (r.ok) byCat[c].ok++;
    }
    $("breakdown").innerHTML = CATS.filter((c) => byCat[c.id]).map((c, i) => {
      const b = byCat[c.id];
      return `<li style="--cat:${catVar(c.id)};--i:${i}"><span>${esc(c.name)}</span><span class="bar"><span style="width:${(b.ok / b.n) * 100}%"></span></span><span class="pct">${b.ok}/${b.n}</span></li>`;
    }).join("");

    const misses = round.results.filter((r) => !r.ok);
    $("redo-misses").hidden = misses.length === 0;
    $("review").innerHTML = round.results.map((r) => {
      const q = BY_ID[r.id];
      const yours = !r.ok && r.picked ? ` · you said ${esc(r.picked)}` : "";
      return `<li style="--cat:${catVar(q.c)}"><span class="mark ${r.ok ? "good" : "bad"}">${r.ok ? "✓" : "✗"}</span><div><p class="rq">${esc(q.q)}</p><p class="ra"><b>${esc(q.a)}</b>${yours}</p></div></li>`;
    }).join("");
    show("results");
    countUp($("score-num"), round.score);
    if (pct >= 0.7) setTimeout(() => confetti(innerWidth / 2, innerHeight * 0.45, 160, 1.6), 500);
  }

  // ---------- Wiring ----------
  $("cats-toggle").addEventListener("click", () => {
    prefs.cats = prefs.cats.length ? [] : CATS.map((c) => c.id);
    persistPrefs();
    renderSetup();
  });
  $("quick").addEventListener("click", () => startRound(pickQuestions(QUESTIONS, 10)));
  $("start").addEventListener("click", () => startRound(pickQuestions(filteredPool(), prefs.len)));
  $("drill").addEventListener("click", () => startRound(pickQuestions(stats.missed.map((id) => BY_ID[id]), prefs.len)));
  $("again").addEventListener("click", () => startRound(pickQuestions(filteredPool(), prefs.len)));
  $("redo-misses").addEventListener("click", () => {
    const ids = round.results.filter((r) => !r.ok).map((r) => r.id);
    startRound(shuffle(ids.map((id) => BY_ID[id])));
  });
  $("home-btn").addEventListener("click", () => { show("home"); renderSetup(); });
  $("brand").addEventListener("click", () => {
    if (!$("play").hidden && round && round.results.length) return endRound();
    stopTimer();
    show("home");
    renderSetup();
  });
  $("quit").addEventListener("click", endRound);

  let resetArmed = false;
  $("reset").addEventListener("click", () => {
    const btn = $("reset");
    if (!resetArmed) {
      resetArmed = true;
      btn.textContent = "Tap again to erase all stats";
      btn.classList.add("armed");
      setTimeout(() => { resetArmed = false; btn.textContent = "Reset my stats"; btn.classList.remove("armed"); }, 4000);
      return;
    }
    resetArmed = false;
    stats = { ...freshStats(), prefs: { ...prefs } };
    saveStats();
    btn.textContent = "Reset my stats";
    btn.classList.remove("armed");
    renderSetup();
  });

  document.addEventListener("keydown", (e) => {
    if ($("play").hidden || !round || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (round.mode === "mc") {
      if (!round.answered) {
        const idx = "abcd".indexOf(k) >= 0 ? "abcd".indexOf(k) : "1234".indexOf(k);
        if (idx >= 0) { e.preventDefault(); answerChoice(idx); }
      } else if (k === "enter" || k === " ") {
        e.preventDefault();
        next();
      }
    } else if (!round.revealed && (k === " " || k === "enter")) {
      e.preventDefault();
      reveal();
    } else if (round.revealed && !round.answered && (k === "y" || k === "n")) {
      e.preventDefault();
      markRecall(k === "y", $("card-actions").querySelector(".btn-good"));
    }
  });

  // Section headers and panels rise in as you scroll (CSS handles it where supported).
  document.querySelectorAll(".sec-head, .rules, .wheel-layout").forEach((el) => el.classList.add("reveal-on-scroll"));
  const packDate = window.TRIVIA_PACKS && window.TRIVIA_PACKS.updated;
  if (PACK.some((q) => q.src === "opentdb")) {
    $("pack-credit").innerHTML = `Extra questions from <a href="https://opentdb.com" target="_blank" rel="noopener">Open Trivia DB</a> (CC BY-SA 4.0)${packDate ? `, last refreshed ${esc(packDate)}` : ""}.`;
  }

  buildDeck();
  renderTicker();
  renderSetup();
  startRotator();
})();

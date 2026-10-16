(() => {
  const CATS = window.TRIVIA_CATEGORIES;
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const QUESTIONS = window.TRIVIA_QUESTIONS;
  const BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
  const STORE_KEY = "trivia-night-trainer-v1";
  const TIME_LIMIT = 20; // seconds per question when the timer is on
  const LETTERS = ["A", "B", "C", "D"];

  const $ = (id) => document.getElementById(id);
  const catVar = (id) => `var(--c-${id})`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

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
    { cats: CATS.map((c) => c.id), diff: "any", len: 10, mode: "mc", timer: true },
    stats.prefs || {}
  );
  prefs.cats = prefs.cats.filter((id) => CAT[id]);

  // ---------- Setup screen ----------
  const DIFFS = [["any", "Mixed"], ["1", "Easy"], ["2", "Medium"], ["3", "Hard"]];
  const LENS = [[10, "10"], [20, "20"], [0, "All"]];
  const TIMERS = [[true, "20 sec"], [false, "Off"]];
  const MODES = [["mc", "Multiple choice"], ["recall", "Pub rules (no options)"]];
  const MODE_HINTS = {
    mc: "Pick from four answers. Good for learning new facts.",
    recall: "Say or write your answer, then reveal it and mark yourself honestly. This is how real quiz nights work.",
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
    return QUESTIONS.filter((q) => prefs.cats.includes(q.c) && (prefs.diff === "any" || String(q.d) === prefs.diff));
  }

  function renderSetup() {
    const grid = $("cat-grid");
    grid.innerHTML = "";
    for (const c of CATS) {
      const n = QUESTIONS.filter((q) => q.c === c.id).length;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cat-btn";
      b.style.setProperty("--cat", catVar(c.id));
      b.setAttribute("aria-pressed", String(prefs.cats.includes(c.id)));
      b.innerHTML = `<span class="dot"></span><span class="nm">${esc(c.name)}</span><span class="ct">${esc(c.blurb)} · ${n} Qs</span>`;
      b.addEventListener("click", () => {
        prefs.cats = prefs.cats.includes(c.id) ? prefs.cats.filter((x) => x !== c.id) : [...prefs.cats, c.id];
        persistPrefs();
        renderSetup();
      });
      grid.appendChild(b);
    }
    $("cats-toggle").textContent = prefs.cats.length ? "Select none" : "Select all";

    segmented($("seg-diff"), DIFFS, prefs.diff, (v) => { prefs.diff = v; persistPrefs(); renderSetup(); });
    segmented($("seg-len"), LENS, prefs.len, (v) => { prefs.len = v; persistPrefs(); renderSetup(); });
    segmented($("seg-timer"), TIMERS, prefs.timer, (v) => { prefs.timer = v; persistPrefs(); renderSetup(); });
    segmented($("seg-mode"), MODES, prefs.mode, (v) => { prefs.mode = v; persistPrefs(); renderSetup(); });
    $("seg-timer").closest(".field").hidden = prefs.mode !== "mc";
    $("mode-hint").textContent = MODE_HINTS[prefs.mode];

    const pool = filteredPool();
    const take = prefs.len ? Math.min(prefs.len, pool.length) : pool.length;
    $("start").disabled = pool.length === 0;
    $("pool-count").textContent = pool.length
      ? `${pool.length} questions match. This round will use ${take}.`
      : "No questions match. Pick at least one category.";
    const m = stats.missed.length;
    $("drill").disabled = m === 0;
    $("drill").textContent = m ? `Drill my misses (${m})` : "No misses to drill yet";

    renderWheel();
  }

  function persistPrefs() {
    stats.prefs = { ...prefs };
    saveStats();
  }

  // The wheel: one wedge per category, its length shows your accuracy there.
  function renderWheel() {
    const size = 200, cx = 100, cy = 100, R = 92, hub = 30;
    const step = (Math.PI * 2) / CATS.length;
    let wedges = "";
    let totalSeen = 0, totalRight = 0;
    CATS.forEach((c, i) => {
      const s = stats.cats[c.id] || { seen: 0, right: 0 };
      totalSeen += s.seen; totalRight += s.right;
      const acc = s.seen ? s.right / s.seen : 0;
      const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
      const wedge = (r) => {
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
      };
      wedges += `<path d="${wedge(R)}" fill="${catVar(c.id)}" fill-opacity="0.14" stroke="var(--surface)" stroke-width="2"/>`;
      if (acc > 0) {
        const r = hub + (R - hub) * acc;
        wedges += `<path d="${wedge(r)}" fill="${catVar(c.id)}" stroke="var(--surface)" stroke-width="2"><title>${esc(c.name)}: ${Math.round(acc * 100)}%</title></path>`;
      }
    });
    const overall = totalSeen ? Math.round((totalRight / totalSeen) * 100) + "%" : "–";
    $("wheel").innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Accuracy by category">
      ${wedges}
      <circle cx="${cx}" cy="${cy}" r="${hub + 4}" fill="var(--surface)"/>
      <text class="hub-num" x="${cx}" y="${cy + 4}" text-anchor="middle">${overall}</text>
      <text class="hub-lbl" x="${cx}" y="${cy + 17}" text-anchor="middle">OVERALL</text>
    </svg>`;

    $("cat-stats").innerHTML = CATS.map((c) => {
      const s = stats.cats[c.id];
      const label = s && s.seen ? `${s.right}/${s.seen} · ${Math.round((s.right / s.seen) * 100)}%` : "not played";
      return `<li style="--cat:${catVar(c.id)}"><span class="dot"></span><span>${esc(c.name)}</span><span class="pct">${label}</span></li>`;
    }).join("");

    $("tally").innerHTML = `
      <div><dt>Rounds played</dt><dd>${stats.rounds}</dd></div>
      <div><dt>Answered</dt><dd>${totalSeen}</dd></div>
      <div><dt>Best streak</dt><dd>${stats.bestStreak}</dd></div>`;
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
    $("masthead-tag").textContent = screen === "play" ? "Round in progress" : "Practice rounds for quiz night";
    window.scrollTo({ top: 0 });
  }

  function renderQuestion() {
    const q = round.qs[round.i];
    round.answered = false;
    round.revealed = false;
    round.picked = null;

    const card = document.querySelector(".card");
    card.style.setProperty("--cat", catVar(q.c));
    $("q-cat").textContent = CAT[q.c].name;
    $("q-cat").style.setProperty("--cat", catVar(q.c));
    $("q-meta").textContent = `Q${round.i + 1} of ${round.qs.length} · ${"●".repeat(q.d)}${"○".repeat(3 - q.d)} · ${round.score} pts`;
    $("q-text").textContent = q.q;
    $("note").hidden = true;
    $("reveal").hidden = true;

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
      $("keys").textContent = "Keys: A–D or 1–4 to answer · Enter for next";
    } else {
      opts.hidden = true;
      setActions([{ label: "Reveal answer", cls: "btn-primary", fn: reveal }]);
      $("keys").textContent = "Keys: Space to reveal · Y got it · N missed it";
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
      p.style.flexBasis = "100%";
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
    const first = box.querySelector("button");
    if (first && round.mode === "recall") first.focus({ preventScroll: true });
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

  function answerChoice(idx) {
    if (round.answered) return;
    stopTimer();
    const q = round.qs[round.i];
    const correctIdx = round.choices.indexOf(q.a);
    const ok = idx === correctIdx;
    [...$("options").querySelectorAll(".opt")].forEach((b, i) => {
      b.disabled = true;
      if (i === correctIdx) b.classList.add("correct");
      else if (i === idx) b.classList.add("wrong");
      else b.classList.add("faded");
    });
    const text = ok ? "Correct!" : idx === null ? `Time's up. It was ${q.a}.` : `Not quite. It was ${q.a}.`;
    finishQuestion(ok, idx === null ? null : round.choices[idx], { cls: ok ? "good" : "bad", text });
  }

  function reveal() {
    if (round.revealed) return;
    round.revealed = true;
    const q = round.qs[round.i];
    $("reveal-answer").textContent = q.a;
    $("reveal").hidden = false;
    showNote(q);
    setActions([
      { label: "Got it", cls: "btn-good", fn: () => markRecall(true) },
      { label: "Missed it", cls: "btn-bad", fn: () => markRecall(false) },
    ]);
  }

  function markRecall(ok) {
    if (round.answered) return;
    finishQuestion(ok, null, null, true);
  }

  function showNote(q) {
    $("note").textContent = q.n;
    $("note").hidden = !q.n;
  }

  function finishQuestion(ok, picked, feedback, skipNext) {
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

    $("q-meta").textContent = `Q${round.i + 1} of ${round.qs.length} · ${"●".repeat(q.d)}${"○".repeat(3 - q.d)} · ${round.score} pts`;
    if (skipNext) { next(); return; }
    showNote(q);
    const last = round.i === round.qs.length - 1;
    setActions([{ label: last ? "See results" : "Next question", cls: "btn-primary", fn: next }], feedback);
    $("card-actions").querySelector(".btn").focus({ preventScroll: true });
  }

  function next() {
    if (round.i < round.qs.length - 1) {
      round.i++;
      renderQuestion();
    } else {
      endRound();
    }
  }

  function endRound() {
    stopTimer();
    if (!round.results.length) { show("home"); renderSetup(); return; }
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
    $("big-score").innerHTML = `${round.score}<small>/${total}</small>`;
    $("verdict").innerHTML = `<strong>${head}</strong> ${tail}`;

    const byCat = {};
    for (const r of round.results) {
      const c = BY_ID[r.id].c;
      (byCat[c] || (byCat[c] = { n: 0, ok: 0 })).n++;
      if (r.ok) byCat[c].ok++;
    }
    $("breakdown").innerHTML = CATS.filter((c) => byCat[c.id]).map((c) => {
      const b = byCat[c.id];
      return `<li style="--cat:${catVar(c.id)}"><span>${esc(c.name)}</span><span class="bar"><span style="width:${(b.ok / b.n) * 100}%"></span></span><span class="pct">${b.ok}/${b.n}</span></li>`;
    }).join("");

    const misses = round.results.filter((r) => !r.ok);
    $("redo-misses").hidden = misses.length === 0;
    $("review").innerHTML = round.results.map((r) => {
      const q = BY_ID[r.id];
      const yours = !r.ok && r.picked ? ` · you said ${esc(r.picked)}` : "";
      return `<li><span class="mark ${r.ok ? "good" : "bad"}">${r.ok ? "✓" : "✗"}</span><div><p class="rq">${esc(q.q)}</p><p class="ra"><b>${esc(q.a)}</b>${yours}</p></div></li>`;
    }).join("");
    show("results");
  }

  // ---------- Wiring ----------
  $("cats-toggle").addEventListener("click", () => {
    prefs.cats = prefs.cats.length ? [] : CATS.map((c) => c.id);
    persistPrefs();
    renderSetup();
  });
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
  $("quit").addEventListener("click", () => {
    stopTimer();
    endRound();
  });

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
      markRecall(k === "y");
    }
  });

  renderSetup();
})();

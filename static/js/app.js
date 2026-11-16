// One Minute Math: UI and round logic.
(function () {
  "use strict";
  const { OPS, LEVELS, createSource } = window.OMM.Problems;
  const Store = window.OMM.Store;
  const Scores = window.OMM.Scores;
  const $ = (id) => document.getElementById(id);
  const ROUND_MS = 60000;
  const PRACTICE_COUNT = 20;

  const state = {
    mode: "add", level: 1, clock: "timed", table: null,
    running: false, locked: false, typed: "",
    problem: null, source: null, correct: 0, attempts: 0, missed: [],
    startAt: 0, endAt: 0, raf: 0, announced: {}, lastRound: null, hofBoard: null
  };

  // ---------- helpers ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k);
    return n;
  }
  function show(view) {
    for (const v of ["home", "play", "results"]) $(v).hidden = v !== view;
    document.body.dataset.view = view;
    window.scrollTo(0, 0);
  }
  const modeLabel = () => `${OPS[state.mode].name} · Level ${state.level}`;
  const scored = () => state.clock === "timed" && !state.table;

  function sparkline(values, best) {
    if (values.length < 2) return el("p", { class: "muted small", text: values.length ? "Play another round to see your trend." : "" });
    const W = 260, H = 60, P = 6, max = Math.max(best, ...values, 1);
    const pts = values.map((v, i) => [P + (i * (W - 2 * P)) / (values.length - 1), H - P - (v / max) * (H - 2 * P)]);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "spark");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Last ${values.length} rounds: ${values.join(", ")}`);
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" "));
    svg.append(path);
    const last = pts[pts.length - 1];
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", last[0]); dot.setAttribute("cy", last[1]); dot.setAttribute("r", 3.5);
    svg.append(dot);
    return svg;
  }

  // ---------- home ----------
  function syncSetup() {
    document.querySelectorAll("#opTiles .tile").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    document.querySelectorAll("#lvlTiles .level").forEach((b) => {
      b.setAttribute("aria-pressed", String(+b.dataset.level === state.level));
      b.querySelector("small").textContent = LEVELS[state.mode][b.dataset.level];
    });
    document.querySelectorAll("#clockSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.clock === state.clock)));
    const tableOk = state.mode === "multiply" || state.mode === "divide";
    $("tableField").hidden = !tableOk;
    if (!tableOk) { state.table = null; $("tableSelect").value = ""; }
    $("setupHint").textContent = scored()
      ? "60 seconds. Answers check themselves as you type."
      : state.clock === "practice" ? `${PRACTICE_COUNT} problems, no clock. Take your time.` : "Table practice isn't added to your bests.";
    renderProgress();
    loadHof();
  }

  function renderProgress() {
    $("progMode").textContent = `· ${modeLabel()}`;
    const box = $("progress"); box.replaceChildren();
    const hist = Store.history(state.mode, state.level);
    const best = Store.best(state.mode, state.level);
    if (!hist.length && !best) {
      box.append(el("p", { class: "muted", text: "No rounds yet at this level. Your best and your trend will show up here." }));
      return;
    }
    const last = hist.slice(-10).map((h) => h.score);
    box.append(
      el("div", { class: "stats" },
        el("div", {}, el("span", { class: "statnum", text: String(best) }), el("span", { class: "muted small", text: "best" })),
        el("div", {}, el("span", { class: "statnum", text: last.length ? String(last[last.length - 1]) : "–" }), el("span", { class: "muted small", text: "last round" })),
        el("div", {}, el("span", { class: "statnum", text: String(hist.length) }), el("span", { class: "muted small", text: "rounds" }))
      ),
      sparkline(last, best)
    );
    const weak = Store.weakFacts(state.mode, state.level, 6);
    if (weak.length) box.append(el("p", { class: "small" }, "Facts to keep practicing: ", ...weak.map((k) => el("span", { class: "chip", text: k.replace(/([+−×÷])/, " $1 ") }))));
  }

  let hofReq = 0;
  async function loadHof() {
    $("hofMode").textContent = `· ${modeLabel()}`;
    const box = $("hof");
    const my = ++hofReq;
    state.hofBoard = null;
    if (!Scores.configured) {
      box.replaceChildren(el("p", { class: "muted", text: "The Hall of Fame is offline right now. Your own progress still saves on this device." }));
      return;
    }
    box.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
    try {
      const rows = await Scores.top(state.mode, state.level, 10);
      if (my !== hofReq) return;
      state.hofBoard = rows;
      if (!rows.length) { box.replaceChildren(el("p", { class: "muted", text: "No scores yet at this level." })); return; }
      const ol = el("ol", { class: "board" });
      rows.forEach((r) => {
        const name = r.initials || "---";
        ol.append(el("li", {}, el("span", { class: "who initials-text", text: name }), el("span", { class: "pts", text: String(r.score) })));
      });
      box.replaceChildren(ol);
    } catch (e) {
      if (my !== hofReq) return;
      box.replaceChildren(el("p", { class: "muted", text: "Couldn't reach the Hall of Fame. Your own progress still saves on this device." }));
    }
  }

  // ---------- play ----------
  function startRound() {
    if (Scores.configured && state.clock === "timed" && !state.table) loadHof(); // fresh top 10 for the initials check
    state.source = createSource({ mode: state.mode, level: state.level, table: state.table, weakKeys: Store.weakFacts(state.mode, state.level) });
    state.correct = 0; state.attempts = 0; state.missed = []; state.typed = ""; state.announced = {};
    state.running = false; state.locked = true;
    show("play");
    input().value = ""; input().classList.remove("good", "miss");
    input().focus({ preventScroll: true }); // inside the user's tap, so iOS/Android open the number keyboard
    $("timeText").textContent = state.clock === "timed" ? "60" : `0/${PRACTICE_COUNT}`;
    $("timerFill").style.transform = "scaleX(1)";
    $("timerFill").parentElement.style.visibility = state.clock === "timed" ? "visible" : "hidden";
    $("feedback").textContent = ""; $("tally").textContent = "";
    renderAnswer();
    let n = 3;
    const tick = () => {
      if (document.body.dataset.view !== "play") return;
      if (n > 0) { $("problem").textContent = String(n); n--; state.countdown = setTimeout(tick, 700); }
      else begin();
    };
    tick();
  }

  function begin() {
    state.running = true; state.locked = false;
    focusInput();
    state.startAt = performance.now();
    state.endAt = state.startAt + ROUND_MS;
    nextProblem();
    if (state.clock === "timed") frame();
  }

  function frame() {
    if (!state.running) return;
    const left = Math.max(0, state.endAt - performance.now());
    $("timerFill").style.transform = `scaleX(${left / ROUND_MS})`;
    const secs = Math.ceil(left / 1000);
    $("timeText").textContent = String(secs);
    for (const s of [30, 10]) if (secs === s && !state.announced[s]) { state.announced[s] = true; $("timeAnnounce").textContent = `${s} seconds left`; }
    document.body.classList.toggle("low-time", secs <= 10);
    if (left <= 0) return endRound();
    state.raf = requestAnimationFrame(frame);
  }

  function nextProblem() {
    state.problem = state.source.next();
    state.typed = "";
    $("problem").textContent = `${state.problem.text} =`;
    $("problem").setAttribute("aria-label", spoken(state.problem));
    renderAnswer();
  }
  function spoken(p) {
    const w = { add: "plus", subtract: "minus", multiply: "times", divide: "divided by" }[p.op];
    return `${p.a} ${w} ${p.b}`;
  }
  const input = () => $("answerInput");
  function renderAnswer() {
    if (input().value !== state.typed) input().value = state.typed;
  }
  function focusInput() {
    const i = input();
    if (document.body.dataset.view === "play" && document.activeElement !== i) i.focus({ preventScroll: true });
  }

  // Called on every change to the answer box. Digits only (no answer is ever negative).
  function onInput() {
    const i = input();
    if (!state.running || state.locked) { i.value = state.typed; return; } // ignore keys during countdown/feedback
    let v = i.value.replace(/\D/g, "").slice(0, 4);
    if (v.length > 1) v = v.replace(/^0+(?=\d)/, "");
    state.typed = v;
    if (i.value !== v) i.value = v;
    if (!v) return;
    const ans = String(state.problem.answer);
    if (v === ans || v.length >= ans.length) judge();
  }
  function submitEnter() {
    if (state.running && !state.locked && state.typed) judge();
  }

  function judge() {
    const p = state.problem;
    const ok = Number(state.typed) === p.answer;
    state.attempts++;
    Store.recordFact(state.mode, state.level, p.key, ok);
    state.locked = true; // ignore keys during feedback (old site counted them as extra wrong answers)
    const fb = $("feedback");
    if (ok) {
      state.correct++;
      fb.textContent = "✓"; fb.className = "feedback good";
      input().classList.add("good");
    } else {
      if (!state.missed.includes(p.key)) state.missed.push(p.key);
      fb.textContent = `${p.text} = ${p.answer}`; fb.className = "feedback miss";
      input().classList.add("miss");
    }
    $("tally").textContent = state.clock === "timed" ? `${state.correct} correct` : "";
    if (state.clock === "practice") $("timeText").textContent = `${state.attempts}/${PRACTICE_COUNT}`;
    setTimeout(() => {
      input().classList.remove("good", "miss");
      if (ok) { fb.textContent = ""; fb.className = "feedback"; }
      if (!state.running) return;
      if (state.clock === "practice" && state.attempts >= PRACTICE_COUNT) return endRound();
      state.locked = false;
      nextProblem();
    }, ok ? 120 : 900);
  }

  function endRound() {
    state.running = false; state.locked = true;
    cancelAnimationFrame(state.raf);
    document.body.classList.remove("low-time");
    Store.saveFacts();
    const durationMs = Math.round(performance.now() - state.startAt);
    const r = { mode: state.mode, level: state.level, score: state.correct, attempts: state.attempts, missed: state.missed.slice(), durationMs, scored: scored() };
    r.prevBest = r.scored && r.attempts > 0 ? Store.recordRound(r.mode, r.level, r) : Store.best(r.mode, r.level);
    state.lastRound = r;
    showResults(r); // focuses the initials box (keeping the phone keyboard up) when the score places
    if (document.activeElement === input()) input().blur();
  }

  function quitRound() {
    clearTimeout(state.countdown);
    state.running = false; state.locked = true;
    cancelAnimationFrame(state.raf);
    document.body.classList.remove("low-time");
    Store.saveFacts();
    input().blur();
    show("home"); syncSetup();
  }

  // ---------- results ----------
  function showResults(r) {
    show("results");
    const tag = r.scored ? "1 minute" : state.table ? `${state.table}s table practice` : "practice";
    $("resMode").textContent = `${OPS[r.mode].name} · Level ${r.level} · ${tag}`;
    $("resScore").textContent = String(r.score);
    const acc = r.attempts ? Math.round((100 * r.score) / r.attempts) : 0;
    $("resDetail").textContent = r.attempts ? `${r.attempts} answered · ${acc}% accurate` : "No answers this time.";
    let line = "";
    if (r.scored && r.attempts) {
      if (r.prevBest === 0) line = "First round at this level. That's your starting point.";
      else if (r.score > r.prevBest) line = `${r.score - r.prevBest} more than your previous best (${r.prevBest}).`;
      else if (r.score === r.prevBest) line = `Matched your best (${r.prevBest}).`;
      else line = `Your best is ${r.prevBest}. Every round counts as practice.`;
    }
    $("resBest").textContent = line;
    const spark = $("resSpark"); spark.replaceChildren();
    if (r.scored) { const h = Store.history(r.mode, r.level).slice(-10).map((x) => x.score); spark.append(sparkline(h, Store.best(r.mode, r.level))); }
    const m = $("resMissed"); m.replaceChildren();
    if (r.missed.length) {
      m.append(el("p", { class: "small" }, "Worth another look: ", ...r.missed.slice(0, 12).map((k) => {
        const p = window.OMM.Problems.parseKey(k);
        return el("span", { class: "chip", text: p ? `${p.text} = ${p.answer}` : k });
      })));
    }
    $("printMissedBtn").hidden = !r.missed.length;
    if (!maybeOfferHof(r)) $("againBtn").focus();
  }

  // ---------- arcade initials ----------
  const initialsInput = () => $("initialsInput");
  function renderSlots() {
    const v = initialsInput().value;
    const focused = document.activeElement === initialsInput();
    document.querySelectorAll("#initialsBox .slot").forEach((slot, i) => {
      slot.textContent = v[i] || "";
      slot.classList.toggle("filled", !!v[i]);
      slot.classList.toggle("active", focused && i === Math.min(v.length, 2) && !(v.length === 3 && i !== 2));
    });
  }
  function rankFor(board, score) { return board.filter((b) => b.score >= score).length + 1; }

  function maybeOfferHof(r) {
    const box = $("hofOffer"); box.hidden = true; $("hofMsg").textContent = ""; $("hofMsg").className = "init-msg";
    state.offerFor = null;
    if (!Scores.configured || !r.scored || r.score <= 0) return false;
    const decide = (board) => {
      if (state.lastRound !== r || !Scores.qualifies(board, r.score)) return false;
      state.offerFor = r;
      $("initRank").textContent = `You're #${rankFor(board, r.score)} for ${OPS[r.mode].name}, Level ${r.level}. Enter your initials`;
      const i = initialsInput();
      i.value = Store.initials();
      i.disabled = false; $("hofAdd").disabled = false; $("hofSkip").disabled = false;
      box.hidden = false;
      i.focus({ preventScroll: true });
      i.select();
      renderSlots();
      box.scrollIntoView({ block: "nearest" });
      return true;
    };
    if (state.hofBoard) return decide(state.hofBoard);
    // board wasn't loaded yet: fetch it, then prompt (tap the boxes to bring up the keyboard)
    Scores.top(r.mode, r.level, 10).then((rows) => { state.hofBoard = rows; decide(rows); }).catch(() => {});
    return false;
  }

  function closeOffer() {
    $("hofOffer").hidden = true; state.offerFor = null;
    initialsInput().blur();
    $("againBtn").focus();
  }

  async function submitHof() {
    const r = state.offerFor; if (!r) return;
    const v = Scores.cleanInitials(initialsInput().value);
    const msg = $("hofMsg");
    if (v.length !== 3) { msg.textContent = "Enter 3 letters."; msg.className = "init-msg warn"; initialsInput().focus(); return; }
    if (!Scores.initialsOk(v)) { msg.textContent = "Those initials aren't allowed. Try different ones."; msg.className = "init-msg warn"; initialsInput().select(); return; }
    $("hofAdd").disabled = true; $("hofSkip").disabled = true; initialsInput().disabled = true;
    msg.textContent = "Saving…"; msg.className = "init-msg";
    try {
      await Scores.submit({ mode: r.mode, level: r.level, score: r.score, attempts: r.attempts, durationMs: r.durationMs, initials: v });
      Store.setInitials(v);
      msg.textContent = `Saved! ${v} is on the Hall of Fame.`; msg.className = "init-msg ok";
      state.offerFor = null;
      loadHof();
      setTimeout(() => { if (!state.offerFor) { $("hofOffer").hidden = true; if (document.body.dataset.view === "results") $("againBtn").focus(); } }, 1400);
    } catch (e) {
      const m = String(e && e.message || "");
      if (/top-10/.test(m)) msg.textContent = "Someone just beat that score, so it didn't make the top 10 this time.";
      else if (/initials/.test(m)) { msg.textContent = "Those initials aren't allowed. Try different ones."; initialsInput().disabled = false; $("hofAdd").disabled = false; $("hofSkip").disabled = false; initialsInput().focus(); initialsInput().select(); msg.className = "init-msg warn"; return; }
      else msg.textContent = "Couldn't save right now. Your score is still saved on this device.";
      msg.className = "init-msg warn";
      $("hofAdd").disabled = false; $("hofSkip").disabled = false; initialsInput().disabled = false;
    }
  }

  // ---------- printable worksheet ----------
  function buildSheet(problems, title) {
    const sheet = $("sheet"); sheet.replaceChildren();
    const page = (heading, withAnswers) => {
      const pg = el("div", { class: "page" });
      pg.append(el("div", { class: "sheet-head" },
        el("h1", { text: heading }),
        el("p", { text: withAnswers ? "Answer key" : "Name ____________________   Date __________   Correct ____ / " + problems.length })));
      const grid = el("ol", { class: "sheet-grid" });
      problems.forEach((p) => grid.append(el("li", {}, el("span", { text: `${p.text} = ` }), el("span", { class: "blank", text: withAnswers ? String(p.answer) : "" }))));
      pg.append(grid, el("p", { class: "sheet-foot", text: "oneminmath.com · try it in one minute" }));
      return pg;
    };
    sheet.append(page(title, false), page(title, true));
  }
  function printSheet(fromMissed) {
    let problems = [];
    if (fromMissed && state.lastRound && state.lastRound.missed.length) {
      const base = state.lastRound.missed.map((k) => window.OMM.Problems.parseKey(k)).filter(Boolean);
      const src = createSource({ mode: state.lastRound.mode, level: state.lastRound.level, weakKeys: state.lastRound.missed });
      while (problems.length < 40) problems.push(problems.length % 2 === 0 && base.length ? base[(problems.length / 2) % base.length] : src.next());
      buildSheet(problems, `Practice sheet: ${OPS[state.lastRound.mode].name}, Level ${state.lastRound.level}`);
    } else {
      const src = createSource({ mode: state.mode, level: state.level, table: state.table });
      for (let i = 0; i < 60; i++) problems.push(src.next());
      buildSheet(problems, `${OPS[state.mode].name}, Level ${state.level}${state.table ? ` (${state.table}s)` : ""}: ${LEVELS[state.mode][state.level]}`);
    }
    window.print();
  }

  // ---------- wiring ----------
  function wire() {
    $("opTiles").addEventListener("click", (e) => { const b = e.target.closest(".tile"); if (b) { state.mode = b.dataset.mode; syncSetup(); } });
    $("lvlTiles").addEventListener("click", (e) => { const b = e.target.closest(".level"); if (b) { state.level = +b.dataset.level; syncSetup(); } });
    $("clockSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.clock = b.dataset.clock; syncSetup(); } });
    const sel = $("tableSelect");
    for (let t = 2; t <= 12; t++) sel.append(el("option", { value: String(t), text: `${t}s` }));
    sel.addEventListener("change", () => { state.table = sel.value ? +sel.value : null; syncSetup(); });
    $("startBtn").addEventListener("click", startRound);
    $("againBtn").addEventListener("click", startRound);
    $("menuBtn").addEventListener("click", () => { show("home"); syncSetup(); });
    $("quitBtn").addEventListener("click", quitRound);
    const ai = input();
    ai.addEventListener("input", onInput);
    ai.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submitEnter(); }
      else if (e.key === "Escape") { e.preventDefault(); quitRound(); }
    });
    // keep the box focused for the whole round
    ai.addEventListener("blur", () => { if (document.body.dataset.view === "play") setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) focusInput(); }, 0); });
    $("play").addEventListener("click", (e) => { if (!e.target.closest("button")) focusInput(); });
    // keep problem + box above the phone keyboard
    const vv = window.visualViewport;
    const fit = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${Math.round(h)}px`);
      if (document.body.dataset.view === "play") window.scrollTo(0, 0);
    };
    if (vv) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }
    window.addEventListener("resize", fit);
    fit();
    const ii = initialsInput();
    ii.addEventListener("input", () => {
      const v = Scores.cleanInitials(ii.value);
      if (ii.value !== v) ii.value = v;
      $("hofMsg").textContent = ""; $("hofMsg").className = "init-msg";
      renderSlots();
    });
    ii.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submitHof(); }
      else if (e.key === "Escape") { e.preventDefault(); closeOffer(); }
    });
    ii.addEventListener("focus", renderSlots);
    ii.addEventListener("blur", () => setTimeout(renderSlots, 0));
    ["keyup", "click", "select"].forEach((ev) => ii.addEventListener(ev, () => { const n = ii.value.length; if (ii.selectionStart !== ii.selectionEnd && ii.selectionEnd - ii.selectionStart < n) ii.setSelectionRange(n, n); }));
    $("initialsBox").addEventListener("click", () => { ii.focus(); });
    $("hofAdd").addEventListener("click", submitHof);
    $("hofSkip").addEventListener("click", closeOffer);
    $("printNav").addEventListener("click", () => printSheet(false));
    $("printMissedBtn").addEventListener("click", () => printSheet(true));
    $("resetBtn").addEventListener("click", () => {
      if (window.confirm("Clear all your bests and history on this device?")) { Store.resetAll(); syncSetup(); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const view = document.body.dataset.view;
      if (view === "play") {
        if (e.target === input()) return; // handled by the box itself
        if (e.key === "Escape") { e.preventDefault(); quitRound(); }
        else if (/^\d$/.test(e.key) || e.key === "Backspace" || e.key === "Enter") focusInput();
      } else if (e.key === "Enter" && (e.target === document.body || e.target === document.documentElement)) {
        e.preventDefault();
        if (view === "results" && !$("hofOffer").hidden) initialsInput().focus();
        else startRound();
      }
    });
  }

  wire();
  show("home");
  syncSetup();
  window.OMM.App = { state, endRound }; // exposed for testing
})();

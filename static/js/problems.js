// Problem generation for One Minute Math.
// Design goals: fair, varied practice. Small fact sets use a shuffled "deck"
// (every fact once before any repeat, no back-to-back duplicates); large ranges
// use random draws with a recent-history filter. Trivial facts (0 and 1) appear
// rarely. Facts the player missed before come back a little more often.
(function () {
  "use strict";

  const OPS = {
    add: { sym: "+", name: "Addition" },
    subtract: { sym: "−", name: "Subtraction" },
    multiply: { sym: "×", name: "Multiplication" },
    divide: { sym: "÷", name: "Division" },
    smarty: { sym: "?", name: "Mixed" }
  };

  const LEVELS = {
    add:      { 1: "Facts to 10 + 10", 2: "Two-digit sums to 100", 3: "Two-digit + two-digit" },
    subtract: { 1: "Facts within 20", 2: "Within 100, answers to 50", 3: "Within 200" },
    multiply: { 1: "Tables 1–5", 2: "Tables 2–10", 3: "Tables to 12 × 12" },
    divide:   { 1: "Tables 1–5", 2: "Tables 2–10", 3: "Tables to 12 × 12" },
    smarty:   { 1: "All four, level 1", 2: "All four, level 2", 3: "All four, level 3" }
  };

  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function mk(op, a, b) {
    let answer;
    if (op === "add") answer = a + b;
    else if (op === "subtract") answer = a - b;
    else if (op === "multiply") answer = a * b;
    else answer = a / b;
    return { op, a, b, answer, key: `${a}${OPS[op].sym}${b}`, text: `${a} ${OPS[op].sym} ${b}` };
  }

  // Probability of keeping a "trivial" fact when building a deck.
  const TRIVIAL_KEEP = 0.25;

  // Enumerate the base facts for small (deck-based) sets, or null for random-range sets.
  function factSet(op, level, table) {
    const out = [];
    const isTrivial = (x, y) => x <= 1 || y <= 1;
    if (op === "multiply" || op === "divide") {
      let pairs = [];
      if (table) {
        for (let k = 0; k <= 12; k++) pairs.push(Math.random() < 0.5 ? [table, k] : [k, table]);
      } else if (level === 1) {
        for (let x = 0; x <= 5; x++) for (let y = 1; y <= 5; y++) pairs.push([x, y]);
      } else if (level === 2) {
        for (let x = 1; x <= 10; x++) for (let y = 2; y <= 10; y++) pairs.push([x, y]);
      } else {
        for (let x = 6; x <= 12; x++) for (let y = 2; y <= 12; y++) pairs.push(Math.random() < 0.5 ? [x, y] : [y, x]);
      }
      for (const [x, y] of pairs) {
        if (isTrivial(x, y) && Math.random() > TRIVIAL_KEEP) continue;
        if (op === "multiply") out.push(mk("multiply", x, y));
        else {
          // a ÷ b = c built from b × c; never divide by 0.
          const divisor = y === 0 ? x : y, quotient = y === 0 ? y : x;
          if (divisor === 0) continue;
          out.push(mk("divide", divisor * quotient, divisor));
        }
      }
      return out;
    }
    if (level !== 1) return null;
    if (op === "add") {
      for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) {
        if ((x === 0 && y === 0)) continue;
        if (isTrivial(x, y) && Math.random() > TRIVIAL_KEEP) continue;
        out.push(mk("add", x, y));
      }
      return out;
    }
    if (op === "subtract") {
      // inverse of the addition facts: (b + c) − b = c
      for (let b = 0; b <= 10; b++) for (let c = 0; c <= 10; c++) {
        if (b === 0 && c === 0) continue;
        if (isTrivial(b, c) && Math.random() > TRIVIAL_KEEP) continue;
        out.push(mk("subtract", b + c, b));
      }
      return out;
    }
    return null;
  }

  // Is this op/level a small fact set (deck) rather than a random range?
  const isDeck = (op, level, table) => op === "multiply" || op === "divide" || !!table || level === 1;

  function randomRangeProblem(op, level) {
    if (op === "add") {
      if (level === 2) { // sums to 100, mix of 2-digit + 1-digit and 2-digit + 2-digit
        const a = ri(10, 89);
        const b = Math.random() < 0.35 ? ri(2, 9) : ri(10, Math.max(10, 99 - a));
        return mk("add", a, Math.min(b, 100 - a));
      }
      return mk("add", ri(20, 99), ri(20, 99));
    }
    if (op === "subtract") {
      if (level === 2) { const b = ri(2, 50), c = ri(1, 50); return mk("subtract", b + c, b); }
      const b = ri(10, 99), c = ri(1, 100); return mk("subtract", b + c, b);
    }
    return null;
  }

  // A problem source for one round.
  // weakKeys: array of fact keys the player has missed before for this mode/level.
  function createSource({ mode, level, table = null, weakKeys = [] }) {
    const recent = [];
    const RECENT_MAX = 8;
    const decks = {};
    let opBag = [];

    function nextOp() {
      if (mode !== "smarty") return mode;
      if (!opBag.length) opBag = shuffle(["add", "subtract", "multiply", "divide"]);
      return opBag.pop();
    }
    // Mixed level 3 keeps add/subtract at level 2 so each item takes similar time.
    const levelFor = (op) => (mode === "smarty" && level === 3 && (op === "add" || op === "subtract")) ? 2 : level;

    function freshDeck(op, lvl) {
      const base = factSet(op, lvl, mode === "smarty" ? null : table) || [];
      // weak facts get one extra copy each
      const extras = base.filter((p) => weakKeys.includes(p.key)).map((p) => ({ ...p }));
      return shuffle(base.concat(extras));
    }
    function drawFromDeck(op, lvl) {
      const id = op + lvl;
      if (!decks[id] || !decks[id].length) decks[id] = freshDeck(op, lvl);
      const deck = decks[id];
      // avoid anything seen in the last few problems (and its commutative twin)
      const pickFresh = () => { for (let i = deck.length - 1; i >= 0; i--) if (!isRecent(deck[i])) return deck.splice(i, 1)[0]; return null; };
      let p = pickFresh();
      if (!p) { // only recent facts left (end of deck): top up with a new shuffle rather than repeat
        deck.unshift(...freshDeck(op, lvl));
        p = pickFresh();
      }
      return p || deck.pop();
    }

    function twinKey(p) {
      return (p.op === "add" || p.op === "multiply") ? `${p.b}${OPS[p.op].sym}${p.a}` : p.key;
    }
    function isRecent(p) {
      const window = recent.slice(-Math.min(RECENT_MAX, 4));
      return window.some((k) => k === p.key || k === twinKey(p));
    }

    function next() {
      const op = nextOp();
      const lvl = levelFor(op);
      let p = null;
      // revisit a missed fact now and then on random-range levels
      if (weakKeys.length && Math.random() < 0.15 && !isDeck(op, lvl, null)) {
        const k = weakKeys[Math.floor(Math.random() * weakKeys.length)];
        p = parseKey(k);
        if (p && (p.op !== op || isRecent(p))) p = null;
      }
      if (!p) {
        if (isDeck(op, lvl, mode === "smarty" ? null : table)) p = drawFromDeck(op, lvl);
        else {
          for (let tries = 0; tries < 20; tries++) {
            p = randomRangeProblem(op, lvl);
            if (!isRecent(p)) break;
          }
        }
      }
      recent.push(p.key);
      if (recent.length > RECENT_MAX) recent.shift();
      return p;
    }
    return { next };
  }

  function parseKey(key) {
    const m = /^(\d+)([+−×÷])(\d+)$/.exec(key);
    if (!m) return null;
    const op = { "+": "add", "−": "subtract", "×": "multiply", "÷": "divide" }[m[2]];
    const p = mk(op, +m[1], +m[3]);
    return Number.isInteger(p.answer) && p.answer >= 0 ? p : null;
  }

  window.OMM = window.OMM || {};
  window.OMM.Problems = { OPS, LEVELS, createSource, parseKey, _factSet: factSet, _random: randomRangeProblem };
})();

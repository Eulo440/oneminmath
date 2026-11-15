// Hall of Fame: Supabase via its REST API (no extra library needed).
// Reads are public; writes go only through the submit_score() database function.
(function () {
  "use strict";
  const cfg = window.OMM_CONFIG || {};
  const url = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
  const key = cfg.SUPABASE_ANON_KEY || "";
  const configured = /^https:\/\/.+/.test(url) && !/YOUR-PROJECT-REF/.test(url) && key && !/YOUR-SUPABASE/.test(key);

  // Must match the word lists in supabase.sql
  const ADJ = ["Brave","Bright","Calm","Clever","Cosmic","Curious","Daring","Eager","Fast","Friendly","Gentle","Happy","Jolly","Keen","Kind","Lucky","Merry","Mighty","Nimble","Noble","Plucky","Polite","Quick","Quiet","Rapid","Sharp","Smart","Snappy","Speedy","Steady","Sunny","Swift","Witty","Zippy"];
  const ANIMALS = ["Badger","Bear","Beaver","Bison","Cat","Cheetah","Crane","Deer","Dolphin","Eagle","Falcon","Fox","Frog","Gecko","Hawk","Heron","Koala","Lemur","Lion","Llama","Lynx","Moose","Otter","Owl","Panda","Penguin","Puffin","Rabbit","Raven","Robin","Seal","Tiger","Turtle","Whale","Wolf","Yak","Zebra"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const randomNickname = () => `${pick(ADJ)} ${pick(ANIMALS)}`;

  // New-style publishable keys (sb_publishable_…) are not JWTs, so send them only in the apikey header.
  // Legacy JWT anon keys (eyJ…) also work with an Authorization header.
  const headers = () => (key.startsWith("eyJ")
    ? { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
    : { apikey: key, "Content-Type": "application/json" });

  async function withTimeout(p, ms = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await p(ctrl.signal); } finally { clearTimeout(t); }
  }

  const Scores = {
    configured,
    randomNickname,
    async top(mode, level, limit = 10) {
      if (!configured) throw new Error("offline");
      const q = `${url}/rest/v1/scores?select=nickname,score,legacy,created_at&mode=eq.${encodeURIComponent(mode)}&difficulty=eq.${level}&score=gt.0&order=score.desc,created_at.asc&limit=${limit}`;
      const res = await withTimeout((signal) => fetch(q, { headers: headers(), signal }));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    async submit({ mode, level, score, attempts, durationMs, nickname }) {
      if (!configured) throw new Error("offline");
      const res = await withTimeout((signal) => fetch(`${url}/rest/v1/rpc/submit_score`, {
        method: "POST", headers: headers(), signal,
        body: JSON.stringify({ p_mode: mode, p_difficulty: level, p_score: score, p_attempts: attempts, p_duration_ms: durationMs, p_nickname: nickname })
      }));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    }
  };
  window.OMM = window.OMM || {};
  window.OMM.Scores = Scores;
})();

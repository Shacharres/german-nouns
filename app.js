"use strict";

/* ------------------------------------------------------------------ *
 *  Pure logic (also exported for Node tests)
 * ------------------------------------------------------------------ */
const GENUS_TO_ART = { m: "der", f: "die", n: "das" };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function capFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function splitArticle(s) {
  const m = String(s).trim().match(/^(der|die|das)\s+(.+)$/i);
  return m ? { art: m[1].toLowerCase(), noun: m[2].trim() } : { art: null, noun: String(s).trim() };
}

// ["die Tasse","Tassen","☕","cup", photoTitle?]  ->  word object (or null if incomplete)
function buildWord(sg, pl, emoji, english, photo) {
  const { art, noun } = splitArticle(sg || "");
  if (!art || !noun || !pl) return null;
  const plurals = String(pl).split("/").map(p => p.trim().replace(/^die\s+/i, "")).filter(Boolean);
  if (!plurals.length) return null;
  return { key: art + " " + noun, art, noun, plurals, emoji: emoji || "", english: english || "", photo: photo || noun };
}

// Treat ä/ö/ü/ß and ae/oe/ue/ss as equal (handy on phone keyboards), ignore case.
function fold(s) {
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

function cmpWord(user, target) {
  user = user.trim().replace(/\s+/g, " ");
  const ok = user !== "" && fold(user) === fold(target);
  const capHint = ok && user[0] !== user[0].toUpperCase();
  return { ok, capHint, user };
}

// Character diff (LCS, case-insensitive). Returns HTML for the user's text and for the target.
function diffHtml(user, target) {
  const a = [...user], b = [...target];
  const al = a.map(c => c.toLowerCase()), bl = b.map(c => c.toLowerCase());
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const aKeep = new Array(n).fill(false), bKeep = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) { aKeep[i] = bKeep[j] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return {
    lcs: dp[0][0],
    user: a.map((c, k) => aKeep[k] ? esc(c) : `<span class="x">${esc(c)}</span>`).join(""),
    target: b.map((c, k) => bKeep[k] ? esc(c) : `<span class="m">${esc(c)}</span>`).join("")
  };
}

function bestPlural(user, plurals) {
  let best = plurals[0], score = -1;
  for (const p of plurals) {
    const s = diffHtml(user, p).lcs;
    if (s > score) { score = s; best = p; }
  }
  return best;
}

function evaluate(w, sgInput, plInput, requireArticle) {
  const sg = splitArticle(sgInput);
  let artOk;
  if (sg.art) artOk = sg.art === w.art;
  else artOk = !requireArticle;
  const noun = cmpWord(sg.noun, w.noun);

  const plUser = String(plInput).trim().replace(/^die\s+/i, "");
  let plOk = false, plCap = false;
  for (const p of w.plurals) {
    const c = cmpWord(plUser, p);
    if (c.ok) { plOk = true; plCap = c.capHint; break; }
  }
  return {
    sg, artOk, nounOk: noun.ok, nounCap: noun.capHint,
    plUser, plOk, plCap,
    allOk: artOk && noun.ok && plOk
  };
}

// Wiktionary wikitext -> { genus, plurals[], english[] }  (German section only)
function parseWiktionary(text, noun) {
  if (!text) return null;
  let sec = text;
  const start = text.search(/^==[^=\n]*\{\{Sprache\|Deutsch\}\}[^\n]*==\s*$/m);
  if (start >= 0) {
    sec = text.slice(start);
    const next = sec.slice(5).search(/^==[^=]/m);
    if (next >= 0) sec = sec.slice(0, next + 5);
  }
  const block = sec.match(/\{\{Deutsch Substantiv Übersicht[\s\S]*?\n\}\}/);
  if (!block) return null;
  const g = block[0].match(/\|\s*Genus(?:\s*1)?\s*=\s*([mfn])/);
  const plurals = [];
  const re = /\|\s*Nominativ Plural(?:\s*\d)?\s*=\s*([^\n|}]*)/g;
  let m;
  while ((m = re.exec(block[0]))) {
    const v = m[1].trim();
    if (v && v !== "—" && v !== "-" && !plurals.includes(v)) plurals.push(v);
  }
  const english = [];
  const reEn = /\{\{Ü\|en\|([^}|]+)/g;
  while ((m = reEn.exec(sec)) && english.length < 2) {
    const v = m[1].trim();
    if (v && !english.includes(v)) english.push(v);
  }
  return { genus: g ? g[1] : null, plurals, english };
}

function parseCustom(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/[;|\t]/.test(line)) {
      const f = line.split(/[;|\t]/).map(x => x.trim());
      out.push({ sg: f[0], pl: f[1] || "", emoji: f[2] || "", english: f[3] || "", photo: f[4] || "" });
    } else {
      for (const part of line.split(",")) {
        const p = part.trim();
        if (p) out.push({ sg: p, pl: "", emoji: "", english: "", photo: "" });
      }
    }
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { splitArticle, buildWord, fold, cmpWord, diffHtml, evaluate, parseWiktionary, parseCustom, bestPlural };
}

/* ------------------------------------------------------------------ *
 *  Browser app
 * ------------------------------------------------------------------ */
if (typeof document !== "undefined") (function () {
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };

  const settings = Object.assign({ english: true, photos: false, reqArt: true, source: "both" }, store.get("settings", {}));
  const state = { words: [], cur: null, phase: "ask", session: { n: 0, ok: 0, streak: 0 }, lastInput: null, picToken: 0, attempts: 0 };

  /* ---------- word list ---------- */
  function builtinWords() {
    return BUILTIN_WORDS.map(r => buildWord(r[0], r[1], r[2], r[3], r[4])).filter(Boolean);
  }

  // Words come from my-words.txt (committed to the repo) plus whatever was typed into the settings box on this device.
  let fileText = "";
  function customEntries() {
    return parseCustom(fileText + "\n" + store.get("customText", ""));
  }

  // Combine custom entries with cached Wiktionary lookups. Returns {words, problems}
  function customWords() {
    const cache = store.get("wikt", {});
    const words = [], problems = [];
    for (const e of customEntries()) {
      const { art, noun } = splitArticle(e.sg);
      const info = cache[capFirst(noun)];
      const article = art || (info && info.genus && GENUS_TO_ART[info.genus]);
      const plural = e.pl || (info && info.plurals && info.plurals.join("/"));
      const english = e.english || (info && info.english && info.english.join(" / ")) || "";
      const w = buildWord(`${article || ""} ${capFirst(noun)}`.trim(), plural, e.emoji, english, e.photo || capFirst(noun));
      if (w) words.push(w); else problems.push(e.sg);
    }
    return { words, problems };
  }

  function rebuildWords() {
    const c = customWords();
    let list;
    if (settings.source === "builtin") list = builtinWords();
    else if (settings.source === "custom") list = c.words.length ? c.words : builtinWords();
    else list = builtinWords().concat(c.words);
    const seen = new Set();
    state.words = list.filter(w => !seen.has(w.key) && seen.add(w.key));
    return c;
  }

  async function fetchWiktionary(noun) {
    const url = "https://de.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main" +
      "&format=json&formatversion=2&origin=*&redirects=1&titles=" + encodeURIComponent(noun);
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const text = j.query && j.query.pages && j.query.pages[0] && j.query.pages[0].revisions &&
      j.query.pages[0].revisions[0].slots.main.content;
    return parseWiktionary(text, noun) || { miss: true };
  }

  async function syncCustom() {
    const status = $("#customStatus");
    const cache = store.get("wikt", {});
    const todo = [];
    for (const e of customEntries()) {
      const noun = capFirst(splitArticle(e.sg).noun);
      const needs = !e.pl || !e.english || !splitArticle(e.sg).art;
      if (needs && noun && cache[noun] === undefined && !todo.includes(noun)) todo.push(noun);
    }
    let done = 0, failed = false;
    for (const noun of todo) {
      status.textContent = `Looking up ${noun} … (${done + 1}/${todo.length})`;
      try { cache[noun] = await fetchWiktionary(noun); store.set("wikt", cache); }
      catch { failed = true; }
      done++;
    }
    const c = rebuildWords();
    const bits = [`${state.words.length} words in rotation.`];
    if (c.problems.length) bits.push(`Could not find a plural for: ${c.problems.join(", ")} — add it yourself like “die Tasse; Tassen”.`);
    if (failed) bits.push("Some lookups failed (offline?). Press Save again when online.");
    status.textContent = bits.join(" ");
    if (!state.cur) nextWord();
  }

  /* ---------- picking ---------- */
  function pickNext() {
    const prog = store.get("prog", {});
    const pool = state.words;
    if (!pool.length) return null;
    const cands = pool.length > 1 && state.cur ? pool.filter(w => w.key !== state.cur.key) : pool;
    const weights = cands.map(w => {
      const p = prog[w.key];
      if (!p) return 1.5;                       // unseen words come up a bit more
      return Math.pow(0.55, p.s || 0) + 0.04;   // mastered words fade, mistakes return quickly
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  /* ---------- picture ---------- */
  const photoCache = store.get("photos", {});
  async function wikiPhoto(title) {
    if (photoCache[title] !== undefined) return photoCache[title];
    const url = "https://de.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1" +
      "&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=" + encodeURIComponent(title);
    const r = await fetch(url);
    const j = await r.json();
    const p = j.query && j.query.pages && j.query.pages[0];
    const src = (p && p.thumbnail && p.thumbnail.source) || "";
    photoCache[title] = src;
    store.set("photos", photoCache);
    return src;
  }

  function showPicture(w) {
    const pic = $("#pic");
    const token = ++state.picToken;
    const emojiHtml = () => w.emoji ? esc(w.emoji) : `<span class="none">(no picture)</span>`;
    if (!settings.photos && w.emoji) { pic.innerHTML = emojiHtml(); return; }
    pic.innerHTML = w.emoji && settings.photos ? emojiHtml() : `<span class="none">loading picture …</span>`;
    wikiPhoto(w.photo).then(src => {
      if (token !== state.picToken) return;
      if (!src) { pic.innerHTML = emojiHtml(); return; }
      const img = new Image();
      img.alt = "";
      img.onload = () => { if (token === state.picToken) { pic.innerHTML = ""; pic.appendChild(img); } };
      img.onerror = () => { if (token === state.picToken) pic.innerHTML = emojiHtml(); };
      img.src = src;
    }).catch(() => { if (token === state.picToken) pic.innerHTML = emojiHtml(); });
  }

  /* ---------- flow ---------- */
  function nextWord() {
    const w = pickNext();
    state.cur = w;
    state.phase = "ask";
    state.attempts = 0;
    $("#result").hidden = true;
    $("#next").hidden = true;
    $("#check").disabled = false;
    $("#check").textContent = "Check";
    $("#skip").disabled = false;
    $("#skip").hidden = false;
    $("#sg").value = "";
    $("#pl").value = "";
    if (!w) { $("#pic").textContent = "Add some words below."; $("#english").textContent = ""; return; }
    showPicture(w);
    $("#english").textContent = settings.english ? w.english : "";
    $("#sg").placeholder = settings.reqArt ? "e.g. die Tasse" : "e.g. Tasse";
    $("#sg").focus({ preventScroll: true });
    renderStats();
  }

  // "Give up & next" after a wrong attempt, or plain "Next" once the word is settled.
  function onNext() {
    if (state.phase === "ask" && state.cur) settle(state.cur, 0);
    nextWord();
  }

  function artSpan(art, text) { return `<span class="art-${art}">${esc(text)}</span>`; }

  // Record the final result for a word once: 1 point first try, 0.5 after a retry, 0 if given up.
  function settle(w, points) {
    state.phase = "checked";
    const s = state.session;
    s.n++; s.ok += points;
    if (points === 1) s.streak++; else s.streak = 0;
    const prog = store.get("prog", {});
    const p = prog[w.key] || { s: 0, c: 0, w: 0 };
    if (points === 1) { p.s++; p.c++; }
    else if (points === 0.5) { p.c += 0.5; }          // needed a retry: not mastered yet, but not forgotten
    else { p.s = 0; p.w++; }
    prog[w.key] = p;
    store.set("prog", prog);
    const tot = store.get("totals", { n: 0, ok: 0 });
    tot.n++; tot.ok += points;
    store.set("totals", tot);
    renderStats();
  }

  // status: "first" | "retry" | "wrong" | "skipped"
  function renderResult(w, ev, status) {
    const good = status === "first" || status === "retry";
    const plShown = w.plurals.map(x => esc(x)).join(" / ");
    let html = `<div class="answer ${good ? "ok" : "bad"}">${artSpan(w.art, w.art)} ${esc(w.noun)}<span class="sep">→</span>${artSpan("die", "die")} ${plShown}</div>`;
    if (status === "first") html += `<div class="pts ok">+1 point</div>`;
    else if (status === "retry") html += `<div class="pts ok">+½ point (correct on retry)</div>`;
    else if (status === "wrong") html += `<div class="pts">Fix it and press <b>Check again</b> — ½ point if you get it right. Or give up and move on.</div>`;

    if (ev) {
      // singular
      if (ev.artOk && ev.nounOk) {
        html += `<div class="fb ok"><span class="tag">Singular ✓</span>${ev.nounCap ? ` <span class="note">(nouns are capitalised: ${esc(w.noun)})</span>` : ""}</div>`;
      } else {
        let msg = "";
        if (!ev.artOk) {
          msg += ev.sg.art
            ? `Gender: it is <b>${artSpan(w.art, w.art)}</b>, not ${esc(ev.sg.art)}. `
            : `Don't forget the article — it is <b>${artSpan(w.art, w.art)}</b>. `;
        }
        if (!ev.nounOk) {
          const d = diffHtml(ev.sg.noun, w.noun);
          msg += `<div class="you">You wrote: ${d.user || "<i>nothing</i>"}</div><div class="corr">Correct: ${d.target}</div>`;
        }
        html += `<div class="fb bad"><span class="tag">Singular ✗</span> ${msg}</div>`;
      }
      // plural
      if (ev.plOk) {
        html += `<div class="fb ok"><span class="tag">Plural ✓</span>${ev.plCap ? ` <span class="note">(capitalise the noun)</span>` : ""}</div>`;
      } else {
        const target = bestPlural(ev.plUser, w.plurals);
        const d = diffHtml(ev.plUser, target);
        html += `<div class="fb bad"><span class="tag">Plural ✗</span><div class="you">You wrote: ${d.user || "<i>nothing</i>"}</div><div class="corr">Correct: ${d.target}</div></div>`;
      }
    }
    const result = $("#result");
    result.innerHTML = html;
    result.hidden = false;
  }

  function lockWord() {
    $("#check").disabled = true;
    $("#skip").disabled = true;
    $("#next").textContent = "Next →";
    $("#next").hidden = false;
    $("#next").focus({ preventScroll: true });
  }

  function check(skipped) {
    if (state.phase !== "ask" || !state.cur) return;
    const w = state.cur;
    if (skipped) { settle(w, 0); renderResult(w, null, "skipped"); lockWord(); return; }

    const ev = evaluate(w, $("#sg").value, $("#pl").value, settings.reqArt);
    state.attempts++;
    if (ev.allOk) {
      const pts = state.attempts === 1 ? 1 : 0.5;
      settle(w, pts);
      renderResult(w, ev, pts === 1 ? "first" : "retry");
      lockWord();
    } else {
      renderResult(w, ev, "wrong");
      $("#check").textContent = "Check again";
      $("#skip").hidden = true;
      $("#next").textContent = "Give up → next";
      $("#next").hidden = false;
      const el = (ev.artOk && ev.nounOk) ? $("#pl") : $("#sg");   // jump to the field that needs fixing
      el.focus({ preventScroll: true });
      el.select();
    }
  }

  function renderStats() {
    const fmt = n => String(Math.round(n * 2) / 2);
    const s = state.session, t = store.get("totals", { n: 0, ok: 0 });
    const pct = t.n ? Math.round(100 * t.ok / t.n) : 0;
    $("#stats").textContent = `Session ${fmt(s.ok)}/${s.n} · 🔥 ${s.streak} · All-time ${pct}% (${t.n})`;
  }

  /* ---------- wiring ---------- */
  $("#form").addEventListener("submit", e => { e.preventDefault(); check(false); });
  $("#skip").addEventListener("click", () => check(true));
  $("#next").addEventListener("click", onNext);

  $("#sg").addEventListener("keydown", e => {
    if (e.key === "Enter" && state.phase === "ask") { e.preventDefault(); $("#pl").focus(); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.repeat && state.phase === "checked" && !(e.target instanceof HTMLButtonElement) &&
        !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault(); nextWord();
    }
  });
  for (const id of ["#sg", "#pl"]) $(id).addEventListener("focus", e => { state.lastInput = e.target; });

  // special characters: don't steal focus (keeps the phone keyboard open)
  document.querySelectorAll("#chars button").forEach(b => {
    const insert = e => {
      e.preventDefault();
      const el = state.lastInput || $("#sg");
      const s = el.selectionStart == null ? el.value.length : el.selectionStart;
      const en = el.selectionEnd == null ? s : el.selectionEnd;
      el.setRangeText(b.dataset.ch, s, en, "end");
      el.focus({ preventScroll: true });
    };
    b.addEventListener("pointerdown", insert);
    b.addEventListener("mousedown", e => e.preventDefault());
    b.addEventListener("click", e => e.preventDefault());
  });

  // settings
  const bindCheck = (sel, key, after) => {
    const el = $(sel); el.checked = !!settings[key];
    el.addEventListener("change", () => { settings[key] = el.checked; store.set("settings", settings); if (after) after(); });
  };
  bindCheck("#optEnglish", "english", () => { $("#english").textContent = settings.english && state.cur ? state.cur.english : ""; });
  bindCheck("#optPhotos", "photos", () => { if (state.cur) showPicture(state.cur); });
  bindCheck("#optArticle", "reqArt", () => { $("#sg").placeholder = settings.reqArt ? "e.g. die Tasse" : "e.g. Tasse"; });
  $("#optSource").value = settings.source;
  $("#optSource").addEventListener("change", e => {
    settings.source = e.target.value; store.set("settings", settings); rebuildWords(); nextWord();
  });
  $("#custom").value = store.get("customText", "");
  $("#saveCustom").addEventListener("click", () => {
    store.set("customText", $("#custom").value);
    syncCustom();
  });
  $("#resetProg").addEventListener("click", () => {
    if (confirm("Reset all progress and statistics?")) {
      store.set("prog", {}); store.set("totals", { n: 0, ok: 0 });
      state.session = { n: 0, ok: 0, streak: 0 }; renderStats();
    }
  });

  /* ---------- start ---------- */
  rebuildWords();
  nextWord();
  fetch("my-words.txt", { cache: "no-cache" })
    .then(r => r.ok ? r.text() : "")
    .catch(() => "")
    .then(t => { fileText = t; rebuildWords(); if (!state.cur || state.phase === "ask" && !$("#sg").value) nextWord(); syncCustom(); });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();

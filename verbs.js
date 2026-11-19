"use strict";

/* ------------------------------------------------------------------ *
 *  German verb conjugation: Wiktionary parsing + derivation of the
 *  forms Wiktionary doesn't list (wir/ihr/sie/Sie, Präteritum persons,
 *  Perfekt) + a regular-verb fallback for when the lookup is offline.
 * ------------------------------------------------------------------ */

const VERB_PERSONS = [
  { key: "ich", label: "ich" },
  { key: "du", label: "du" },
  { key: "er", label: "er / sie / es" },
  { key: "wir", label: "wir" },
  { key: "ihr", label: "ihr" },
  { key: "sie", label: "sie (plural)" },
  { key: "Sie", label: "Sie (formal)" }
];
const VERB_TENSES = [
  { key: "pres", label: "Präsens" },
  { key: "pret", label: "Präteritum" },
  { key: "perf", label: "Perfekt" }
];
const REFLEXIVE = { ich: "mich", du: "dich", er: "sich", wir: "uns", ihr: "euch", sie: "sich", Sie: "sich" };
const AUX_FORMS = {
  haben: { ich: "habe", du: "hast", er: "hat", wir: "haben", ihr: "habt", sie: "haben", Sie: "haben" },
  sein: { ich: "bin", du: "bist", er: "ist", wir: "sind", ihr: "seid", sie: "sind", Sie: "sind" }
};

function uniq(arr) { return arr.filter((x, i) => arr.indexOf(x) === i); }

function cleanWikiValue(v) {
  return v.replace(/<[^>]*>/g, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/'''?/g, "").trim();
}

// "stehe auf" -> {fin:"stehe", part:"auf"};  "gehe" -> {fin:"gehe", part:""}
function splitFin(form) {
  const t = form.trim().split(/\s+/);
  return { fin: t[0], part: t.slice(1).join(" ") };
}

// Wiktionary wikitext -> raw verb data, or null when the page has no German verb table.
function parseVerbWiktionary(text) {
  if (!text) return null;
  let sec = text;
  const start = text.search(/^==[^=\n]*\{\{Sprache\|Deutsch\}\}[^\n]*==\s*$/m);
  if (start >= 0) {
    sec = text.slice(start);
    const next = sec.slice(5).search(/^==[^=]/m);
    if (next >= 0) sec = sec.slice(0, next + 5);
  }
  const block = sec.match(/\{\{Deutsch Verb Übersicht[\s\S]*?\n\}\}/);
  if (!block) return null;

  const params = {};
  const re = /^\s*\|\s*([^=|\n]+?)\s*=\s*([^\n]*)$/gm;
  let m;
  while ((m = re.exec(block[0]))) {
    const name = m[1].replace(/\*+$/, "").trim();      // Präsens_ich, Präsens_ich*, Präsens_ich** = alternatives
    const val = cleanWikiValue(m[2]);
    if (!val || /^[—–-]+$/.test(val)) continue;
    (params[name] = params[name] || []).push(val);
  }
  const get = k => uniq(params[k] || []);
  const info = {
    pres: { ich: get("Präsens_ich"), du: get("Präsens_du"), er: get("Präsens_er, sie, es") },
    pret: get("Präteritum_ich"),
    pp: get("Partizip II"),
    impPl: get("Imperativ Plural").map(s => s.replace(/[!.,;]/g, "")),
    aux: get("Hilfsverb").map(s => s.toLowerCase()).filter(a => AUX_FORMS[a])
  };
  if (!info.pres.ich.length) return null;
  return info;
}

/* ---------- derivation rules ---------- */

// Does the present stem need an "e" before -st/-t/-te? (arbeiten, finden, atmen, öffnen, rechnen; not lernen, wohnen)
function needsE(stem) {
  if (/[td]$/.test(stem)) return true;
  if (/[aeiouäöüy]h[mn]$/.test(stem)) return false;       // lengthening h: wohnen -> wohnst
  return /[^aeiouäöüylrmn][mn]$/.test(stem);
}

function derivePret(ich, pers) {
  switch (pers) {
    case "ich": case "er": return ich;
    case "du":
      if (/[sßxz]$/.test(ich)) return ich + "t";            // du aßt, du ließt
      if (/[td]$/.test(ich)) return ich + "est";            // du fandest
      return ich + "st";
    case "wir": case "sie": case "Sie": return /e$/.test(ich) ? ich + "n" : ich + "en";
    case "ihr": return /[td]$/.test(ich) ? ich + "et" : ich + "t";
  }
}

// regular ihr-form from the infinitive (used when Wiktionary has no usable imperative plural)
function ruleIhr(infFin) {
  const stem = infFin.replace(/e?n$/, "");
  return stem + (needsE(stem) ? "et" : "t");
}

// Regular-verb guess for offline use. Only -en verbs. Returns data in the same shape as parseVerbWiktionary.
function regularVerbData(inf) {
  if (!/^[a-zäöüß]+en$/.test(inf) || inf.length < 4) return null;
  const stem = inf.slice(0, -2), ins = needsE(stem);
  const du = /[sßxz]$/.test(stem) ? stem + "t" : stem + (ins ? "est" : "st");
  const er = stem + (ins ? "et" : "t");
  const noGe = /^(be|emp|ent|er|ge|miss|ver|zer)/.test(inf) || /ieren$/.test(inf);
  return {
    pres: { ich: [stem + "e"], du: [du], er: [er] },
    pret: [stem + (ins ? "ete" : "te")],
    pp: [(noGe ? "" : "ge") + stem + (ins ? "et" : "t")],
    impPl: [er],
    aux: ["haben"]
  };
}

/* ---------- build every form ---------- */

function compose(pers, fin, part, reflexive) {
  return [fin, reflexive ? REFLEXIVE[pers] : "", part].filter(Boolean).join(" ");
}

// info: parseVerbWiktionary() / regularVerbData() result; inf: infinitive (lowercase, without "sich")
function conjugate(info, inf, reflexive) {
  const out = { pres: {}, pret: {}, perf: {}, aux: info.aux.length ? info.aux : ["haben"], pp: info.pp };
  const ichVars = info.pres.ich.map(splitFin);
  const part = ichVars.length ? ichVars[0].part : "";

  // infinitive as finite verb (wir / sie / Sie): strip the separable prefix, sein -> sind
  let infFin = part && inf.startsWith(part) ? inf.slice(part.length) : inf;
  if (infFin === "sein") infFin = "sind";

  // Präsens
  const presVars = {
    ich: ichVars,
    du: info.pres.du.map(splitFin),
    er: info.pres.er.map(splitFin),
    wir: [{ fin: infFin, part }],
    sie: [{ fin: infFin, part }],
    Sie: [{ fin: infFin, part }]
  };
  const ihr = info.impPl.length ? info.impPl.map(splitFin) : [{ fin: ruleIhr(infFin), part }];
  presVars.ihr = ihr;
  for (const p of VERB_PERSONS) {
    const vars = presVars[p.key];
    out.pres[p.key] = vars.length ? uniq(vars.map(v => compose(p.key, v.fin, v.part, reflexive))).join(" / ") : "—";
  }

  // Präteritum (derived from the ich-form)
  const pretVars = info.pret.map(splitFin);
  for (const p of VERB_PERSONS) {
    out.pret[p.key] = pretVars.length
      ? uniq(pretVars.map(v => compose(p.key, derivePret(v.fin, p.key), v.part, reflexive))).join(" / ")
      : "—";
  }

  // Perfekt: Hilfsverb + Partizip II
  for (const p of VERB_PERSONS) {
    const forms = [];
    for (const aux of out.aux) for (const pp of info.pp) {
      forms.push([AUX_FORMS[aux][p.key], reflexive ? REFLEXIVE[p.key] : "", pp].filter(Boolean).join(" "));
    }
    out.perf[p.key] = forms.length ? uniq(forms).join(" / ") : "—";
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { VERB_PERSONS, VERB_TENSES, parseVerbWiktionary, regularVerbData, conjugate, derivePret, needsE, splitFin };
}

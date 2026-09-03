#!/usr/bin/env node
/* =============================================================
   SO:LIVE — AI genre/type classification pass
   Run AFTER build-events.mjs. Finds events whose genre came from
   the keyword fallback (no keyword hit, no override), asks Claude
   to classify them from artist knowledge, appends results to
   genre-overrides.json, then patches events.json and the snapshot
   bundled in index.html so the fix ships immediately.

   Requires: ANTHROPIC_API_KEY in env. Without it, exits cleanly —
   the seeded override cache still applies via the builder.
   ============================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.ANTHROPIC_API_KEY;
const EVENTS = new URL('./events.json', import.meta.url).pathname;
const OVR = new URL('./genre-overrides.json', import.meta.url).pathname;
const INDEX = new URL('./index.html', import.meta.url).pathname;

const GENRES = ['indie', 'electronic', 'jazz', 'punk', 'hiphop', 'acoustic', 'other'];
const TYPES = ['gig', 'club', 'comedy', 'other'];

// Same keyword vocabulary the builder trusts; anything that matched one of
// these is considered confidently classified and is NOT re-checked.
const CONFIDENT = /\b(punk|hardcore|emo|metal|ska|grunge|dnb|d&b|drum\s*(&|and|n)\s*bass|jungle|garage|house|techno|trance|dubstep|rave|disco|dj|club\s*night|jazz|funk|soul|blues|reggae|dub|hip\s*hop|rap|drill|grime|r&b|rnb|folk|acoustic|unplugged|singer[-\s]?songwriter|comedy|comedian|stand[-\s]?up|quiz|bingo|drag|karaoke|spoken\s*word|indie|rock)\b/i;

const feed = JSON.parse(readFileSync(EVENTS, 'utf8'));
const cache = existsSync(OVR)
  ? JSON.parse(readFileSync(OVR, 'utf8'))
  : { note: 'AI knowledge layer', overrides: [] };

const covered = (name) => cache.overrides.some((o) => name.toLowerCase().includes(o.match));

// Unknowns: keyword layer had nothing to go on AND no cached knowledge.
const unknowns = [];
const seen = new Set();
for (const e of feed.events) {
  const hay = `${e.artist} ${e.desc || ''}`;
  const k = e.artist.toLowerCase().trim();
  if (seen.has(k) || covered(e.artist) || CONFIDENT.test(hay) || e.type === 'club' || (e.tags || []).length) continue;
  seen.add(k);
  unknowns.push({ artist: e.artist, desc: (e.desc || '').slice(0, 140), venue: e.venueName });
}

if (!unknowns.length) {
  console.log('classify: nothing unknown — cache and keywords cover the full feed');
  process.exit(0);
}
if (!KEY) {
  console.log(`classify: ${unknowns.length} unknown artist(s) but no ANTHROPIC_API_KEY set — skipping (seeded cache still applies):`);
  unknowns.slice(0, 10).forEach((u) => console.log('  ·', u.artist));
  process.exit(0);
}

console.log(`classify: asking Claude about ${unknowns.length} unknown artist(s)…`);
const prompt = `You are classifying live events in Southampton UK for a gig guide. For EACH event, use your knowledge of the artist to assign:
- "genre": one of ${JSON.stringify(GENRES)} (indie = indie/rock/pop, electronic = dance/DnB/club, jazz = jazz/funk/soul/reggae/ska, punk = punk/metal/hardcore, hiphop = hip-hop/rap/R&B, acoustic = folk/acoustic/country, other = comedy/spoken word/misc)
- "type": one of ${JSON.stringify(TYPES)} (gig = live music, club = DJ/club night, comedy = stand-up, other = quiz/drag/spoken word/misc)
- "match": a short distinctive lowercase substring of the event name to key the rule (e.g. the artist name)
Respond ONLY with a JSON array, no prose: [{"match":"...","genre":"...","type":"..."}]
Events:
${unknowns.map((u, i) => `${i + 1}. "${u.artist}" at ${u.venue}${u.desc ? ` — ${u.desc}` : ''}`).join('\n')}`;

const resp = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  }),
});
if (!resp.ok) { console.error('classify: API error', resp.status, (await resp.text()).slice(0, 200)); process.exit(1); }
const data = await resp.json();
const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
let rules;
try { rules = JSON.parse(text.replace(/```json|```/g, '').trim()); }
catch (e) { console.error('classify: unparseable response'); process.exit(1); }

let added = 0;
for (const r of rules) {
  if (!r || !r.match || !GENRES.includes(r.genre) || !TYPES.includes(r.type)) continue;
  const m = String(r.match).toLowerCase().slice(0, 60);
  if (cache.overrides.some((o) => o.match === m)) continue;
  cache.overrides.push({ match: m, genre: r.genre, type: r.type, via: 'claude-haiku-4-5' });
  added++;
}
writeFileSync(OVR, JSON.stringify(cache, null, 2));
console.log(`classify: added ${added} rule(s) to genre-overrides.json`);

// Apply to the freshly built feed + bundled snapshot immediately
let patched = 0;
for (const e of feed.events) {
  const hay = e.artist.toLowerCase();
  for (const o of cache.overrides) {
    if (hay.includes(o.match)) {
      if (o.genre && e.genre !== o.genre) { e.genre = o.genre; patched++; }
      if (o.type && e.type !== o.type) { e.type = o.type; patched++; }
      break;
    }
  }
}
writeFileSync(EVENTS, JSON.stringify(feed, null, 1));
if (existsSync(INDEX)) {
  const html = readFileSync(INDEX, 'utf8');
  const payload = JSON.stringify(feed).replace(/<\//g, '<\\/');
  const updated = html.replace(
    /(<script id="feedSnapshot" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_, a, b) => a + payload + b
  );
  writeFileSync(INDEX, updated);
}
console.log(`classify: patched ${patched} field(s) in events.json + snapshot`);

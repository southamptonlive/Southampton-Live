#!/usr/bin/env node
/* =============================================================
   SOUTHAMPTON.LIVE — AI genre/type classification pass
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

// The app's 34-key vocabulary (see GENRES in index.html). Up to 3 per event.
const GENRES = ['rock','indie','metal','emo-alt','punk','electronic','dance','dnb','house','techno','trance','jungle','jazz','blues','funk','soul','reggae','dub','ska','hip-hop','grime','drill','trap','rnb','disco','country','folk-acoustic','world','afrobeat','salsa','latin','comedy','theatre','other'];
const TYPES = ['gig', 'club', 'comedy', 'theatre', 'other'];
const LEGACY = { hiphop: 'hip-hop', acoustic: 'folk-acoustic', folk: 'folk-acoustic', rap: 'hip-hop' };
const normG = (arr) => [...new Set((Array.isArray(arr) ? arr : [arr]).map((g) => LEGACY[String(g || '').toLowerCase()] || String(g || '').toLowerCase()).filter((g) => GENRES.includes(g)))].slice(0, 3);

// The builder marks events it could only place by fallback with genreGuess:true;
// those are the ones worth asking about.

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
  if (seen.has(k) || covered(e.artist) || !e.genreGuess || e.type !== 'gig') continue;
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
- "genres": 1 to 3 keys from ${JSON.stringify(GENRES)}, most specific first (e.g. a metal band is ["metal"], not ["rock"]; a tribute act takes the genre of the act it tributes)
- "type": one of ${JSON.stringify(TYPES)} (gig = live music, club = DJ/club night, comedy = stand-up, theatre = musical/play/panto, other = quiz/drag/spoken word/misc)
- "match": a short distinctive lowercase substring of the event name to key the rule (e.g. the artist name)
If you genuinely do not know the artist, OMIT it — never guess. This guide never invents data.
Respond ONLY with a JSON array, no prose: [{"match":"...","genres":["..."],"type":"..."}]
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
  const gs = normG(r && (r.genres || r.genre));
  if (!r || !r.match || !gs.length || !TYPES.includes(r.type)) continue;
  const m = String(r.match).toLowerCase().slice(0, 60);
  if (m.length < 4 || cache.overrides.some((o) => o.match === m)) continue;
  cache.overrides.push({ match: m, genres: gs, type: r.type, via: 'claude-haiku-4-5' });
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
      const gs = normG(o.genres || o.genre);
      if (gs.length && JSON.stringify(gs) !== JSON.stringify(e.genres)) { e.genres = gs; e.genre = gs[0]; delete e.genreGuess; patched++; }
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

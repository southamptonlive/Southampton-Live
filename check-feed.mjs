#!/usr/bin/env node
/* =============================================================
   SOUTHAMPTON.LIVE — feed checks. Runs in CI after the build; a
   failure stops the deploy so a bad feed can never go live.

   NO-FICTION: nothing invented, nothing we are not allowed to show.
   SHAPE:      every event has what the app needs.
   LINKS:      one real event page per source actually renders
               (catches "200 but Not Found" like the Fatsoma URLs).
   ============================================================= */
import { readFileSync } from 'node:fs';

const feed = JSON.parse(readFileSync(new URL('./events.json', import.meta.url), 'utf8'));
const ev = feed.events || [];
const GEN = new Set(['rock','indie','metal','emo-alt','punk','electronic','dance','dnb','house','techno','trance','jungle','jazz','blues','funk','soul','reggae','dub','ska','hip-hop','grime','drill','trap','rnb','disco','country','folk-acoustic','world','afrobeat','salsa','latin','comedy','theatre','other']);
const TYPES = new Set(['gig', 'club', 'comedy', 'theatre', 'other']);
const STRIP = new Set(['songkick', 'fatsoma']);           // no licence: facts only
const today = new Date(); const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const fails = [], warns = [];
const fail = (m) => fails.push(m);

// ---- hard checks ----
if (ev.length < 200) fail(`only ${ev.length} events — a source collapse? (expect 800+)`);
const ids = new Set();
for (const e of ev) {
  const tag = `${e.id} (${e.artist?.slice(0, 30)})`;
  if (!e.id || ids.has(e.id)) fail(`duplicate/missing id: ${tag}`); ids.add(e.id);
  if (!e.artist || !e.date || !e.venueId) fail(`missing core field: ${tag}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date < TODAY) fail(`bad/past date ${e.date}: ${tag}`);
  if (e.time != null && !/^\d{2}:\d{2}$/.test(e.time)) fail(`bad time ${e.time}: ${tag}`);
  if (e.feeIncluded != null && typeof e.feeIncluded !== 'boolean') fail(`bad feeIncluded: ${tag}`);
  // "Doors" may only be shown where the source said doors: the robot records the source phrase.
  if (e.doors != null && !/^\d{2}:\d{2}$/.test(e.doors)) fail(`bad doors ${e.doors}: ${tag}`);
  if (e.doors != null && !/doors|entry from|doorsopen/i.test(String(e.doorsText || ''))) fail(`doors time without a source phrase saying doors: ${tag}`);
  if (e.doorsText && e.doors == null) fail(`doorsText without doors: ${tag}`);
  if (!TYPES.has(e.type)) fail(`bad type ${e.type}: ${tag}`);
  if (!Array.isArray(e.genres) || !e.genres.length || !e.genres.every((g) => GEN.has(g)) || e.genre !== e.genres[0]) fail(`bad genres ${JSON.stringify(e.genres)}: ${tag}`);
  if (e.price == null && e.priceText != null) fail(`priceText without price (invented?): ${tag}`);
  if (e.price != null && (typeof e.price !== 'number' || e.price < 0)) fail(`bad price ${e.price}: ${tag}`);
  if (STRIP.has(e.source) && ((e.img && e.imgBy !== 'venue') || e.desc)) fail(`media not stripped from ${e.source}: ${tag}`); // venue-set posters are allowed (v11)
  if (e.img && !/^https?:\/\//.test(e.img)) fail(`bad image url: ${tag}`);
  if (e.img && /ticketm\.net\/dam\/c\//.test(e.img)) fail(`Ticketmaster stock category image passed as artwork: ${tag}`);
  if (!e.source) fail(`no source credit: ${tag}`);
  if (e.ticketUrl && !/^https?:\/\//.test(e.ticketUrl)) fail(`bad ticket url: ${tag}`);
  if (e.source === 'fatsoma' && e.ticketUrl && !/fatsoma\.com\/e\/[a-z0-9]{6,10}\//.test(e.ticketUrl)) fail(`Fatsoma url without vanity code (renders Not Found): ${tag}`);
  if (e.type === 'other' && !/\b(karaoke|dj|live\s*music|open\s*mic|acoustic|gig|band|disco|rave)\b/i.test(`${e.artist} ${e.desc || ''}`)) fail(`out-of-scope listing slipped through: ${tag}`);
}
// same-source, same bill, same date+venue+time = a dedupe miss
const seenBill = new Map();
for (const e of ev) {
  const k = `${e.source}|${e.venueId}|${e.date}|${e.time || e.doors}|${String(e.artist).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  if (seenBill.has(k)) fail(`same-source duplicate: ${e.id} vs ${seenBill.get(k)}`); else seenBill.set(k, e.id);
}
// per-source sanity: a source that returned ok but 0 events is suspicious
for (const s of feed.sources || []) if (s.ok && s.events === 0) warns.push(`source ${s.id} ok but 0 events`);

// ---- link check: one real page per source must render as the event, not "Not Found" ----
const UA = 'SouthamptonLive/1.0 (+https://southampton.live; hello@southampton.live)';
const BAD = /not found|page you.re looking for|404|no longer available|event not found/i;
async function probe(e) {
  const url = e.infoUrl || e.ticketUrl; if (!url) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    if (res.status === 403) return `${e.source}: ${url} → 403 (blocked; facts carry, link may still work in a browser)`;
    if (!res.ok) return `${e.source}: ${url} → HTTP ${res.status}`;
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
    if (BAD.test(title)) return `${e.source}: ${url} → title says "${title.trim().slice(0, 60)}"`;
    return null;
  } catch (err) { return `${e.source}: ${url} → ${err.name === 'AbortError' ? 'timeout' : err.message}`; }
}
const bySource = new Map();
for (const e of ev) if (!bySource.has(e.source)) bySource.set(e.source, e);
const linkResults = await Promise.all([...bySource.values()].map(probe));
for (const r of linkResults) if (r) { if (/403|timeout/.test(r)) warns.push(r); else fail(`link check: ${r}`); }

// ---- report ----
for (const w of warns) console.log('warn:', w);
if (fails.length) {
  console.error(`FEED CHECK FAILED — ${fails.length} problem(s):`);
  for (const f of fails.slice(0, 40)) console.error(' ✗', f);
  process.exit(1);
}
console.log(`FEED CHECK OK — ${ev.length} events, ${bySource.size} sources link-checked, ${warns.length} warning(s)`);

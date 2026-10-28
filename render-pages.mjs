#!/usr/bin/env node
/* =============================================================
   SOUTHAMPTON.LIVE — static pages, sitemap and calendar feeds
   Runs AFTER build-events.mjs (and classify-events.mjs) in CI.

   Reads events.json and writes plain-HTML pages a search engine can
   read without JavaScript, plus iCalendar feeds:

     pages/e/<slug>-<id>.html     one per event
     pages/v/<venue>.html          one per venue (upcoming list)
     pages/d/<yyyy-mm-dd>.html     one per day with listings
     pages/tonight.html            today
     pages/this-weekend.html       Fri–Sun (coming weekend Mon–Thu)
     pages/sitemap.xml
     cal/v/<venue>.ics, cal/g/<genre>.ics, cal/all.ics

   Rules (the covenant applies to generated HTML too):
   - unknown = omitted. No "TBC 7pm", no guessed genre, no stock art.
   - images only where the feed has one (i.e. licensed/permitted sources).
   - every page credits and links its source.
   - a page for a gig that has happened stays 30 days with a plain line
     saying so, then goes. A page whose id was replaced by a merge
     redirects to the survivor for 30 days. Nothing silently 404s.
   ============================================================= */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const SITE = 'https://southampton.live';
const PAGES = join(ROOT, 'pages');
const CAL = join(ROOT, 'cal');
const STATE_FILE = join(ROOT, 'pages-state.json');
const KEEP_DAYS = 30;

const feed = JSON.parse(readFileSync(join(ROOT, 'events.json'), 'utf8'));
const GENRES = {
  rock:'Rock', indie:'Indie', metal:'Metal', 'emo-alt':'Emo / Alt', punk:'Punk', electronic:'Electronic', dance:'Dance', dnb:'DnB', house:'House', techno:'Techno', trance:'Trance', jungle:'Jungle', jazz:'Jazz', blues:'Blues', funk:'Funk', soul:'Soul', reggae:'Reggae', dub:'Dub', ska:'Ska', 'hip-hop':'Hip Hop', grime:'Grime', drill:'Drill', trap:'Trap', rnb:'R&B', disco:'Disco', country:'Country', 'folk-acoustic':'Folk / Acoustic', world:'World Music', afrobeat:'Afrobeat', salsa:'Salsa', latin:'Latin', comedy:'Comedy', theatre:'Theatre', other:'Other',
};
const TYPES = { gig:'Gig', club:'Club night', comedy:'Comedy', theatre:'Theatre', other:'Event' };
const SOURCES = { skiddle:'Skiddle', songkick:'Songkick', fatsoma:'Fatsoma', ticketmaster:'Ticketmaster', mayflower:'Mayflower Theatre', thebrook:'the-brook.com', mitc:'Music in the City', community:'community submission' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const TODAY = localISO(new Date());
const DOW = new Date().getDay();
const weekendDays = () => { if (DOW === 5) return [0, 1, 2]; if (DOW === 6) return [0, 1]; if (DOW === 0) return [0]; const f = 5 - DOW; return [f, f + 1, f + 2]; };
const WKND = weekendDays().map(plusDays);
const WKND_COMING = DOW >= 1 && DOW <= 4;
const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtMoney = (n) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);
const priceLabel = (e) => e.price == null ? null : (e.price === 0 && (e.priceMax == null || e.priceMax === 0)) ? 'Free' : e.priceText || fmtMoney(e.price);
const knownGenres = (e) => (e.genreGuess ? [] : (e.genres || []).filter((g) => GENRES[g]));
const venueById = new Map((feed.venues || []).map((v) => [v.id, v]));
const venueName = (e) => (venueById.get(e.venueId) || {}).name || e.venueName || 'Southampton';
const venueAddr = (e) => { const v = venueById.get(e.venueId) || {}; return [v.address, v.postcode || e.postcode].filter(Boolean).join(', '); };
const eventPath = (e) => `/e/${slugify(e.artist)}-${e.id}.html`;
const venuePath = (vid) => `/v/${vid}.html`;
// venue photos manifest (optional): shown on venue pages and the /venues list only
let VENUE_PHOTOS = {};
try {
  const m = JSON.parse(readFileSync(join(ROOT, 'venue-photos.json'), 'utf8'));
  for (const ph of m.photos || []) if (ph.venue && ph.file) (VENUE_PHOTOS[ph.venue] = VENUE_PHOTOS[ph.venue] || []).push(ph);
} catch (e) { /* no manifest, no photos */ }
const venuePhotoHtml = (vid, cls = 'vimg') => { const ph = (VENUE_PHOTOS[vid] || [])[0]; return ph ? `<figure class="vphoto"><img class="${cls}" src="/${esc(ph.file)}" alt="" loading="lazy"></figure>` : ''; };
const dayPath = (iso) => `/d/${iso}.html`;

const events = (feed.events || []).filter((e) => e.date && e.artist).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
const upcoming = events.filter((e) => e.date >= TODAY);

/* ---------- shared chrome ---------- */
function shell({ title, desc, canonical, body, og = {}, jsonld = null, noindex = false }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonical}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:site_name" content="Southampton.Live">
<meta property="og:type" content="${og.type || 'website'}">
<meta property="og:title" content="${esc(og.title || title)}">
<meta property="og:description" content="${esc(og.desc || desc)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${esc(og.image || SITE + '/share-card.png?v=1')}">
<meta name="twitter:card" content="summary_large_image">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/<\//g, '<\\/')}</script>` : ''}
<link rel="icon" href="/icon-512.png">
<style>
:root{color-scheme:dark}
body{background:#000;color:#ddd;font-family:Arial,Helvetica,sans-serif;margin:0;padding:0;line-height:1.55}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1e1e1e}
header a{color:#fff;text-decoration:none;font-weight:800;letter-spacing:.02em}
header .live{color:#2EE6A8;font-size:11px;letter-spacing:.14em;font-weight:800}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
h1{color:#fff;font-size:28px;line-height:1.15;margin:8px 0 6px}
h2{color:#fff;font-size:18px;margin:26px 0 10px}
a{color:#FF6E6E}
.meta{color:#b5b5b5;font-size:15px;margin:2px 0}
.meta b{color:#fff}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.pill{border:1.5px solid #2c2c2c;border-radius:999px;padding:3px 10px;font-size:12.5px;color:#e6e6e6}
.pill.warn{border-color:#FF7A00;color:#FF7A00;font-weight:800}
.poster{width:100%;max-width:560px;border-radius:14px;display:block;margin:14px 0}
.art{width:100%;max-width:560px;aspect-ratio:16/9;border-radius:14px;display:flex;align-items:flex-end;padding:18px;box-sizing:border-box;color:#fff;font-weight:900;font-size:28px;line-height:1.05;text-transform:uppercase;margin:14px 0}
.btn{display:inline-block;background:#FF0000;color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:14px;margin:14px 10px 0 0}
.btn.ghost{background:#161616;border:1.5px solid #2c2c2c;color:#fff}
.src{color:#8a8a8a;font-size:12.5px;margin-top:14px}
.row{display:block;padding:12px 0;border-bottom:1px solid #1b1b1b;color:#ddd;text-decoration:none}
.row b{color:#fff;display:block;font-size:16px}
.row span{color:#9a9a9a;font-size:13.5px}
.dayhead{color:#fff;font-weight:900;font-size:20px;margin:22px 0 4px;text-transform:uppercase}
.vphoto{margin:14px 0 6px}.vphoto img{width:100%;max-height:420px;object-fit:cover;border-radius:14px;display:block}.vphoto figcaption{color:#6d6d6d;font-size:11.5px;margin-top:4px;text-align:right}
.vrow{display:flex;gap:12px;align-items:center}.vrow img{width:92px;height:62px;object-fit:cover;border-radius:10px;flex-shrink:0}
.note{border:1.5px solid #FF7A00;border-radius:12px;padding:10px 14px;color:#FF7A00;font-weight:700;margin:12px 0}
footer{color:#6d6d6d;font-size:12px;padding:20px 16px;border-top:1px solid #1e1e1e;text-align:center}
footer a{color:#8a8a8a}
</style></head><body>
<header><a href="/">SOUTHAMPTON<span style="color:#FF0000">.LIVE</span></a><span class="live">LIVE IN SO</span></header>
<main>${body}</main>
<footer>Southampton.Live — Southampton's gig guide · listings refresh every 3 hours · always confirm with the venue · produced and managed by Mark James, <a href="https://southamptondesign.co/" rel="noopener">Southampton Design Co</a><br>
<a href="/">What's on</a> · <a href="/#/add"><b>Add your event — free, always</b></a> · <a href="/tonight.html">Tonight</a> · <a href="/this-weekend.html">This weekend</a> · <a href="/venues">Venues</a> · <a href="/about.html">About</a> · <a href="/about/free/">How this stays free</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></footer>
</body></html>`;
}

function artBlock(e) {
  if (e.img) return `<img class="poster" src="${esc(e.img)}" alt="${esc(e.artist)} — poster">`;
  // our own generated art: a gradient with the name. Not a photo, never passed off as one.
  const hue = [...String(e.id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  return `<div class="art" style="background:linear-gradient(155deg,hsl(${hue},80%,42%),hsl(${(hue + 40) % 360},70%,22%))">${esc(e.artist)}</div>`;
}
function rowHTML(e) {
  const bits = [TYPES[e.type] || 'Event', venueName(e), fmtShort(e.date) + (e.time ? ' · ' + e.time : ''), priceLabel(e)].filter(Boolean);
  return `<a class="row" href="${eventPath(e)}"><b>${esc(e.artist)}</b><span>${esc(bits.join(' · '))}</span></a>`;
}
function listByDay(list) {
  const by = new Map();
  for (const e of list) { if (!by.has(e.date)) by.set(e.date, []); by.get(e.date).push(e); }
  return [...by.entries()].map(([d, es]) => `<div class="dayhead"><a href="${dayPath(d)}" style="color:#fff;text-decoration:none">${esc(fmtDate(d))}</a></div>${es.map(rowHTML).join('')}`).join('');
}

/* ---------- event page ---------- */
function eventPage(e, past = false) {
  const vn = venueName(e), addr = venueAddr(e), price = priceLabel(e), genres = knownGenres(e);
  const title = `${e.artist} — ${vn}, Southampton · ${fmtShort(e.date)}${price ? ' · ' + (price === 'Free' ? 'Free' : 'from ' + fmtMoney(e.price)) : ''}`;
  const descBits = [TYPES[e.type] || 'Event', vn, fmtDate(e.date), e.time ? `${e.time}` : null, price, genres.map((g) => GENRES[g]).join(', ') || null].filter(Boolean);
  const desc = `${e.artist} at ${vn}, Southampton — ${descBits.slice(1).join(' · ')}. Listed on Southampton.Live, credited to ${SOURCES[e.source] || e.source || 'the venue'}.`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': e.type === 'comedy' ? 'ComedyEvent' : e.type === 'theatre' ? 'TheaterEvent' : 'MusicEvent',
    name: e.artist, startDate: e.time ? `${e.date}T${e.time}:00` : e.date,
    eventStatus: e.status === 'postponed' ? 'https://schema.org/EventPostponed' : e.status === 'rescheduled' ? 'https://schema.org/EventRescheduled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: vn, address: { '@type': 'PostalAddress', streetAddress: (venueById.get(e.venueId) || {}).address || undefined, addressLocality: 'Southampton', postalCode: (venueById.get(e.venueId) || {}).postcode || e.postcode || undefined, addressCountry: 'GB' } },
    url: SITE + eventPath(e),
    organizer: { '@type': 'Organization', name: 'Southampton.Live', url: SITE },
  };
  if (e.img) jsonld.image = e.img;
  if (e.ticketUrl) jsonld.offers = { '@type': 'Offer', url: e.ticketUrl, /* no availability claim: we don't know stock */ ...(e.price != null ? { price: e.price, priceCurrency: 'GBP' } : {}) };
  if (e.desc) jsonld.description = e.desc;

  const seenMore = new Set([e.artist.toLowerCase()]);
  const more = upcoming.filter((x) => x.venueId === e.venueId && x.id !== e.id && !seenMore.has(x.artist.toLowerCase()) && seenMore.add(x.artist.toLowerCase())).slice(0, 6);
  const body = `
${past ? `<div class="note">This show has happened. Here's what's coming up at ${esc(vn)}.</div>` : ''}
${e.status ? `<div class="note">${esc(e.status.toUpperCase())} — the promoter has flagged this event. Check with the venue before travelling.</div>` : ''}
<p class="meta">${esc(TYPES[e.type] || 'Event')} — <a href="${venuePath(e.venueId)}">${esc(vn)}</a></p>
<h1>${esc(e.artist)}</h1>
<p class="meta"><b>${esc(fmtDate(e.date))}</b>${e.time ? ` · ${esc(e.time)}` : ''}</p>
${addr ? `<p class="meta">${esc(addr)}</p>` : ''}
<div class="pills">${price ? `<span class="pill">${esc(price)}${e.feeIncluded === true ? ' incl. fees' : e.feeIncluded === false ? ' + booking fee' : ''}</span>` : ''}${e.minage ? `<span class="pill">${esc(e.minage)}</span>` : ''}${genres.map((g) => `<span class="pill">${esc(GENRES[g])}</span>`).join('')}</div>
${artBlock(e)}
${e.desc ? `<p>${esc(e.desc)}</p>` : ''}
${e.ticketUrl ? `<a class="btn" href="${esc(e.ticketUrl)}" rel="noopener">${price === 'Free' ? 'Free entry — details' : 'Get tickets'} ↗</a>` : ''}
<a class="btn ghost" href="/#/e/${esc(e.id)}">Open in the guide</a>
<p class="src">Listing via ${e.source === 'skiddle' ? `<a href="${esc(e.infoUrl || 'https://www.skiddle.com')}" rel="noopener"><img src="/skiddle-logo.svg" alt="" style="height:13px;vertical-align:-2px;margin-right:4px" onerror="this.remove()">Skiddle</a>${(e.skiddleGenres || []).length ? ` · Skiddle genres: ${e.skiddleGenres.map(esc).join(', ')}` : ''}` : esc(SOURCES[e.source] || e.source || 'the venue')}${e.infoUrl ? ` · <a href="${esc(e.infoUrl)}" rel="noopener">event page</a>` : ''} · ${e.price != null ? 'advertised price — booking fees may be added at checkout · ' : ''}details can change — check before travelling.</p>
${more.length ? `<h2>More at ${esc(vn)}</h2>${more.map(rowHTML).join('')}` : ''}`;
  return shell({ title, desc, canonical: eventPath(e), body, og: { type: 'event', image: e.img || undefined }, jsonld, noindex: past });
}

/* ---------- venue / day / tonight / weekend pages ---------- */
function listPage({ title, h1, intro, canonical, list, emptyLine, lead = '' }) {
  const body = `<h1>${esc(h1)}</h1><p class="meta">${esc(intro)}</p>${lead}
${list.length ? listByDay(list) : `<p class="note">${esc(emptyLine)}</p><p><a class="btn ghost" href="/#/add">Add your event — free, always</a></p>`}`;
  return shell({ title, desc: intro, canonical, body });
}

/* ---------- calendar feeds ---------- */
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFeed(name, list) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Southampton.Live//listings//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(name)}`, 'X-WR-TIMEZONE:Europe/London', 'REFRESH-INTERVAL;VALUE=DURATION:PT3H'];
  for (const e of list) {
    const d = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@southampton.live`, `DTSTAMP:${new Date(feed.generated).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`);
    if (e.time) { lines.push(`DTSTART;TZID=Europe/London:${d}T${e.time.replace(':', '')}00`); }
    else { // unknown time → all-day, never a made-up hour
      const next = new Date(e.date + 'T12:00:00'); next.setDate(next.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${localISO(next).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${icsEsc(e.artist)}`, `LOCATION:${icsEsc([venueName(e), venueAddr(e)].filter(Boolean).join(', '))}`, `URL:${SITE}${eventPath(e)}`,
      `DESCRIPTION:${icsEsc([TYPES[e.type] || 'Event', priceLabel(e), e.time ? null : 'Start time not yet published', `Listed via ${SOURCES[e.source] || e.source}`, e.ticketUrl ? `Tickets: ${e.ticketUrl}` : null, 'Details can change — check with the venue.'].filter(Boolean).join('\n'))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* ---------- write everything ---------- */
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { pages: {} };
const prev = state.pages || {};
const now = Date.now();
const billKey = (e) => `${e.venueId}|${e.date}|${slugify(e.artist).split('-').filter((w) => w.length > 2).sort().slice(0, 4).join(' ')}`;
const currentByKey = new Map(events.map((e) => [billKey(e), e]));

for (const d of ['e', 'v', 'd']) mkdirSync(join(PAGES, d), { recursive: true });
for (const d of ['v', 'g']) mkdirSync(join(CAL, d), { recursive: true });

// tidy: remove any page files not written this run (tracked in state)
const written = new Set();
const put = (rel, html) => { const p = join(PAGES, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, html); written.add(rel); };

const nextState = { pages: {} };
let nEvents = 0, nPast = 0, nAlias = 0;
for (const e of events) {
  const rel = eventPath(e).slice(1);
  put(rel, eventPage(e, e.date < TODAY));
  nextState.pages[e.id] = { path: rel, date: e.date, key: billKey(e), lastSeen: now };
  nEvents++;
}
// pages from previous runs whose id is gone
for (const [id, p] of Object.entries(prev)) {
  if (nextState.pages[id]) continue;
  const ageDays = (now - (p.lastSeen || 0)) / 864e5;
  if (ageDays > KEEP_DAYS) continue;                       // gone for good; file is removed below
  const existing = join(PAGES, p.path);
  const survivor = currentByKey.get(p.key);
  if (survivor && survivor.id !== id) {                     // merged into another id → redirect
    const to = eventPath(survivor);
    put(p.path, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title><link rel="canonical" href="${SITE}${to}"><meta http-equiv="refresh" content="0; url=${to}"><meta name="robots" content="noindex"></head><body><a href="${to}">This listing has moved</a></body></html>`);
    nextState.pages[id] = { ...p, alias: survivor.id, lastSeen: p.lastSeen };
    nAlias++;
  } else if (existsSync(existing)) {                         // gone from the feed: keep the page 30 days, say why
    let html = readFileSync(existing, 'utf8');
    const happened = p.date < TODAY;
    const note = happened
      ? 'This show has happened. See what\'s on tonight: <a href="/tonight.html">Tonight in Southampton</a>.'
      : 'This listing is no longer on the source site — it may have been cancelled or changed. Check with the venue.';
    if (!html.includes('class="note"')) {
      html = html.replace('<main>', `<main><div class="note">${note}</div>`).replace('</title>', '</title>\n<meta name="robots" content="noindex">');
    }
    // the structured data asserted a scheduled, bookable event — no longer true, so drop it
    html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/, '');
    put(p.path, html);
    nextState.pages[id] = p;
    nPast++;
  }
}
// venues
const venuesWithUpcoming = (feed.venues || []).filter((v) => upcoming.some((e) => e.venueId === v.id));
for (const v of venuesWithUpcoming) {
  const list = upcoming.filter((e) => e.venueId === v.id);
  put(venuePath(v.id).slice(1), listPage({
    title: `${v.name}, Southampton — what's on · Southampton.Live`, h1: v.name,
    intro: `${[v.address, v.postcode].filter(Boolean).join(', ')} · ${list.length} upcoming ${list.length === 1 ? 'event' : 'events'} listed · updated every 3 hours`,
    canonical: venuePath(v.id), list, emptyLine: `Nothing listed yet at ${v.name}.`, lead: venuePhotoHtml(v.id),
  }));
}
// days
const days = [...new Set(upcoming.map((e) => e.date))];
for (const d of days) {
  const list = upcoming.filter((e) => e.date === d);
  put(dayPath(d).slice(1), listPage({ title: `What's on in Southampton — ${fmtDate(d)} · Southampton.Live`, h1: fmtDate(d), intro: `${list.length} ${list.length === 1 ? 'event' : 'events'} listed across Southampton's venues`, canonical: dayPath(d), list, emptyLine: 'Nothing listed yet for this day.' }));
}
// tonight / this weekend (counts are real; no number if nothing)
const tonight = upcoming.filter((e) => e.date === TODAY);
put('tonight.html', listPage({ title: `${tonight.length ? tonight.length + ' things on in Southampton tonight' : 'Tonight in Southampton'} · Southampton.Live`, h1: 'Tonight in Southampton', intro: `${fmtDate(TODAY)} · ${tonight.length ? tonight.length + ' listed' : 'nothing listed yet'} · gigs, club nights, comedy and theatre`, canonical: '/tonight.html', list: tonight, emptyLine: 'Nothing listed yet for tonight.' }));
const wk = upcoming.filter((e) => WKND.includes(e.date));
put('this-weekend.html', listPage({ title: `${wk.length ? wk.length + ' things on in Southampton this ' + (WKND_COMING ? 'coming ' : '') + 'weekend' : 'This weekend in Southampton'} · Southampton.Live`, h1: WKND_COMING ? 'This coming weekend in Southampton' : 'This weekend in Southampton', intro: `${fmtShort(WKND[0])} – ${fmtShort(WKND[WKND.length - 1])} · ${wk.length ? wk.length + ' listed' : 'nothing listed yet'}`, canonical: '/this-weekend.html', list: wk, emptyLine: 'Nothing listed yet for this weekend.' }));

// /venues — the venue list as a real page (task T12). Alphabetical, "The" ignored,
// same rule as the app's sidebar. Counts are real; nothing descriptive we wrote.
{
  const nk = (v) => v.name.replace(/^the\s+/i, '');
  const TOP = ['joiners', 'heartbreakers', 'brook', 'the-1865', 'papillon', 'engine', 'guildhall', 'turnersims', 'mayflower']; // Mark's order, 26 Oct
  const top = TOP.map((id) => venuesWithUpcoming.find((v) => v.id === id)).filter(Boolean);
  const rest = venuesWithUpcoming.filter((v) => !TOP.includes(v.id)).sort((a, b) => nk(a).localeCompare(nk(b), 'en', { sensitivity: 'base' }));
  const vs = [...top, ...rest];
  const rowOf = (v) => {
    const n = upcoming.filter((e) => e.venueId === v.id).length;
    const where = [v.address, v.postcode].filter(Boolean).join(', ');
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name} ${v.postcode || ''} Southampton`)}`;
    const ph = (VENUE_PHOTOS[v.id] || [])[0];
    return `<a class="row vrow" href="${venuePath(v.id)}">${ph ? `<img src="/${esc(ph.file)}" alt="" loading="lazy">` : ''}<span style="min-width:0"><b>${esc(v.name)}</b><span>${esc(where)}${where ? ' · ' : ''}${n} coming up</span></span></a>`;
  };
  const body = `<h1>Live music venues in Southampton</h1>
<p class="meta">${vs.length} venues with something on · counts update every 3 hours</p>
<div class="dayhead">Top venues</div>
${top.map(rowOf).join('\n')}
<div class="dayhead">All venues, A to Z</div>
${rest.map(rowOf).join('\n')}
<p class="src">Venue descriptions and photos appear only when a venue supplies them. <a href="/#/add">Add your event — free, always</a> · <a href="/">Open the guide</a></p>`;
  put('venues.html', shell({ title: 'Live music venues in Southampton — Southampton.Live', desc: `${vs.length} venues with gigs, club nights, comedy and theatre coming up in Greater Southampton — addresses, maps and what's on at each.`, canonical: `${SITE}/venues`, body }));
}

// sitemap (upcoming events, venues, days, fixed pages; past/alias pages excluded)
const urls = [
  ['/', 'hourly', '1.0'], ['/tonight.html', 'hourly', '0.9'], ['/this-weekend.html', 'daily', '0.9'], ['/venues', 'daily', '0.8'],
  ['/about.html', 'monthly', '0.4'], ['/about/free/', 'monthly', '0.4'], ['/privacy.html', 'monthly', '0.2'], ['/terms.html', 'monthly', '0.2'],
  ...venuesWithUpcoming.map((v) => [venuePath(v.id), 'daily', '0.7']),
  ...days.map((d) => [dayPath(d), 'daily', '0.6']),
  ...upcoming.map((e) => [eventPath(e), 'daily', '0.8']),
];
put('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, f, p]) => `  <url><loc>${SITE}${esc(u)}</loc><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')}\n</urlset>\n`);

// remove stale page files (anything under pages/ we did not write this run)
function walk(dir, base = '') { for (const f of readdirSync(dir, { withFileTypes: true })) { const rel = base ? base + '/' + f.name : f.name; if (f.isDirectory()) walk(join(dir, f.name), rel); else if (!written.has(rel)) rmSync(join(dir, f.name)); } }
walk(PAGES);

// calendar feeds
let nCal = 0;
for (const v of venuesWithUpcoming) { writeFileSync(join(CAL, 'v', `${v.id}.ics`), icsFeed(`${v.name} — Southampton.Live`, upcoming.filter((e) => e.venueId === v.id))); nCal++; }
for (const g of Object.keys(GENRES)) {
  const list = upcoming.filter((e) => knownGenres(e).includes(g));
  const p = join(CAL, 'g', `${g}.ics`);
  if (list.length) { writeFileSync(p, icsFeed(`${GENRES[g]} in Southampton — Southampton.Live`, list)); nCal++; } else if (existsSync(p)) rmSync(p);
}
writeFileSync(join(CAL, 'all.ics'), icsFeed('Everything on in Southampton — Southampton.Live', upcoming)); nCal++;

writeFileSync(STATE_FILE, JSON.stringify(nextState));
console.log(`pages: ${nEvents} event pages (${events.length - upcoming.length} past, kept ${KEEP_DAYS}d), ${nAlias} redirects, ${venuesWithUpcoming.length} venues, ${days.length} days, tonight ${tonight.length}, weekend ${wk.length}; sitemap ${urls.length} urls; ${nCal} calendar feeds`);

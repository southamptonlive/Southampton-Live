#!/usr/bin/env node
/* =============================================================
   SO:LIVE listings builder
   Aggregates real Southampton (SO14–SO53) gig listings into
   events.json, which the app fetches at load.

   Sources:
     • Skiddle venue pages  (server-rendered __NEXT_DATA__ JSON)
     • Skiddle city gigs/clubs pages (SSR "featured" set, SO-filtered)
     • The Brook            (event-card markup on the-brook.com)

   Zero dependencies. Node 18+.
   Run:  node build-events.mjs            → writes ./events.json
   ============================================================= */

const OUT = new URL('./events.json', import.meta.url).pathname;

const UA = 'SotonLive/1.0 (+https://southampton.live; hello@southampton.live)';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

/* ---------- source configuration ---------- */

// Skiddle venue pages that server-render full listings.
// slug → optional mapping onto the app's built-in venue ids.
const SKIDDLE_VENUES = [
  { slug: 'The-Hobbit' },
  { slug: 'EngineRooms',           appId: 'engine' },
  { slug: 'Suburbia-Southampton',  appId: 'suburbia' },
  { slug: 'The-Joiners',           appId: 'joiners' },
  { slug: 'The-1865',              appId: 'the-1865' },
  { slug: 'Papillon',              appId: 'papillon' },
  { slug: 'The-Attic-Southampton', appId: 'attic' },
  { slug: 'The-Loft-Southampton',  appId: 'loft' },
];

const SKIDDLE_CITY = [
  { kind: 'gigs',  url: 'https://www.skiddle.com/gigs/Southampton/' },
  { kind: 'clubs', url: 'https://www.skiddle.com/clubs/Southampton/' },
];

const BROOK_URL = 'https://www.the-brook.com/';

/* ---------- small utils ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 25000);
      const res = await fetch(url, {
        headers: { ...HEADERS, Referer: new URL(url).origin + '/' },
        redirect: 'follow',
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(2000 * i); // back off, Skiddle degrades hasty clients
    }
  }
}

const district = (pc) => parseInt(String(pc || '').replace(/^SO\s*/i, ''), 10);
const inPatch = (pc) => {
  if (!/^SO\d/i.test(String(pc || '').trim())) return false;
  const d = district(pc);
  return d >= 14 && d <= 53;
};

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const norm = (s) =>
  String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const deent = (s) =>
  String(s ?? '')
    .replace(/&pound;/g, '£').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#8217;|&apos;/g, "'").replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8230;|&hellip;/g, '…').replace(/&nbsp;/g, ' ');

// Canonical venue identities — merges the name variants that appear
// across Skiddle city pages, venue pages and cross-listings.
const CANON = [
  [/engine\s*rooms?/i,            { id: 'engine',    name: 'Engine Rooms',       postcode: 'SO15 1GZ', address: 'West Quay Road, Southampton' }],
  [/suburbia/i,                    { id: 'suburbia',  name: 'Suburbia',           postcode: 'SO14 0JD', address: '55 London Road, Southampton' }],
  [/joiners/i,                     { id: 'joiners',   name: 'The Joiners',        postcode: 'SO14 1NS', address: '141 St Mary Street, Southampton' }],
  [/heartbreakers/i,               { id: 'heartbreakers', name: 'Heartbreakers',  postcode: 'SO14 1JX', address: '20 Hanover Buildings, Southampton' }],
  [/\bthe\s*brook\b/i,          { id: 'brook',     name: 'The Brook',          postcode: 'SO17 3QF', address: '466 Portswood Road, Southampton' }],
  [/\b1865\b/,                   { id: 'the-1865',  name: 'The 1865',           postcode: 'SO14 3AR', address: 'Brunswick Square, Southampton' }],
  [/papill/i,                      { id: 'papillon',  name: 'Papillon',           postcode: 'SO15 1GG', address: 'West Quay Road, Southampton' }],
  [/o2\s*guildhall|guildhall\s*southampton/i, { id: 'guildhall', name: 'O2 Guildhall', postcode: 'SO14 7LP', address: 'West Marlands Road, Southampton' }],
  [/mast|mayflower\s*studios/i,   { id: 'mast',      name: 'MAST Mayflower Studios', postcode: 'SO14 7DU', address: 'Above Bar Street, Southampton' }],
  [/mayflower/i,                   { id: 'mayflower', name: 'Mayflower Theatre',  postcode: 'SO15 1GE', address: 'Commercial Road, Southampton' }],
  [/turner\s*sims/i,              { id: 'turnersims',name: 'Turner Sims',        postcode: 'SO17 1BJ', address: 'University of Southampton' }],
  [/hobbit/i,                      { id: 'hobbit',    name: 'The Hobbit',         postcode: 'SO14 0JZ', address: '134 Bevois Valley Road, Southampton' }],
  [/hang[ae]r\s*farm/i,           { id: 'hangarfarm',name: 'Hanger Farm Arts Centre', postcode: 'SO40 8FT', address: 'Aikman Lane, Totton' }],
  [/\bthe\s*arc\b/i,            { id: 'arc-winch', name: 'The Arc, Winchester', postcode: 'SO23 8SB', address: 'Jewry Street, Winchester' }],
  [/theatre\s*royal/i,            { id: 'troyal-winch', name: 'Theatre Royal Winchester', postcode: 'SO23 8SB', address: 'Jewry Street, Winchester' }],
  [/central\s*hall/i,             { id: 'centralhall', name: 'Central Hall',     postcode: 'SO14 1NF', address: 'St Mary Street, Southampton' }],
  [/\battic\b/i,                 { id: 'attic',     name: 'The Attic',          postcode: 'SO40 9HQ', address: 'Totton, Southampton' }],
  [/\bloft\b/i,                  { id: 'loft',      name: 'The Loft',           postcode: 'SO15 2EH', address: 'Bedford Place, Southampton' }],
  [/circuit/i,                     { id: 'circuit',   name: 'Circuit',            postcode: 'SO14 7FN', address: 'Southampton' }],
  [/sobar/i,                       { id: 'sobar',     name: 'The Sobar',          postcode: 'SO14 0JZ', address: 'Southampton' }],
];

function canonVenue(name, pc) {
  for (const [re, v] of CANON) if (re.test(String(name || ''))) return { ...v };
  return { id: slugify(name || 'unknown'), name: String(name || '').trim(), postcode: String(pc || '').toUpperCase().trim(), address: null };
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------- genre inference ---------- */
// Ordered: first match wins. Checked against name + description.
const GENRE_RULES = [
  ['other',      /\b(comedy|comedian|stand[-\s]?up|quiz|bingo|karaoke|drag\s*(show|brunch)|wrestling|burlesque|cabaret)\b/i],
  ['electronic', /\b(dnb|drum\s*(&|and|n)\s*bass|jungle|house|techno|trance|garage|rave|bassline|dubstep|140|disco(?!\s*party)|dj\s|d&b|edm|electr)/i],
  ['hiphop',     /\b(hip\s*hop|rap|drill|grime|r&b|rnb|cypher|mc\b|freestyle)/i],
  ['punk',       /\b(punk|hardcore|emo|ska(?!nk)|riot|screamo|metalcore|pop[-\s]?punk|diy)\b/i],
  ['jazz',       /\b(jazz|funk|soul|blues|motown|swing|brass|groove|reggae|dub|afrobeat)\b/i],
  ['acoustic',   /\b(acoustic|unplugged|folk|singer[-\s]?songwriter|open\s*mic|songwriter|americana|country)\b/i],
  ['indie',      /\b(indie|rock|metal|tribute|band|alt\b|alternative|britpop|psych|grunge|shoegaze)/i],
];

// Fine-grained display tags (multiple per event, Headfirst-style)
const TAG_RULES = [
  ['drum & bass', /\b(dnb|d&b|drum\s*(&|and|n)\s*bass)\b/i],
  ['jungle', /\bjungle\b/i],
  ['garage', /\b(uk\s*)?garage|ukg\b/i],
  ['house', /\bhouse\b/i],
  ['techno', /\btechno\b/i],
  ['trance', /\btrance\b/i],
  ['dubstep', /\b(dubstep|140)\b/i],
  ['disco', /\bdisco\b/i],
  ['rave', /\brave\b/i],
  ['punk', /\bpunk\b/i],
  ['emo', /\bemo\b/i],
  ['metal', /\bmetal(core)?\b/i],
  ['hardcore', /\bhardcore|hxc\b/i],
  ['ska', /\bska\b/i],
  ['indie', /\bindie\b/i],
  ['rock', /\brock\b/i],
  ['psych', /\bpsych/i],
  ['tribute', /\btribute|experience\b/i],
  ['jazz', /\bjazz\b/i],
  ['funk', /\bfunk\b/i],
  ['soul', /\bsoul\b/i],
  ['blues', /\bblues\b/i],
  ['reggae', /\b(reggae|dub)\b/i],
  ['hip hop', /\b(hip\s*hop|rap)\b/i],
  ['drill', /\bdrill\b/i],
  ['grime', /\bgrime\b/i],
  ['r&b', /\b(r&b|rnb)\b/i],
  ['folk', /\bfolk\b/i],
  ['acoustic', /\b(acoustic|unplugged|singer[-\s]?songwriter)\b/i],
  ['country', /\b(country|americana)\b/i],
  ['spoken word', /\bspoken\s*word|poet/i],
  ['open mic', /\bopen\s*mic\b/i],
  ['comedy', /\b(comedy|comedian|stand[-\s]?up)\b/i],
  ['quiz', /\bquiz\b/i],
  ['drag', /\bdrag\b/i],
  ['karaoke', /\b(karaoke|massaoke)\b/i],
  ['freshers', /\bfreshers\b/i],
  ['halloween', /\bhalloween\b/i],
  ['xmas', /\b(christmas|xmas|nye|new\s*year)/i],
  ['free entry', null], // set programmatically
];
function inferTags(name, desc, price) {
  const hay = `${name} ${desc || ''}`;
  const tags = [];
  for (const [t, re] of TAG_RULES) if (re && re.test(hay)) tags.push(t);
  if (price === 0) tags.unshift('free entry');
  return tags.slice(0, 4);
}

// Event type: separate axis from genre (gig / club / comedy / other)
function inferType(name, desc, eventCode) {
  const hay = `${name} ${desc || ''}`;
  if (/\b(comedy|comedian|stand[-\s]?up)\b/i.test(hay)) return 'comedy';
  if (/\b(musical|ballet|opera|panto(mime)?|theatre|on\s+stage|the\s+play)\b/i.test(hay)) return 'theatre';
  if (/\b(quiz|bingo|drag\s*(show|brunch|queen)|karaoke|wrestling|burlesque|cabaret|spoken\s*word|poet)\b/i.test(hay)) return 'other';
  if (eventCode === 'CLUB') return 'club';
  return 'gig';
}

// AI knowledge layer: artist-level genre/type corrections (see genre-overrides.json).
// Ticket outlets expose no genre data, so classification needs artist knowledge —
// this cache holds it, seeded by AI review and extended by classify-events.mjs.
let OVERRIDES = [];
try {
  const { readFileSync } = await import('node:fs');
  OVERRIDES = JSON.parse(readFileSync(new URL('./genre-overrides.json', import.meta.url), 'utf8')).overrides || [];
} catch (e) { /* run without cache: keyword inference only */ }
function applyOverrides(ev) {
  const hay = ev.artist.toLowerCase();
  for (const o of OVERRIDES) {
    if (hay.includes(o.match)) {
      if (o.genre) ev.genre = o.genre;
      if (o.type) ev.type = o.type;
      return true;
    }
  }
  return false;
}

function inferGenre(name, desc, eventCode) {
  const hay = `${name} ${desc || ''}`;
  for (const [g, re] of GENRE_RULES) if (re.test(hay)) return g;
  return eventCode === 'CLUB' ? 'electronic' : 'indie';
}

/* ---------- price extraction ---------- */
function priceFrom(ev) {
  // Skiddle: tickets[] with price fields, or entryprice free-text
  const nums = [];
  const push = (v) => {
    const n = parseFloat(String(v).replace(/[£,]/g, ''));
    if (Number.isFinite(n) && n >= 0 && n < 500) nums.push(n);
  };
  if (Array.isArray(ev.tickets)) for (const t of ev.tickets) push(t.price ?? t.Price);
  const tp = ev.ticketpricing;
  if (tp && typeof tp === 'object') {
    const lo = parseFloat(tp.minPrice), hi = parseFloat(tp.maxPrice);
    if (Number.isFinite(lo)) {
      const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      if (lo === 0 && !(hi > 0)) return { price: 0, priceMax: 0, priceText: 'Free' };
      if (Number.isFinite(hi) && hi > lo) return { price: lo, priceMax: hi, priceText: `£${fmt(lo)}–£${fmt(hi)}` };
      return { price: lo, priceMax: lo, priceText: null };
    }
  } else if (tp) {
    (String(tp).match(/£?\s*(\d+(?:\.\d{1,2})?)/g) || []).forEach(push);
  }
  if (ev.entryprice) {
    if (/free/i.test(ev.entryprice)) return { price: 0, priceMax: 0, priceText: 'Free' };
    (String(ev.entryprice).match(/£?\s*(\d+(?:\.\d{1,2})?)/g) || []).forEach(push);
  }
  if (nums.length) {
    const min = Math.min(...nums.filter((n) => n > 0).concat(nums.every((n) => n === 0) ? [0] : []));
    return { price: min, priceMax: min, priceText: null };
  }
  return { price: null, priceMax: null, priceText: ev.entryprice || null };
}

/* ---------- Skiddle parsing ---------- */

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function normSkiddle(ev, appId = null) {
  const v = ev.venue || {};
  const cv = appId ? null : canonVenue(v.name, v.postcode);
  const pc = (cv?.postcode || String(v.postcode || '').toUpperCase().trim());
  const time =
    ev.openingtimes?.doorsopen ||
    (ev.startdate ? String(ev.startdate).slice(11, 16) : '19:30');
  const { price, priceMax, priceText } = priceFrom(ev);
  const desc = deent(ev.description).replace(/\s+/g, ' ').trim().slice(0, 280);
  const nm = deent(ev.eventname);
  return {
    type: inferType(nm, desc, ev.EventCode),
    tags: inferTags(nm, desc, price),
    hot: !!ev.hotSeller,
    id: 'sk-' + ev.id,
    artist: deent(ev.eventname).trim(),
    venueId: appId || cv.id,
    venueName: appId ? String(v.name || '').trim() : cv.name,
    postcode: pc,
    date: ev.date || String(ev.startdate || '').slice(0, 10),
    time,
    price,
    priceMax: priceMax == null ? null : priceMax,
    priceText,
    genre: inferGenre(ev.eventname, desc, ev.EventCode),
    img: ev.xlargeimageurl || ev.largeimageurl || ev.imageurl || null,
    ticketUrl: ev.link || null,
    infoUrl: ev.link || null,
    going: Number(ev.goingtocount) || 0,
    minage: ev.minage ? String(ev.minage) : null,
    desc: desc || null,
    cancelled: ev.cancelled === '1' || ev.cancelled === 1,
    source: 'skiddle',
    _venue: { name: (appId ? v.name : cv.name), postcode: pc, address: (cv?.address || String(v.address || '').trim()) || null },
  };
}

async function skiddleVenue({ slug, appId }) {
  const url = `https://www.skiddle.com/whats-on/Southampton/${slug}/`;
  const html = await fetchText(url);
  const d = nextData(html);
  const evs = d?.props?.pageProps?.eventsData || [];
  if (!evs.length) throw new Error('no SSR eventsData (soft-blocked?)');
  return { url, events: evs.map((e) => normSkiddle(e, appId)) };
}

async function skiddleCity({ url }) {
  const html = await fetchText(url);
  const d = nextData(html);
  const evs = d?.props?.pageProps?.initialResults?.events || [];
  return { url, events: evs.map((e) => normSkiddle(e)) };
}

/* ---------- The Brook parsing ---------- */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function brookDate(text) {
  // "Fri 4 Sep 2026"
  const m = String(text).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

async function brook() {
  const html = await fetchText(BROOK_URL);
  const cards = html.split(/class="event-card"/).slice(1);
  const events = [];
  const seen = new Set();
  for (const c of cards) {
    const chunk = c.slice(0, 4000);
    const title = (chunk.match(/event-card__title[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/) || [])[1];
    const dateTx = (chunk.match(/event-card__date[^>]*>\s*([\s\S]*?)\s*<\/div>/) || [])[1];
    const priceT = (chunk.match(/event-card__price[^>]*>\s*([\s\S]*?)\s*<\/div>/) || [])[1];
    const info   = (chunk.match(/href="(https:\/\/www\.the-brook\.com\/tm-event\/[^"]+)"/) || [])[1];
    const ticket = (chunk.match(/href="(https:\/\/www\.ticketweb\.[^"]+)"/) || [])[1];
    const img    = (chunk.match(/data-src="([^"]+)"/) || chunk.match(/<img[^>]+src="(https:[^"]+)"/) || [])[1];
    if (!title || !dateTx) continue;
    const date = brookDate(dateTx);
    if (!date) continue;
    let name = deent(title).replace(/\s+/g, ' ').trim();
    // The Brook's homepage cross-lists sister-venue shows ("X @ The Joiners")
    let host = { id: 'brook', name: 'The Brook', postcode: 'SO17 3QF', address: '466 Portswood Road, Southampton' };
    const at = name.match(/@\s*(the\s+joiners|heartbreakers|the\s+1865|papillon|engine\s*rooms?)\s*$/i);
    if (at) { host = canonVenue(at[1]); name = name.replace(/\s*@\s*[^@]*$/, '').trim(); }
    const key = norm(name) + '|' + date;
    if (seen.has(key)) continue; // homepage repeats cards in two sliders
    seen.add(key);
    const priceD = deent(priceT || '').replace(/\s+/g, ' ').trim();
    const pm = priceD.match(/£\s*(\d+(?:\.\d{1,2})?)/);
    const bprice = pm ? parseFloat(pm[1]) : (/free/i.test(priceD) ? 0 : null);
    events.push({
      type: inferType(name, '', 'LIVE'),
      tags: inferTags(name, '', bprice),
      hot: false,
      id: 'br-' + slugify(name).slice(0, 40) + '-' + date,
      artist: name,
      venueId: host.id,
      venueName: host.name,
      postcode: host.postcode,
      date,
      time: '19:30',
      price: bprice,
      priceMax: bprice,
      priceText: pm ? null : priceD || null,
      genre: inferGenre(name, '', 'LIVE'),
      img: img || null,
      ticketUrl: ticket || info || null,
      infoUrl: info || null,
      going: 0,
      minage: null,
      desc: null,
      cancelled: false,
      source: 'thebrook',
      _venue: { name: host.name, postcode: host.postcode, address: host.address },
    });
  }
  if (!events.length) throw new Error('no event cards parsed');
  return { url: BROOK_URL, events };
}

/* ---------- source: Songkick metro area (JSON-LD, covers every venue) ---------- */
const SK_METRO = 'https://www.songkick.com/metro-areas/24584-uk-southampton';
async function songkickMetro() {
  const events = [];
  const seenIds = new Set();
  for (let page = 1; page <= 20; page++) {
    const url = SK_METRO + (page > 1 ? `?page=${page}` : '');
    const html = await fetchText(url);
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    let added = 0;
    for (const raw of blocks) {
      let d;
      try { d = JSON.parse(raw.replace(/<script[^>]*>|<\/script>/g, '')); } catch { continue; }
      if (Array.isArray(d)) d = d[0];
      if (!d || d['@type'] !== 'MusicEvent') continue;
      const loc = d.location || {};
      const addr = loc.address || {};
      const vname = deent(loc.name || '');
      // normalise their occasional "S015" zero-typo, uppercase
      const pc = String(addr.postalCode || '').toUpperCase().replace(/^S0(\d)/, 'SO$1').trim();
      if (!vname || /southampton, uk/i.test(vname) || !pc) continue;
      const idm = String(d.url || '').match(/concerts\/(\d+)/);
      if (!idm || seenIds.has(idm[1])) continue;
      seenIds.add(idm[1]);
      const start = String(d.startDate || '');
      const date = start.slice(0, 10);
      const time = start.includes('T') ? start.slice(11, 16) : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      // artist: prefer performer name, else strip " @ Venue" suffix
      const perf = Array.isArray(d.performer) && d.performer[0] && d.performer[0].name;
      const artist = deent(perf || String(d.name || '').replace(/\s*@\s*.+$/, '')).trim();
      if (!artist) continue;
      const v = canonVenue(vname, pc);
      if (!v.postcode) v.postcode = pc;
      const img = String(d.image || '');
      events.push({
        type: inferType(artist, '', 'LIVE'),
        tags: inferTags(artist, '', null),
        hot: false,
        id: 'sg-' + idm[1],
        artist,
        venueId: v.id,
        venueName: v.name,
        postcode: v.postcode,
        date,
        time, // null → app shows TBC; never invented
        price: null,
        priceMax: null,
        priceText: null,
        genre: inferGenre(artist, '', 'LIVE'),
        img: img || null,
        ticketUrl: String(d.url || '').split('?')[0] || null,
        infoUrl: String(d.url || '').split('?')[0] || null,
        going: 0,
        minage: null,
        desc: null,
        cancelled: /EventCancelled/i.test(String(d.eventStatus || '')),
        source: 'songkick',
        _venue: { name: v.name, postcode: v.postcode, address: v.address || deent(addr.streetAddress || '') || null },
      });
      added++;
    }
    if (!added) break;
    await sleep(2500);
  }
  if (!events.length) throw new Error('no MusicEvent JSON-LD parsed');
  return { url: SK_METRO, events };
}

/* ---------- source: WeGotTickets (grassroots outlet, SSR search) ---------- */
async function weGotTickets() {
  const events = [];
  const seen = new Set();
  for (let page = 1; page <= 9; page++) {
    const url = `https://wegottickets.com/searchresults/page/${page}/all?unified_query=southampton`;
    let html;
    try { html = await fetchText(url); } catch (e) { if (page === 1) throw e; break; }
    const blocks = html.split(/<h2[^>]*>/).slice(1);
    let added = 0;
    for (const b of blocks) {
      const link = b.match(/href="(https:\/\/wegottickets\.com\/f\/(\d+))"[^>]*class="event_link"[^>]*>([\s\S]*?)<\/a>/) ||
                   b.match(/href="([^"]*\/f\/(\d+))"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      if (/Not currently available/i.test(b)) continue;
      const town = b.match(/title="Location"[^<]*<\/th>\s*<td>\s*([A-Z\s]+):\s*([^<]+)</);
      if (!town) continue;
      const townName = town[1].trim();
      if (!/^(SOUTHAMPTON|TOTTON)$/i.test(townName)) continue;
      const vname = deent(town[2]).trim();
      const dm = b.match(/title="Date"[^<]*<\/th>\s*<td>\s*\w+\s+(\d{1,2})\w{0,2}\s+(\w+),?\s+(\d{4})/);
      if (!dm) continue;
      const months = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
      const mo = months[dm[2].toLowerCase()];
      if (!mo) continue;
      const date = `${dm[3]}-${String(mo).padStart(2, '0')}-${String(+dm[1]).padStart(2, '0')}`;
      const v = canonVenue(vname, '');
      if (!v.postcode) continue; // unknown venue, no verifiable SO postcode → skip honestly
      const artist = deent(link[3].replace(/<[^>]+>/g, '')).trim();
      if (!artist) continue;
      const key = norm(artist) + '|' + date;
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = b.match(/class="search-subtitle">([\s\S]*?)<\/span>/);
      events.push({
        type: inferType(artist, '', 'LIVE'),
        tags: inferTags(artist, '', null),
        hot: false,
        id: 'wgt-' + link[2],
        artist,
        venueId: v.id,
        venueName: v.name,
        postcode: v.postcode,
        date,
        time: null,
        price: null,
        priceText: null,
        genre: inferGenre(artist, '', 'LIVE'),
        img: null,
        ticketUrl: link[1],
        infoUrl: link[1],
        going: 0,
        minage: null,
        desc: sub ? deent(sub[1].replace(/<[^>]+>/g, '')).trim() : null,
        cancelled: false,
        source: 'wegottickets',
        _venue: { name: v.name, postcode: v.postcode, address: v.address },
      });
      added++;
    }
    if (!added && page > 1) break;
    await sleep(2500);
  }
  if (!events.length) throw new Error('no Southampton events parsed');
  return { url: 'https://wegottickets.com/searchresults/page/1/all?unified_query=southampton', events };
}

/* ---------- source: Music in the City (free city-wide festival) ---------- */
const MITC_URL = 'https://musicinthecity.org/full-listings-2026';
async function musicInTheCity() {
  const html = await fetchText(MITC_URL);
  // site self-describes as "A free celebration of music" — free entry is their claim, not ours
  const isFreeFest = /free celebration of music/i.test(html);
  // tab labels carry the real dates: SATURDAY 12/09/26 etc → pane id → ISO date
  const dayTabs = [...html.matchAll(/href="#(nav-\w+)"[^>]*>\s*\w+DAY\s+(\d{2})\/(\d{2})\/(\d{2})\s*</g)]
    .map((m) => ({ pane: m[1], iso: `20${m[4]}-${m[3]}-${m[2]}` }));
  if (!dayTabs.length) throw new Error('no dated day tabs found');
  const events = [];
  for (const { pane, iso } of dayTabs) {
    const pm = html.match(new RegExp(`id="${pane}"[^>]*>([\\s\\S]*?)(?=<div class="tab-pane|$)`));
    if (!pm) continue;
    const blocks = pm[1].split(/class="venueListing mb35"/).slice(1);
    for (const b of blocks) {
      const vn = b.match(/data-venue="([^"]+)"/);
      const pcm = b.match(/\bSO\d{1,2}\s*\d[A-Z]{2}\b/);
      if (!vn || !pcm) continue;
      const vname = deent(vn[1]).trim();
      const v = canonVenue(vname, pcm[0]);
      if (!v.postcode) v.postcode = pcm[0];
      const vtext = (b.match(/class="venueListing-text">\s*([\s\S]*?)<\/div>/) || [])[1];
      const vdesc = vtext ? deent(vtext.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 160) : '';
      const img = (b.match(/<img src="(\/slir\/[^"]+)"/) || [])[1];
      for (const rm of b.matchAll(/artist-row">\s*<div class="col-3">\s*([\d.:]+)\s*<\/div>\s*<div class="col-9" data-artist="([^"]+)">\s*<a[^>]*>\s*([\s\S]*?)<\/a>/g)) {
        const tRaw = rm[1].replace('.', ':');
        let [hh, mm] = tRaw.split(':').map(Number);
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
        if (hh < 9) hh += 12; // a daytime festival has no 1–8 AM sets; 1.30 means 13:30
        const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        const label = deent(rm[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        const artist = deent(rm[2]).trim() || label;
        const genreHint = (label.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
        const hay = `${artist} ${genreHint}`;
        events.push({
          type: inferType(hay, '', 'LIVE'),
          tags: [...new Set([genreHint.toLowerCase(), 'music in the city', ...(isFreeFest ? ['free entry'] : [])])].filter(Boolean).slice(0, 4),
          hot: false,
          id: 'mitc-' + iso.slice(5) + '-' + slugify(artist).slice(0, 30) + '-' + slugify(vname).slice(0, 18),
          artist,
          venueId: v.id,
          venueName: v.name,
          postcode: v.postcode,
          date: iso,
          time,
          price: isFreeFest ? 0 : null,
          priceMax: isFreeFest ? 0 : null,
          priceText: isFreeFest ? 'Free' : null,
          genre: inferGenre(hay, '', 'LIVE'),
          img: img ? 'https://musicinthecity.org' + img.replace(/\/slir\/w\d+\//, '/slir/w600/') : null,
          ticketUrl: null,
          infoUrl: MITC_URL,
          going: 0,
          minage: null,
          desc: `Part of Music in the City — Southampton's free city-wide music festival.${vdesc ? ' ' + vdesc : ''}`.slice(0, 240),
          cancelled: false,
          source: 'mitc',
          noFuzzyMerge: true, // a festival set is not the same event as a gig by the same act that day
          _venue: { name: v.name, postcode: v.postcode, address: null },
        });
      }
    }
  }
  if (!events.length) throw new Error('no festival sets parsed');
  return { url: MITC_URL, events };
}

/* ---------- source: Mayflower Theatre + MAST (their own what's-on) ---------- */
const MAYF_URL = 'https://www.mayflower.org.uk/whats-on/';
async function mayflower() {
  const html = await fetchText(MAYF_URL);
  const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
  const iso = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const cards = html.split(/class="c-event-card c-event-card--/).slice(1);
  const events = [];
  const seen = new Set();
  for (const c of cards) {
    const link = c.match(/class="c-event-card__permalink"\s+href="([^"]+)"/);
    const title = c.match(/u-hidden-visually">\s*([\s\S]*?)<\/span>/);
    const dr = c.match(/c-event-card__daterange">\s*([\s\S]*?)<\/time>/);
    const ven = c.match(/c-event-card__venue"\s*>([^<]+)</);
    if (!link || !title || !dr || !ven) continue;
    const name = deent(title[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const drTxt = deent(dr[1]).replace(/\s+/g, ' ').trim();
    // "6 September 2026" | "4 – 5 September 2026" | "9 September – 1 October 2026" | "30 Dec 2026 – 2 Jan 2027"
    let dates = [];
    let m;
    if ((m = drTxt.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/))) {
      const mo = MONTHS[m[2].toLowerCase()]; if (mo) dates = [iso(+m[1], mo, +m[3])];
    } else if ((m = drTxt.match(/^(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(\w+)\s+(\d{4})$/))) {
      const mo = MONTHS[m[3].toLowerCase()];
      if (mo) for (let d = +m[1]; d <= +m[2]; d++) dates.push(iso(d, mo, +m[4]));
    } else if ((m = drTxt.match(/^(\d{1,2})\s+(\w+)(?:\s+(\d{4}))?\s*[–-]\s*(\d{1,2})\s+(\w+)\s+(\d{4})$/))) {
      const mo1 = MONTHS[m[2].toLowerCase()], mo2 = MONTHS[m[5].toLowerCase()];
      const y2 = +m[6], y1 = m[3] ? +m[3] : (mo1 > mo2 ? y2 - 1 : y2);
      if (mo1 && mo2) {
        let cur = new Date(Date.UTC(y1, mo1 - 1, +m[1]));
        const end = new Date(Date.UTC(y2, mo2 - 1, +m[4]));
        while (cur <= end && dates.length <= 31) { dates.push(cur.toISOString().slice(0, 10)); cur = new Date(+cur + 864e5); }
      }
    }
    if (!dates.length || dates.length > 31) continue; // long residencies: skip rather than misrepresent
    const v = canonVenue(deent(ven[1]).trim(), '');
    if (!v.postcode) continue;
    const img = (c.match(/<img src="(https:\/\/images\.mayflower\.org\.uk[^"]+?)(?:\?[^"]*)?"/) || [])[1];
    const url = link[1].startsWith('http') ? link[1] : 'https://www.mayflower.org.uk' + link[1];
    for (const date of dates) {
      const id = 'mayf-' + slugify(name).slice(0, 34) + '-' + date;
      if (seen.has(id)) continue;
      seen.add(id);
      const inferred = inferType(name, '', 'LIVE');
      const musicky = /\b(live|band|tour|orchestra|tribute|sings?|singing|in concert|music|symphonic|acoustic|strictly)\b/i.test(name);
      events.push({
        type: inferred !== 'gig' ? inferred : (musicky ? 'gig' : 'theatre'),
        tags: inferTags(name, '', null),
        hot: false,
        id,
        artist: name,
        venueId: v.id,
        venueName: v.name,
        postcode: v.postcode,
        date,
        time: null,
        price: null,
        priceMax: null,
        priceText: null,
        genre: inferGenre(name, '', 'LIVE'),
        img: img ? img + '?resize=640%2C400' : null,
        ticketUrl: url,
        infoUrl: url,
        going: 0,
        minage: null,
        desc: null,
        cancelled: false,
        source: 'mayflower',
        _venue: { name: v.name, postcode: v.postcode, address: null },
      });
    }
  }
  if (!events.length) throw new Error('no event cards parsed');
  return { url: MAYF_URL, events };
}

/* ---------- source: Fatsoma (public JSON:API, licensed at fatsoma.com/policies/api) ---------- */
async function fatsoma() {
  const base = 'https://api.fatsoma.com/v1/events?filter%5Bquery%5D=southampton&include=location,page,categories&page%5Bsize%5D=50';
  const events = [];
  for (let page = 1; page <= 12; page++) {
    const res = await fetch(base + `&page%5Bnumber%5D=${page}`, {
      headers: { accept: 'application/vnd.api+json', 'user-agent': UA, 'accept-language': 'en-GB' },
    });
    if (!res.ok) { if (page === 1) throw new Error('HTTP ' + res.status); break; }
    const d = await res.json();
    if (!Array.isArray(d.data) || !d.data.length) break;
    const inc = {};
    for (const i of d.included || []) inc[i.type + ':' + i.id] = i;
    for (const ev of d.data) {
      const a = ev.attributes || {};
      if (a.expired) continue;
      const locRef = ev.relationships?.location?.data;
      const loc = locRef && inc['locations:' + locRef.id];
      const addr = loc?.attributes?.address || '';
      const pcm = String(addr).toUpperCase().match(/\bSO\d{1,2}\s*\d[A-Z]{2}\b/);
      if (!pcm) continue; // text search catches non-SO events; postcode is the gate
      const start = String(a['starts-at'] || '');
      const date = start.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const vname = deent(loc.attributes.name || '').trim();
      if (!vname) continue;
      const v = canonVenue(vname, pcm[0]);
      if (!v.postcode) v.postcode = pcm[0];
      const catRefs = ev.relationships?.categories?.data || [];
      const cats = catRefs.map((c) => inc['categories:' + c.id]?.attributes?.['vanity-name']).filter(Boolean);
      const name = deent(a.name || '').replace(/\s+/g, ' ').trim();
      const desc = deent(String(a.description || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 280) || null;
      const pMin = a['price-min-with-fees'], pMax = a['price-max-with-fees'];
      const price = Number.isFinite(pMin) ? pMin / 100 : null;
      const priceMax = Number.isFinite(pMax) ? pMax / 100 : price;
      const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      const priceText = price == null ? null
        : price === 0 && priceMax === 0 ? 'Free'
        : priceMax > price ? `£${fmt(price)}–£${fmt(priceMax)}` : null;
      const type = cats.includes('club-nights') ? 'club'
        : cats.includes('comedy') ? 'comedy'
        : inferType(name, desc || '', cats.includes('gigs-concerts') || cats.includes('live-music') ? 'LIVE' : 'CLUB');
      const url = a['seo-name'] ? 'https://www.fatsoma.com/e/' + a['seo-name'] : null;
      const ageM = String(a['age-restrictions'] || '').match(/(\d{2})\s*\+/);
      events.push({
        type,
        tags: inferTags(name, desc || '', price),
        hot: false,
        id: 'fat-' + ev.id.slice(0, 12),
        artist: name,
        venueId: v.id,
        venueName: v.name,
        postcode: v.postcode,
        date,
        time: start.includes('T') ? start.slice(11, 16) : null,
        price,
        priceMax,
        priceText,
        genre: inferGenre(name, desc || '', type === 'club' ? 'CLUB' : 'LIVE'),
        img: a['asset-url'] || null,
        ticketUrl: url,
        infoUrl: url,
        going: null,
        minage: ageM ? ageM[1] + '+' : null,
        desc,
        cancelled: false,
        source: 'fatsoma',
        _venue: { name: v.name, postcode: v.postcode, address: deent(addr).replace(/, UK$/, '') || null },
      });
    }
    await sleep(1500);
  }
  if (!events.length) throw new Error('no in-patch events from API');
  return { url: 'https://www.fatsoma.com/search?query=southampton', events };
}

/* ---------- source: Ticketmaster Discovery (optional — set TM_API_KEY) ---------- */
async function ticketmaster() {
  const KEY = process.env.TM_API_KEY;
  if (!KEY) throw new Error('skipped — set TM_API_KEY (free at developer.ticketmaster.com) to enable');
  const events = [];
  for (let page = 0; page < 5; page++) {
    const u = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${KEY}&latlong=50.9097,-1.4044&radius=15&unit=miles&countryCode=GB&classificationName=music&size=100&page=${page}&sort=date,asc`;
    const res = await fetch(u, { headers: { 'user-agent': UA } });
    if (!res.ok) break;
    const d = await res.json();
    const evs = d?._embedded?.events || [];
    if (!evs.length) break;
    for (const ev of evs) {
      const ven = ev._embedded?.venues?.[0];
      const pc = String(ven?.postalCode || '').toUpperCase().replace(/^S0(\d)/, 'SO$1');
      if (!/^SO\d{1,2}/.test(pc)) continue;
      const date = ev.dates?.start?.localDate;
      if (!date) continue;
      const v = canonVenue(deent(ven.name || ''), pc);
      if (!v.postcode) v.postcode = pc;
      const pr = (ev.priceRanges || [])[0];
      const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      events.push({
        type: inferType(ev.name, '', 'LIVE'),
        tags: inferTags(ev.name, '', pr ? pr.min : null),
        hot: false,
        id: 'tm-' + ev.id,
        artist: deent(ev.name).trim(),
        venueId: v.id, venueName: v.name, postcode: v.postcode,
        date,
        time: ev.dates?.start?.localTime ? ev.dates.start.localTime.slice(0, 5) : null,
        price: pr ? pr.min : null,
        priceMax: pr ? pr.max : (pr ? pr.min : null),
        priceText: pr && pr.max > pr.min ? `£${fmt(pr.min)}–£${fmt(pr.max)}` : null,
        genre: inferGenre(ev.name, '', 'LIVE'),
        img: (ev.images || []).sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null,
        ticketUrl: ev.url || null, infoUrl: ev.url || null,
        going: null, minage: null, desc: null,
        cancelled: /cancell?ed/i.test(ev.dates?.status?.code || ''),
        source: 'ticketmaster',
        _venue: { name: v.name, postcode: v.postcode, address: deent(ven.address?.line1 || '') || null },
      });
    }
    if (page + 1 >= (d.page?.totalPages || 1)) break;
    await sleep(1200);
  }
  if (!events.length) throw new Error('no in-patch events (searched 15mi around Southampton — check key activation at developer.ticketmaster.com)');
  return { url: 'https://www.ticketmaster.co.uk/', events };
}

/* ---------- source: Skiddle official API (licensed; images + genres by right) ---------- */
async function skiddleApi() {
  const KEY = process.env.SKIDDLE_API_KEY;
  if (!KEY) throw new Error('skipped — apply free at skiddle.com/api, add SKIDDLE_API_KEY secret');
  const events = [];
  let offset = 0, total = 1;
  while (offset < total && offset < 500) {
    const u = `https://www.skiddle.com/api/v1/events/search/?api_key=${KEY}&latitude=50.9097&longitude=-1.4044&radius=15&order=date&limit=100&offset=${offset}&description=1`;
    const res = await fetch(u, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    total = parseInt(d.totalcount || 0, 10);
    const rows = d.results || [];
    if (!rows.length) break;
    for (const ev of rows) {
      const pc = String(ev.venue?.postcode || '').toUpperCase().replace(/^S0(\d)/, 'SO$1').trim();
      if (!/^SO\d{1,2}/.test(pc)) continue;
      const v = canonVenue(deent(ev.venue?.name || ''), pc);
      if (!v.postcode) v.postcode = pc;
      const name = deent(ev.eventname || '').trim();
      if (!name || !ev.date) continue;
      const genreNames = (ev.genres || []).map((g) => String(g.name || '')).filter(Boolean);
      const ghay = `${name} ${genreNames.join(' ')} ${deent(ev.description || '').slice(0, 200)}`;
      const price = ev.entryprice ? (String(ev.entryprice).match(/([\d.]+)/) ? parseFloat(String(ev.entryprice).match(/([\d.]+)/)[1]) : null) : null;
      events.push({
        type: inferType(ghay, '', ev.EventCode || 'LIVE'),
        tags: [...new Set([...genreNames.map((g) => g.toLowerCase()).slice(0, 3), ...inferTags(name, '', price)])].slice(0, 4),
        hot: false,
        id: 'sk-' + ev.id,
        artist: name,
        venueId: v.id, venueName: v.name, postcode: v.postcode,
        date: ev.date,
        time: ev.openingtimes?.doorsopen || ev.starttime || null,
        price, priceMax: price,
        priceText: /free/i.test(String(ev.entryprice || '')) ? 'Free' : null,
        genre: inferGenre(ghay, '', ev.EventCode || 'LIVE'),
        img: ev.largeimageurl || ev.imageurl || null, // licensed via the API programme
        ticketUrl: ev.link || null, infoUrl: ev.link || null,
        going: parseInt(ev.goingtocount || 0, 10) || 0,
        minage: ev.MinAge || null,
        desc: deent(String(ev.description || '')).replace(/\s+/g, ' ').trim().slice(0, 280) || null,
        cancelled: false,
        source: 'skiddle',
        _venue: { name: v.name, postcode: v.postcode, address: deent(ev.venue?.address || '') || null },
      });
    }
    offset += rows.length;
    await sleep(1200);
  }
  if (!events.length) throw new Error('no in-patch events from API');
  return { url: 'https://www.skiddle.com', events };
}

/* ---------- pipeline ---------- */

async function main() {
  // Previous build (if any): the safety net when a source is blocked from this IP.
  let prevBySource = {};
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    if (existsSync(OUT)) {
      const prev = JSON.parse(readFileSync(OUT, 'utf8'));
      for (const e of prev.events || []) (prevBySource[e.source] = prevBySource[e.source] || []).push(e);
    }
  } catch (e) { /* no previous build */ }
  const FORCE_FAIL = String(process.env.FORCE_FAIL_SOURCES || '').split(',').filter(Boolean);
  const sources = [];
  let pool = [];

  const runs = [
    ...SKIDDLE_VENUES.map((v) => ({ id: 'skiddle:' + v.slug, label: `Skiddle · ${v.slug.replace(/-/g, ' ')}`, fn: () => skiddleVenue(v) })),
    ...SKIDDLE_CITY.map((c) => ({ id: 'skiddle:' + c.kind, label: `Skiddle · Southampton ${c.kind}`, fn: () => skiddleCity(c) })),
    { id: 'thebrook', label: 'The Brook (the-brook.com)', fn: brook },
    { id: 'songkick:metro', label: 'Songkick · Southampton metro', fn: songkickMetro },
    { id: 'mitc', label: 'Music in the City (musicinthecity.org)', fn: musicInTheCity },
    { id: 'mayflower', label: 'Mayflower Theatre + MAST (mayflower.org.uk)', fn: mayflower },
    { id: 'skiddle:api', label: 'Skiddle official API', fn: skiddleApi },
    { id: 'fatsoma', label: 'Fatsoma (api.fatsoma.com)', fn: fatsoma },
    { id: 'ticketmaster', label: 'Ticketmaster Discovery (optional key)', fn: ticketmaster },
  ];

  // events are tagged with a coarse source family in the feed (e.g. 'skiddle', 'songkick')
  const family = (runId) => runId.split(':')[0].replace('thebrook', 'thebrook');
  const carriedFamilies = new Set();
  for (const run of runs) {
    process.stdout.write(`fetching ${run.id} … `);
    try {
      if (FORCE_FAIL.includes(run.id)) throw new Error('forced failure (test)');
      const { url, events } = await run.fn();
      sources.push({ id: run.id, label: run.label, url, ok: true, events: events.length });
      pool = pool.concat(events);
      console.log(`${events.length} events`);
    } catch (e) {
      // Carry forward this family's previous still-future events instead of
      // erasing real listings just because this IP got blocked today.
      const fam = family(run.id);
      let carried = 0;
      if (!carriedFamilies.has(fam) && prevBySource[fam]) {
        carriedFamilies.add(fam);
        const alive = prevBySource[fam].filter((ev) => ev.date >= todayISO());
        pool = pool.concat(alive);
        carried = alive.length;
      }
      sources.push({ id: run.id, label: run.label, ok: false, carried, error: String(e.message || e) });
      console.log(`FAILED (${e.message})${carried ? ` — carried ${carried} previous events forward` : ''}`);
    }
    await sleep(2500); // be a polite client
  }

  const today = todayISO();

  // filter: future, in-patch, not cancelled, sane fields
  let events = pool.filter(
    (e) => e.artist && e.date && e.date >= today && !e.cancelled && inPatch(e.postcode)
  );

  // Rights pass: keep the facts (artist, venue, date, time, price, links) but do
  // not display images or promoter copy from sources with no licence in place.
  // Reverse per-source when written permission arrives. (MITC pending reply.)
  const STRIP_MEDIA = new Set(['songkick', 'fatsoma']);
  for (const e of events) if (STRIP_MEDIA.has(e.source)) { e.img = null; e.desc = null; }

  // AI knowledge layer pass
  let corrected = 0;
  for (const e of events) if (applyOverrides(e)) corrected++;
  console.log(`knowledge layer: ${OVERRIDES.length} rules, ${corrected} events corrected`);

  // dedupe: exact source id, then fuzzy name+date+district (prefer record w/ ticket+img)
  const byKey = new Map();
  const score = (e) => (e.ticketUrl ? 2 : 0) + (e.img ? 1 : 0) + (e.going ? 1 : 0) + (e.price != null ? 1 : 0);
  for (const e of events) {
    const key = e.id;
    const fuzzy = norm(e.artist).split(' ').slice(0, 5).join(' ') + '|' + e.date + '|' + district(e.postcode) + (e.noFuzzyMerge ? '|' + e.source : '');
    const existing = byKey.get(key) || byKey.get('~' + fuzzy);
    if (!existing || score(e) > score(existing.e)) byKey.set(key, { e, fuzzy });
    if (!byKey.has('~' + fuzzy)) byKey.set('~' + fuzzy, { e, fuzzy });
  }
  const out = [];
  const used = new Set();
  for (const [k, v] of byKey) {
    if (k.startsWith('~')) continue;
    const f = '~' + v.fuzzy;
    if (used.has(f)) continue;
    used.add(f);
    const { _venue, cancelled, ...ev } = v.e;
    out.push(ev);
  }
  out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // derive venue registry from surviving events
  const venues = new Map();
  for (const e of events) {
    if (!venues.has(e.venueId) && e._venue?.name) {
      const cv = canonVenue(e._venue.name, e._venue.postcode);
      const canonical = cv.id !== slugify(e._venue.name); // matched the canon table
      venues.set(e.venueId, {
        id: e.venueId,
        name: canonical ? cv.name : e._venue.name,
        postcode: canonical ? cv.postcode : e._venue.postcode,
        address: (canonical ? cv.address : e._venue.address) || null,
      });
    }
  }

  const feed = {
    version: 1,
    generated: new Date().toISOString(),
    region: 'SO14–SO53',
    note: 'Listings aggregated from public venue pages and ticket outlets. Always confirm with the venue.',
    sources,
    venues: [...venues.values()],
    events: out,
  };

  const { writeFileSync, readFileSync, existsSync } = await import('node:fs');
  writeFileSync(OUT, JSON.stringify(feed, null, 1));
  console.log(`\nwrote ${OUT}: ${out.length} events, ${venues.size} venues, ${sources.filter((s) => s.ok).length}/${sources.length} sources ok`);

  // Refresh the real-data snapshot bundled inside index.html, so the app
  // boots on genuine listings even before its network fetch completes.
  const INDEX = new URL('./index.html', import.meta.url).pathname;
  if (existsSync(INDEX)) {
    const html = readFileSync(INDEX, 'utf8');
    const payload = JSON.stringify(feed).replace(/<\//g, '<\\/');
    const updated = html.replace(
      /(<script id="feedSnapshot" type="application\/json">)[\s\S]*?(<\/script>)/,
      (_, a, b) => a + payload + b
    );
    if (updated !== html) {
      writeFileSync(INDEX, updated);
      console.log('refreshed bundled snapshot in index.html');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

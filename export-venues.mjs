#!/usr/bin/env node
/* SOUTHAMPTON.LIVE — venue export for the photo collection (task T13).
   One row per venue with at least one upcoming listing, from events.json.
   Facts from the robot only; the right-hand columns are for Mark to fill.
   Run: node export-venues.mjs  → writes venues-export.csv next to events.json */
import { readFileSync, writeFileSync } from 'node:fs';

const feed = JSON.parse(readFileSync(new URL('./events.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const SRC = { skiddle: 'Skiddle', songkick: 'Songkick', fatsoma: 'Fatsoma', thebrook: 'the-brook.com', mayflower: 'Mayflower', mitc: 'Music in the City', ticketmaster: 'Ticketmaster', community: 'community' };
const byVenue = new Map();
for (const e of feed.events || []) {
  if (!e.date || e.date < today) continue;
  const v = byVenue.get(e.venueId) || { count: 0, sources: new Set() };
  v.count++; v.sources.add(SRC[e.source] || e.source); byVenue.set(e.venueId, v);
}
const rows = (feed.venues || [])
  .filter((v) => byVenue.has(v.id))
  .map((v) => ({ v, ...byVenue.get(v.id) }))
  .sort((a, b) => b.count - a.count || a.v.name.localeCompare(b.v.name));

const csvCell = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const header = ['venue name', 'slug', 'address', 'postcode', 'upcoming count', 'source(s)', 'claimed? (y/n)', 'contact', 'asked (date)', 'photo received', 'rights line received (date)', 'uploaded'];
const lines = [header.map(csvCell).join(',')];
for (const r of rows) {
  lines.push([r.v.name, r.v.id, r.v.address || '', r.v.postcode || '', r.count, [...r.sources].sort().join(' / '), '', '', '', '', '', ''].map(csvCell).join(','));
}
writeFileSync(new URL('./venues-export.csv', import.meta.url), '﻿' + lines.join('\r\n') + '\r\n');
console.log(`venues-export.csv: ${rows.length} venues with upcoming listings (generated ${today})`);

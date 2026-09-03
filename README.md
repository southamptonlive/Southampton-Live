# SO:LIVE — Southampton's gig guide (SO14–SO53)

A single-file, mobile-first gig guide for Southampton with **real listings**
aggregated from public venue pages and ticket outlets.

## The pieces

| File | What it is |
|---|---|
| `index.html` | The whole app. Compiled Tailwind inlined, no build step, no framework. |
| `events.json` | The listings feed the app loads. Regenerate any time. |
| `build-events.mjs` | Zero-dependency Node scraper/aggregator that writes `events.json`. |
| `refresh-listings.yml` | GitHub Actions workflow: rebuilds the feed every 3 h and deploys to Pages. |

## How the data works

```
venue sites + ticket outlets ──► build-events.mjs ──► events.json ──► index.html
        (scrape/parse)            (normalise, dedupe,     (static      (fetches on load
                                   SO14–SO53 filter)       file)        + every 15 min)
```

`node build-events.mjs` fetches, in order, with polite pacing and retries:

- **Skiddle venue pages** (server-rendered JSON): Engine Rooms, Suburbia,
  The Joiners, The 1865, Papillon, The Attic (Totton), The Loft
- **Skiddle city pages** (`/gigs/Southampton/`, `/clubs/Southampton/`) —
  featured sets, filtered to SO postcodes
- **The Brook** (`the-brook.com`) — parsed from its event cards, including
  cross-listed shows it hosts for sister venues (rerouted to the right venue)

Each event is normalised to one shape (artist, venue, postcode, date, doors
time, price, genre, poster image, ticket link, description, min-age, source),
deduplicated across sources, filtered to **future events in SO14–SO53 only**,
and date-sorted. Venue name variants ("EngineRooms", "The Engine Rooms"…)
are merged into canonical venues.

The app contains **no demo or placeholder content** — every event shown is a
real listing. The builder bundles the latest `events.json` directly into
`index.html` as a snapshot, so the guide boots on genuine data instantly,
even opened straight from disk. It then fetches `events.json` on load and
every 15 minutes, replacing the snapshot whenever fresher data is available.

Honesty states in the header: green **LIVE IN SO** when data is under 24 h
old; amber pulse plus an in-feed banner when it's older ("last updated X —
double-check with the venue"); **LISTINGS OFFLINE** with a retry button only
if there is no usable data at all. Stale real data beats invented data;
invented data is never shown.

## Run it

```bash
node build-events.mjs        # writes a fresh events.json (Node 18+)
python3 -m http.server 8000  # any static server; then open http://localhost:8000
```

Deploy: push all four files to a GitHub repo, move `refresh-listings.yml` to
`.github/workflows/`, enable Pages → the site self-refreshes every 3 hours.
Any other static host works too — just re-run the builder on a schedule
(cron, systemd timer, Cloudflare Worker cron, …).

## The guide pattern

The feed follows the Headfirst model: a dense chronological list under sticky
day headers — square flyer thumbnail, title, coloured event-type ("Gig — The
Joiners"), time · postcode · price, a two-line description, and fine-grained
tags. Event type (gig / club / comedy / more) is a separate axis from genre,
inferred by the builder from ticket-outlet metadata, and surfaces as top-level
tabs. "SELLING FAST" ribbons come from Skiddle's real hot-seller flag — never
invented. Filters are never hidden behind a modal: on desktop a persistent
sidebar (When / Where in SO / Venue with live counts / Sound) sits beside the
feed and stays visible while scrolling; on mobile every chip lives inline in
one horizontally scrolling rail with group labels. A month calendar (Dates tab) shows per-day event counts; every
event, day, and view is deep-linkable (`#/e/<id>`, `#/day/<iso>`,
`#/weekend`, `#/tonight`, `#/venue/<id>`, `#/type/<t>`) and events carry a
Share action.

## Content rights

The guide keeps the *facts* (artist, venue, postcode, date, time, price,
ticket link) — facts are not copyright-protected. It does not display images
or promoter descriptions from sources without a licence or written permission:
Songkick and Fatsoma media is stripped at build time; Music in the City images are shown with the organisers''s written permission (granted 3 Sept 2026) (the app renders its own
generated poster art instead), pending permission requests. The scraper
identifies itself honestly as `SotonLive/1.0 (+https://southampton.live)`, is
paced politely, and never evades blocks — a source that blocks the bot is
declining, and carry-forward preserves previously published facts instead.
Every listing credits and links its source. Rights-holders can have content
credited differently or removed via hello@southampton.live (see terms). The
strategic direction is licensed feeds (Ticketmaster ✓ keyed, Skiddle API
migration planned) and venue-direct permission.

## Coverage strategy (vs. Visit Southampton)

Visit Southampton runs on the Simpleview tourism DMS: venues and promoters
self-submit listings to the council's platform. We don't touch their site —
instead we aggregate the public sources those same venues actually publish to.
The umbrella source is **Songkick's Southampton metro-area pages** (structured
schema.org MusicEvent JSON-LD with venue name, full postcode, geo, start time
and artist — paginated, ~460 events), layered over the Skiddle venue/city
scrapes and The Brook's own site. Fuzzy dedupe (name + date + district,
preferring records with ticket links and artwork) merges overlaps, and the
venue canon normalises name variants. This took the guide from 160 events at
11 venues to ~554 events at 38 venues — including The 1865 (2 → 115),
Heartbreakers (1 → 48), The Joiners (4 → 37), plus O2 Guildhall, Mayflower
Theatre, Turner Sims and the wider SO14–SO53 patch. **Fatsoma** — the student/promoter club-night outlet — is pulled from its
public JSON:API: ~270 in-patch events
gated by the postcode inside each venue's address, with fee-inclusive prices
(the only source that includes fees), category-driven typing, posters and
promoter descriptions. A **Ticketmaster Discovery** adapter ships key-gated:
set `TM_API_KEY` (free at developer.ticketmaster.com) in the workflow secrets
to add O2 Guildhall-tier listings; without a key it's a clean no-op.
Seetickets and TicketWeb remain bot-walled (403/506) and are documented as
infeasible rather than faked. **Music in the City** — Southampton's free two-day city-wide festival — is
scraped from musicinthecity.org's own full-listings page: every set, with real
times, venue postcodes taken from the page itself, and Free labelling sourced
from the festival's own description. Festival sets are exempt from fuzzy
dedupe so an act's festival slot never swallows a separate ticketed gig the
same day. Sunday's pane goes live automatically once the festival publishes
it. Songkick listings without
a published start time show "TBC" — times are never invented. WeGotTickets was
evaluated and dropped (its Southampton search yields county-wide noise with
almost no unique in-patch events). Still not feasible: venue sites behind
bot-blocking (Joiners' vticket, The 1865's own site, Seetickets) and closed
social APIs. The last residual gap vs. Visit Southampton is structural: a
handful of listings (e.g. DIY pub shows at The Hobbit, or tribute nights whose
only public record is the council DMS) exist solely as venue self-submissions
to Simpleview and appear on no scrapeable outlet at all — the honest counter
is this app's own submit-a-gig plus venues submitting here directly. Note also
that Visit Southampton's headline counts include surrounding towns and
multi-week date-range cards, so raw totals aren't comparable; this guide holds
850+ individually dated, postcode-verified events.

## Price honesty

Skiddle's listing feed exposes a `{minPrice, maxPrice}` pair covering all
ticket tiers — including sold-out early birds — and excludes booking fees.
Displaying the minimum as "the price" is systematically misleading, so the app
never does: tiered events show the full advertised range ("£10–£17.50")
everywhere a price appears, single prices show as-is, unknown prices show
"TICKETS" (never a number), and the event view discloses "advertised price —
booking fees may be added at checkout". FREE appears only when the entire
range is zero — a "£0–£3" night is shown as exactly that. All of this is
enforced by tests.

## AI genre classification (the knowledge layer)

Ticket outlets expose **no genre data** — Skiddle's listing JSON has images,
prices and dates but nothing about what the music is. Keyword scanning of the
event name/description works for "Jungle Cakes" but not for "KRS-One": knowing
an artist's genre requires knowledge, not pattern-matching. So the pipeline has
a knowledge layer: `genre-overrides.json`, a cache of artist-level corrections
(lowercase name-substring → genre and optionally type) that `build-events.mjs`
applies after every scrape. It ships seeded from an AI review of the full
current listings. For future artists the cache doesn't know,
`classify-events.mjs` runs after the build in CI: it finds events that matched
no genre keyword, asks Claude (claude-haiku-4-5) to classify them from artist
knowledge, appends the answers to the cache, and patches events.json plus the
bundled snapshot in the same run. Set `ANTHROPIC_API_KEY` in the repo secrets
to enable it; without the key the step is a clean no-op and the seeded cache
still applies. Each artist is classified once, ever — the cache is committed.

## Profile, follows & the launch path

The Profile tab is a real local account: display name (shared with the scene
board), home district, stats, follows management, reminders, and portability.
**Follows**: heart any venue (venue cards or event view) or any act (event
view); followed events surface in a personalised "From who you follow" section
at the top of What's On. **Reminders**: opt-in browser notifications fire
day-before and show-day alerts for going/saved gigs while the app is open or
installed; every event also has a Calendar button producing an .ics file with
a built-in 3-hour-before alarm — reminders that work everywhere with no
server. **Portability**: Export/Import moves the whole profile between devices
today, and the exported JSON is the exact shape a sync backend will consume.
**Claims**: the "Are you a venue / artist?" card emails profile claims to
`CONTACT.claimEmail` — set it before launch.

What genuinely needs a backend (do not fake these): signup/login and
cross-device sync, push notifications to a closed app, verified claim
handling, and follower counts. Fastest honest path for a Sept 11 launch:
Supabase (auth + Postgres + row-level security) with the exported-profile JSON
as the sync payload, Firebase Cloud Messaging for push, and app-store presence
via a Trusted Web Activity (Android) and Capacitor wrapper (iOS) around this
PWA — realistic for Android by the 11th; Apple review timing makes iOS tight,
so launch web + Play Store first. The client is already structured for all of
it.

## Marketing banner

A full-width advert slot sits at the very top of the page, above the sticky
header, so it scrolls away and never eats browsing space. Configure it via the
`AD_BANNER` constant at the top of the app script: set `desktopImg` (970×90 or
728×90) and optionally `mobileImg` (320×100 or 320×50) plus the campaign
`href` and `alt` text. The creative is served responsively via `<picture>`,
links carry `rel="sponsored noopener"`, and a small AD tag keeps the placement
transparent. With no creative configured, the slot shows a house placeholder
advertising the space itself; set `enabled: false` to remove it entirely.

## Design system

Black canvas, white content cards, hot pink `#FF2D87` primary with red `#FF3B30`
and orange `#FF7A00`; blue `#4DA8FF` and mint `#2EE6A8` as supporting accents
(mint is reserved for FREE / live-status). Anton for condensed display
headlines, Archivo Black for titles, Space Grotesk for UI. Cards are
artwork-first: the real flyer fills the media area with minimal overlay
badges, and a generated duotone poster takes over only when a listing has no
image or it fails to load. One compact filter rail sits under the slim header;
the full filter set (date, district, venue, sound) lives in a bottom sheet.

## Honest limitations

- **"Real-time" means scheduled aggregation.** These sources offer no push
  API; 3-hourly rebuilds plus the app's 15-minute refetch is the practical
  ceiling without paid ticketing APIs.
- **Social media isn't a source.** Instagram/Facebook removed public event
  API access years ago and prohibit scraping — venue sites and ticket
  outlets carry the same events legitimately.
- **Heartbreakers has no scrapeable listings** (their outlets block
  automated clients), so they only appear via cross-listings on other
  sources. The Joiners' own ticket site also blocks bots; their Skiddle
  presence is partial, so Joiners coverage is incomplete.
- **Go Southampton / Visit Southampton** render their event listings
  client-side with no server-rendered data or public API, so they can't be
  scraped statically. Their editorial pages informed the venue list instead.
- **Scrapers rot.** If a source changes markup, its parser fails soft —
  the build reports it in `sources[]`, the rest of the feed still ships,
  and the app keeps working on the last good data (fetched or bundled).
- Listings are aggregated from third parties: prices and times can change,
  so the app links every event back to its source and says so in the modal.

## User data

RSVPs, saved gigs, submitted events and scene-board posts live in the
visitor's own `localStorage` only. Nothing is sent anywhere.

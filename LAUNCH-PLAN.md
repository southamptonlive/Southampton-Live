# Soton Live — Launch Plan v2
### Tonight (Tue 2 Sept) → Launch (Thu 11 Sept) · Web launch WITH accounts live
### Writes gated · reads open · contextual signup · tiered verification · moderation from day one

**Strategic spine:** Music in the City (237 free sets, 38 venues) is Sat 12 Sept —
the day after launch. Soton Live holds the only filterable full timetable. Every
piece of marketing points at it. Launch evening message: "Tomorrow: 237 free
sets. Plan your route."

**Hard rule carried into everything below:** reading the guide never requires an
account. Signup appears only at the moment of a write (post, submit, claim,
follow-sync), attached to the user's own motivation.

---

## Architecture (uses what you've already paid for)

- **Domain — 123-reg (paid).** DNS A record → SiteGround IP; free Let's Encrypt
  SSL activated in SiteGround. HTTPS is mandatory (share links, notifications,
  PWA install).
- **Web host — SiteGround (paid).** Serves the static site: `index.html`,
  `events.json`, `logo.png`, privacy/about pages. Note: SiteGround shared
  hosting doesn't run Node, so it does NOT run the scraper — it only serves
  files, which it does well.
- **Build brain — GitHub Actions (free).** The existing 3-hourly workflow keeps
  doing the heavy lifting: scrape all sources → AI-classify new artists →
  rebuild `events.json` + snapshot → then a new final step deploys to
  SiteGround over FTPS/SSH (SiteGround provides credentials; the standard
  `SamKirkland/FTP-Deploy-Action` does this in ~6 lines). Result: the site on
  SiteGround self-refreshes every 3 hours forever.
- **Accounts & user data — Supabase (free tier), created in the London or
  Ireland region** for UK/EU data residency. The static site talks to it
  directly from the browser via the Supabase JS SDK — this is Supabase's
  intended model; no server of your own.
  - **Auth:** magic-link email login (no passwords ever stored, fewer support
    headaches, smallest attack surface). Signup = enter email → click link →
    choose handle + home district. That's the whole "Facebook-style" flow.
  - **Tables:** `profiles` (id, handle, district, created_at) ·
    `follows` (user, kind, target) · `saves` (user, event_id, going/saved) ·
    `submissions` (user, event fields, status: pending/approved/rejected) ·
    `posts` + `comments` (scene board, status) · `claims` (user, kind, target,
    evidence_url, status).
  - **Row-Level Security on everything:** users read public rows, write only
    their own; only approved submissions/posts are publicly readable.
  - **Moderation queue, day one, zero build:** pending rows are approved or
    rejected directly in Supabase Studio (their admin dashboard) from your
    laptop or phone. A dedicated admin UI can come later.
  - **Tiered verification:** verified email → can post + follow-sync;
    submissions always land as *pending* and show a "community — awaiting
    verification" badge if surfaced pre-approval; venue/artist claims require
    evidence (link from official site/social, or email from the venue's own
    domain) checked by you before approval.
- **Optional API keys (repo secrets, both free to obtain):**
  `TM_API_KEY` — Ticketmaster Discovery (free tier: 5,000 calls/day; the
  build uses ~40/day) adds O2 Guildhall-tier listings. `ANTHROPIC_API_KEY` —
  auto-classifies new artists' genres (pennies/month). Seetickets/TicketWeb
  remain bot-walled; Skiddle, Songkick, Fatsoma, Brook, MITC, Mayflower need
  no keys and are already live.
- **Feature flag:** `ACCOUNTS_LIVE = true/false` in the app config. If false,
  write actions show "Accounts land this week" instead of the signup sheet.
  This is the safety valve for the Sept 8 decision gate below.

---

## Day by day

### Tonight — Tue 2 Sept · Infrastructure night
- [ ] 123-reg: point DNS at SiteGround. SiteGround: enable SSL, upload current
      site files — **the guide is live on your domain tonight**, pre-announcement.
- [ ] GitHub repo: push everything; add the SiteGround FTPS/SSH deploy step to
      the workflow; add secrets (`FTP_*`, optionally `TM_API_KEY`,
      `ANTHROPIC_API_KEY`). Confirm one full auto cycle: scrape → commit →
      deploy to SiteGround.
- [ ] Create the Supabase project (London/Ireland region). Note the URL and
      anon key. Register for a Ticketmaster developer key (instant).
- [ ] Set `CONTACT.claimEmail` (123-reg email forwarding on the domain).

### Wed 3 Sept · Backend schema + policies
- [ ] Create the six tables + Row-Level Security policies (SQL in the Supabase
      dashboard; half a day with the schema above).
- [ ] Configure magic-link auth: sender name, email template, redirect URL to
      your domain. Free tier's built-in auth email is rate-limited — connect
      Resend's free tier (3,000/month) as custom SMTP so launch-day signups
      don't throttle.
- [ ] ICO registration (data protection fee, ~£40–60/yr) — legally required
      once you hold account data. Ten minutes online.

### Thu 4 – Fri 5 Sept · Client integration (the big build)
- [ ] Wire the Supabase SDK into the app behind the `ACCOUNTS_LIVE` flag:
      contextual signup sheet on first write; session handling; profile
      (handle + district) synced; follows/saves/going sync up (localStorage
      remains the offline cache — existing local data migrates up on first
      login, so early users lose nothing).
- [ ] Scene board reads approved posts for everyone; writes require login.
      Gig submissions → `submissions` pending. Claims → `claims` pending with
      an evidence field.
- [ ] Account deletion button on Profile (GDPR right, and Apple requires it
      later anyway): deletes auth user + rows. The existing Export button
      already satisfies data portability.
- [ ] Publish the privacy policy + terms (min. age 13, moderation rules) and
      link them from the signup sheet.

### Sat 6 – Sun 7 Sept · Integration testing + soft launch
- [ ] Full device pass (real iPhone + Android): signup, magic link opening in
      mobile email apps, post, submit, claim, follow-sync across two devices,
      delete account, re-signup.
- [ ] Soft launch to 15–30 friendlies **with accounts on**: real handles, real
      threads on the board, real submissions through the moderation queue.
      Practise approving from Supabase Studio on your phone.
- [ ] Accuracy sprint in parallel: spot-check 30 listings vs sources.
- [ ] Venue outreach round 1: "You're already listed with N events — claim
      your profile." Now backed by a real claims flow.

### Mon 8 Sept · **DECISION GATE** + press
- [ ] **Gate:** Is auth solid from the weekend? YES → accounts stay on for
      launch. NO → flip `ACCOUNTS_LIVE=false`, launch the guide anyway,
      enable accounts the following week. The 11th is protected either way.
- [ ] Press + partners: Daily Echo, In Common, Wessex Scene/SUSU media, and
      Music in the City organisers (show them their programme, ask for a
      launch-day share).
- [ ] Schedule launch content; secure social handles if not already.

### Tue 9 Sept · Freeze
- [ ] Feature freeze. Final device pass, Lighthouse check, verify the 3-hourly
      cycle has been flawless all week, dry-run the moderation flow once more.

### Wed 10 Sept · Buffer
- [ ] Fix-only day. Uptime alerts to your phone. Nothing new ships.

### Thu 11 Sept · LAUNCH
- [ ] Morning: posts live, community groups, venue reposts. Watch signups land
      in Supabase; approve submissions same-hour to set the tone.
- [ ] Evening: "Tomorrow: Music in the City — 237 free sets. Plan your route."
      → straight into the 12 Sept day view.

### After launch (in order)
1. Play Store TWA wrapper of the live URL (2–4 days incl. review).
2. Push notifications (FCM) — follows and reminders while the app is closed.
3. iOS via Capacitor (account deletion already shipped, so Apple-ready).
4. Weekly mailer (Resend covers this too; strictly opt-in, own checkbox).
5. Admin moderation UI when Supabase Studio stops being comfortable.

---

## Costs — what user data & profiles actually cost you

**Per-user footprint:** a profile row + follows + saves ≈ **2–5 KB**. Supabase's
free 500 MB database holds on the order of **100,000 users** of this shape.
User data at your scale is effectively free; the costs are fixed platform fees.

| Item | Launch (£/mo) | At ~10k users (£/mo) | Notes |
|---|---|---|---|
| Domain (123-reg) | paid | paid | already yours |
| Hosting (SiteGround) | paid | paid | serves static files only |
| GitHub Actions (scraper + deploy) | £0 | £0 | free for public repos |
| Supabase (auth + DB, London) | £0 | ~£20 (Pro $25) | free tier: 50k monthly active users, 500MB DB. Caveat: free projects pause after ~1 week of zero traffic — real usage prevents it; Pro removes it and adds daily backups |
| Auth/mailer email (Resend) | £0 | £0–16 | free 3,000/mo; ~$20 tier beyond |
| Ticketmaster Discovery API | £0 | £0 | free 5,000 calls/day; build uses ~40 |
| Anthropic classifier | ~£0.30 | ~£0.50 | Haiku, one small batch per build day |
| Push (Firebase FCM) | £0 | £0 | free at any realistic scale |
| ICO data-protection fee | ~£3.50 (annual £40–60) | ~£3.50 | legally required with accounts |
| Analytics (cookie-free) + UptimeRobot | £0 | £0 | no consent banner needed |
| **Total new spend** | **≈ £4/month** | **≈ £25–40/month** | |

## GDPR position

UK GDPR applies. You hold: email, handle, chosen district, follows/saves,
posts — minimal by design (no real names required, no location tracking, no
cookies, no ad trackers). Covered in-plan: ICO registration (Wed 3), privacy
policy + terms at signup (Fri 5), lawful bases (contract for the account
itself; separately-captured consent for any mailer), UK/EU data residency
(Supabase London), processors under their standard DPAs (Supabase, Resend,
later Google/FCM), right to erasure via the in-app delete button, portability
via the existing export, breach route = ICO within 72 hours. Keep the ad
banner a static image + link — the day a third-party tracking script goes in
that slot, consent banners become legally required. Don't.

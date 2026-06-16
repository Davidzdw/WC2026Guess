# WC2026Guess Project Context

This file is a handoff note for continuing development on another device.

## What This App Is

`WC2026Guess` is a lightweight World Cup prediction app for a private WeChat group.

The app now supports multiple independent prediction rooms (`pool`s), so different WeChat groups can play in parallel without mixing users, predictions, settlements, or stake amounts.

Users:
- open a link
- enter a name once
- predict match result before lock
- view results and settlement after matches finish

Admin:
- updates app settings
- syncs schedule/results from NetEase
- settles matches
- manages users
- reviews user prediction activity

## Current Hosting

- Production domain: `https://wc2026guess.xyz`
- Admin page: `https://wc2026guess.xyz/admin`
- Cloudflare Pages project: `wc2026guess`
- Cloudflare D1 database:
  - name: `wc2026guess`
  - binding: `DB`
  - id: `4a437792-f2ca-4877-95c0-0515bd76b5c3`

The repo is configured for Cloudflare Pages + Pages Functions + D1.

## Multi-Pool Model

- Each prediction activity is a `pool`.
- The original existing data was preserved and migrated into the default pool:
  - pool id: `pool_default`
  - pool slug: `main`
- Match schedule is shared globally across all pools.
- These are isolated per pool:
  - users
  - predictions
  - settlements
  - leaderboard
  - daily transfer summary
  - stake amount
  - lock minutes
  - max users
- New pool entry URLs use the query string:
  - default room: `https://wc2026guess.xyz/`
  - other rooms: `https://wc2026guess.xyz/?pool=room-slug`

## Current Product Rules

- Users are identified by a browser-local `userId` stored in `localStorage`.
- The `localStorage` key is now namespaced by pool slug, so the same device can participate in different rooms without account collision.
- This means the same person opening in WeChat browser and Safari will be treated as two users.
- Group stage supports `主胜 / 平 / 客胜`.
- Knockout stage supports `主胜 / 客胜`.
- Default stake is configurable, currently managed in admin.
- Prediction lock is configurable, default was built around 60 minutes before kickoff.
- Only matches that already happened or will start within the next 24 hours are shown on the main page.
- The backend also blocks predictions for matches more than 24 hours away.
- Everyone can immediately see everyone else's picks after a prediction is submitted.
- After settlement:
  - wrong picks lose stake
  - wrong-pick pool is split evenly among correct picks
  - if everyone is wrong, the match is void

## Score / Sync Strategy

- The app does not use real-time score updates for user-facing live scoring.
- NetEase is used as the schedule/result source.
- Auto-sync is conservative:
  - it checks on an interval
  - it only calls NetEase when there is at least one unsettled match that should already be finished
- This was intentionally changed to avoid unnecessary repeated API calls.

## Important UI Behavior

### Main user page

- All visible matches are on one page.
- No date dropdown for matches.
- Page anchors to today's match section on load.
- Past matches remain visible.
- Future matches beyond 24 hours are hidden.
- Pick status is visually shown:
  - correct
  - wrong
  - void
- Settlement amount is shown next to the user's pick result.
- Public pick groups are visible for each match.

### Admin page

The admin page currently includes:

- room selector
- room link copy
- create new room
- app title
- current room name
- stake amount
- lock minutes
- max users
- auto-sync toggle
- auto-sync interval
- manual NetEase sync
- manual settlement
- user management
  - rename user
  - remove user
  - view prediction count
- user prediction overview
  - grouped by user
  - shows what each user picked
  - shows settlement status and amount when available
- all of the above user/prediction data is scoped to the currently selected room

## User Management Logic

- Max users is enforced on the backend.
- Existing users can still update their own name even if the app is full.
- Removing a user deletes:
  - the user row
  - that user's predictions
- Removing a user does not rewrite historical settlement records that already exist.

## Important Files

- [README.md](C:/Users/ShanKai/Projects/WC2026Guess/README.md)
  General setup and deployment notes.
- [PROJECT_CONTEXT.md](C:/Users/ShanKai/Projects/WC2026Guess/PROJECT_CONTEXT.md)
  This handoff note.
- [public/index.html](C:/Users/ShanKai/Projects/WC2026Guess/public/index.html)
  Main app entry.
- [public/app.js](C:/Users/ShanKai/Projects/WC2026Guess/public/app.js)
  Main user-facing app logic.
- [public/admin.html](C:/Users/ShanKai/Projects/WC2026Guess/public/admin.html)
  Admin page entry.
- [public/admin.js](C:/Users/ShanKai/Projects/WC2026Guess/public/admin.js)
  Admin page logic.
- [public/styles.css](C:/Users/ShanKai/Projects/WC2026Guess/public/styles.css)
  Shared styles.
- [functions/api/[[path]].js](C:/Users/ShanKai/Projects/WC2026Guess/functions/api/[[path]].js)
  Pages Function API and business logic.
- [wrangler.toml](C:/Users/ShanKai/Projects/WC2026Guess/wrangler.toml)
  Cloudflare Pages + D1 config.
- [wrangler.sync.toml](C:/Users/ShanKai/Projects/WC2026Guess/wrangler.sync.toml)
  Optional scheduled sync worker config.
- [migrations/0004_multi_pool.sql](C:/Users/ShanKai/Projects/WC2026Guess/migrations/0004_multi_pool.sql)
  Migration that introduces pools and preserves old data in the default room.
- [migrations](C:/Users/ShanKai/Projects/WC2026Guess/migrations)
  D1 migrations.

## Local Development Notes

- Preferred working directory:
  `C:\Users\ShanKai\Projects\WC2026Guess`
- Avoid running npm installs from Google Drive synced folders if possible.
- Common commands:

```powershell
npm install
npm run dev
npm run db:migrate:local
npm run db:migrate:remote
npx wrangler pages deploy public --project-name wc2026guess --commit-dirty=true
```

## Secrets / Non-Committed Items

Do not commit secrets.

Important local-only items include:
- `ADMIN_KEY.txt`
- `.dev.vars`
- any real admin secrets

## Recent Notable Changes

Recent development included:

- Cloudflare Pages deployment setup
- D1 integration and migrations
- post-match sync strategy instead of frequent polling
- all matches rendered on one scroll page
- anchor to today's section
- custom domain use on `wc2026guess.xyz`
- admin user management
- admin user prediction overview
- 24-hour visibility window for future matches
- immediate public visibility of all picks
- multi-pool support with preserved legacy data in the default room
- per-room amount / lock / max-user management
- per-room links using `?pool=...`

## If Continuing On Another Device

Recommended flow:

1. Clone the repo.
2. Run `npm install`.
3. Log in with `wrangler`.
4. Add local secrets such as `.dev.vars`.
5. Run `npm run dev`.
6. If changing database behavior, apply the needed D1 migrations.

If production changes are needed:

1. Commit locally.
2. Push to GitHub.
3. Deploy with Wrangler if not using an automated deployment path.

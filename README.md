# 2026 World Cup WeChat Pool

A simple Cloudflare-hosted World Cup prediction pool for a private WeChat group.

The app now supports multiple independent rooms (`pool`s), so different WeChat groups can play in parallel.

## Stack

- Cloudflare Pages for static HTML/CSS/JS.
- Cloudflare Pages Functions for `/api/*`.
- Cloudflare D1 for users, matches, predictions, settings, and settlements.
- NetEase's World Cup page API is used only to sync schedule updates and completed scores.

## Rules

- Users enter a display name once. The browser stores a local user id, so they do not need to log in again on the same phone.
- User identity is now stored per room, so the same device can join multiple rooms independently.
- Predictions lock before kickoff. The default lock window is 60 minutes.
- Group-stage matches allow `主胜 / 平 / 客胜`.
- Knockout matches allow only `主胜 / 客胜`.
- The default stake is 10 RMB per prediction.
- After a match is settled, incorrect predictions lose their stake. The losing pool is split evenly among correct predictions.
- If everyone who predicted is wrong, the match is void.
- The app only records predictions and settlement suggestions. It does not process payments.

## Rooms

- Default room: `https://wc2026guess.xyz/`
- Additional rooms: `https://wc2026guess.xyz/?pool=room-slug`
- Rooms share the same World Cup schedule, but users, predictions, settlement, and stake settings are isolated per room.

## Cloudflare Setup

Install dependencies after cloning:

```powershell
npm install
```

Log in to Cloudflare:

```powershell
npx wrangler login
```

Create the D1 database:

```powershell
npx wrangler d1 create wc2026guess
```

Copy the returned `database_id` into `wrangler.toml`.

Create a local admin key for development:

```powershell
"ADMIN_KEY=change-this-to-a-long-random-password" | Out-File -Encoding utf8 .dev.vars
```

Apply the schema and seed data locally:

```powershell
npm run db:migrate:local
```

Run locally:

```powershell
npm run dev
```

Open:

- User page: `http://localhost:8788`
- Admin page: `http://localhost:8788/admin`

## Deploy

Apply migrations to the remote D1 database:

```powershell
npm run db:migrate:remote
```

Deploy Pages:

```powershell
npx wrangler pages deploy public --project-name wc2026guess --commit-dirty=true
```

Set or rotate the production admin key:

```powershell
npx wrangler pages secret put ADMIN_KEY --project-name wc2026guess
```

Redeploy after changing secrets:

```powershell
npx wrangler pages deploy public --project-name wc2026guess --commit-dirty=true
```

## Daily Operations

- Automatic sync is conservative: the cron Worker checks once per hour, and the app calls NetEase only if at least one unsettled match should already be finished.
- The admin page can manually sync NetEase and manually settle completed matches.
- The statistics page nets all settled matches for a China-date and generates a minimal transfer list, for example:

```text
Alice -> Bob: 20.00 元
Chen -> Dana: 10.00 元
```

Use the `复制通知` button to paste the settlement message into WeChat.

## Optional Cron Sync

Cloudflare Pages Functions do not run on a schedule by themselves. The repo includes a tiny Worker that calls the app's protected auto-sync endpoint once per hour. The endpoint still checks whether a match should already be finished before it calls NetEase.

After the Pages URL is live, update `SITE_ORIGIN` in `wrangler.sync.toml` if your Pages URL is not `https://wc2026guess.pages.dev`.

Set the same admin key on the cron Worker:

```powershell
npx wrangler secret put ADMIN_KEY --config wrangler.sync.toml
```

Deploy the cron Worker:

```powershell
npx wrangler deploy --config wrangler.sync.toml
```

## Files

- `functions/api/[[path]].js`: Cloudflare Pages Function API, settlement logic, NetEase sync.
- `migrations/0001_init.sql`: D1 schema and initial China-time schedule seed.
- `public/index.html`: user-facing app.
- `public/admin.html`: admin page.
- `workers/sync.js`: optional hourly cron Worker for unattended post-match sync.
- `worldcup_2026_schedule_cn.csv`: source schedule CSV used to generate the migration seed.

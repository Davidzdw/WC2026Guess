# 2026 World Cup WeChat Pool

A simple Cloudflare-hosted World Cup prediction pool for a private WeChat group.

## Stack

- Cloudflare Pages for static HTML/CSS/JS.
- Cloudflare Pages Functions for `/api/*`.
- Cloudflare D1 for users, matches, predictions, settings, and settlements.
- NetEase's World Cup page API is used only to sync schedule updates and completed scores.

## Rules

- Users enter a display name once. The browser stores a local user id, so they do not need to log in again on the same phone.
- Predictions lock before kickoff. The default lock window is 60 minutes.
- Group-stage matches allow `主胜 / 平 / 客胜`.
- Knockout matches allow only `主胜 / 客胜`.
- The default stake is 10 RMB per prediction.
- After a match is settled, incorrect predictions lose their stake. The losing pool is split evenly among correct predictions.
- If everyone who predicted is wrong, the match is void.
- The app only records predictions and settlement suggestions. It does not process payments.

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

Copy the returned `database_id` into `wrangler.toml`, replacing `replace-with-your-d1-database-id`.

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

Deploy once to create/update the Pages project:

```powershell
npm run deploy
```

Set the production admin key. If this is the first time you set the secret, deploy once more afterward so the Functions runtime sees it:

```powershell
npx wrangler pages secret put ADMIN_KEY --project-name wc2026guess
```

Redeploy:

```powershell
npm run deploy
```

You can also connect the GitHub repo to Cloudflare Pages. Use these build settings:

- Framework preset: `None`
- Build command: leave empty or use `npm install`
- Build output directory: `public`
- Functions directory: `functions`
- D1 binding variable name: `DB`
- Environment variable / secret: `ADMIN_KEY`

## Daily Operations

- The public app opportunistically syncs when a match should be finished or a knockout match is inside the configured lookahead window.
- The admin page can manually sync NetEase and manually settle completed matches.
- The statistics page nets all settled matches for a China-date and generates a minimal transfer list, for example:

```text
Alice -> Bob: 20.00 元
Chen -> Dana: 10.00 元
```

Use the `复制通知` button to paste the settlement message into WeChat.

## Files

- `functions/api/[[path]].js`: Cloudflare Pages Function API, settlement logic, NetEase sync.
- `migrations/0001_init.sql`: D1 schema and initial China-time schedule seed.
- `public/index.html`: user-facing app.
- `public/admin.html`: admin page.
- `worldcup_2026_schedule_cn.csv`: source schedule CSV used to generate the migration seed.

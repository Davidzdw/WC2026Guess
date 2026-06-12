# WC2026Guess Project Context

Last updated: 2026-06-12, Asia/Shanghai.

This document captures the working context from the Codex build/deploy session so development can continue from another device without needing the chat history.

## Product Goal

Build a simple WeChat-group prediction app for the 2026 FIFA World Cup.

User journey:

- A user receives a link in WeChat.
- They enter a display name once.
- The browser stores a local user id, so no repeated login is needed on the same device.
- Users can predict until the configured lock window before kickoff. Default: 60 minutes.
- After matches finish, the app shows results and daily settlement suggestions.

Prediction rules:

- Group stage supports `主胜 / 平 / 客胜`.
- Knockout stage supports only `主胜 / 客胜`.
- Default stake is 10 RMB per match.
- Wrong predictions lose the stake.
- The losing pool is split evenly among correct predictions.
- If everyone is wrong, the match is void / 流局.
- The app does not process payments. It only records predictions and produces WeChat-friendly transfer suggestions.

## Current Stack

- Cloudflare Pages hosts the static frontend in `public/`.
- Cloudflare Pages Functions serve `/api/*` from `functions/api/[[path]].js`.
- Cloudflare D1 stores settings, users, matches, predictions, and settlements.
- A small optional Cloudflare Worker in `workers/sync.js` runs on a cron schedule and calls the protected auto-sync endpoint.
- NetEase's World Cup page API is used to sync schedule updates and completed scores.

No framework is used. The frontend is plain HTML/CSS/JS, and the backend is plain Worker-compatible JavaScript.

## GitHub And Local Paths

GitHub repo:

- `https://github.com/Davidzdw/WC2026Guess`

Original Google Drive project path:

- `G:\我的云端硬盘\Fun project\WC2026Guess`

Recommended local development path on the current Windows machine:

- `C:\Users\ShanKai\Projects\WC2026Guess`

Reason for the local path:

- Running `npm install` inside the Google Drive synced directory produced many `TAR_ENTRY_ERROR`, `EBADF`, and file cleanup errors.
- The stable workflow is to develop and deploy from a normal local folder outside Google Drive.

## Deployed Cloudflare Resources

Pages project:

- Name: `wc2026guess`
- Production URL: `https://wc2026guess.pages.dev`
- User page: `https://wc2026guess.pages.dev`
- Admin page: `https://wc2026guess.pages.dev/admin`

D1 database:

- Database name: `wc2026guess`
- Binding used by code: `DB`
- Database ID: `4a437792-f2ca-4877-95c0-0515bd76b5c3`

Cron Worker:

- Name: `wc2026guess-sync`
- URL: `https://wc2026guess-sync.zhangdw.workers.dev`
- Schedule: every hour, `0 * * * *`
- Purpose: calls the configured `SITE_ORIGIN` admin auto-sync endpoint.
- The app only calls NetEase from auto-sync when at least one unsettled match should already be finished.
- `SITE_ORIGIN` currently uses `https://wc2026guess.xyz`.

Secrets:

- Pages secret: `ADMIN_KEY`
- Cron Worker secret: `ADMIN_KEY`
- Do not commit the actual value.
- On this machine only, the current admin key was saved to `ADMIN_KEY.txt`; it is intentionally ignored by git.

## Important Files

- `public/index.html`: user-facing page.
- `public/admin.html`: admin page.
- `public/app.js`: user page behavior.
- `public/admin.js`: admin page behavior.
- `public/styles.css`: shared styling.
- `functions/api/[[path]].js`: all app API routes, D1 data access, NetEase sync, settlement logic.
- `migrations/0001_init.sql`: D1 schema and initial 104-match China-time schedule seed.
- `workers/sync.js`: optional cron Worker that triggers auto-sync.
- `wrangler.toml`: Pages/D1 config.
- `wrangler.sync.toml`: cron Worker config.
- `worldcup_2026_schedule_cn.csv`: source schedule CSV.
- `fetch_wc_schedule.py`: helper used earlier to inspect/fetch the NetEase schedule.

## API Overview

Public routes:

- `GET /api/state?userId=...`: returns settings, user, users, matches, date list, daily summary, leaderboard.
- `POST /api/users`: creates/updates a user display name.
- `POST /api/predictions`: creates/updates a prediction before lock time.
- `GET /api/summary?date=YYYY-MM-DD`: returns daily settlements and minimal transfer suggestions.

Admin routes:

- All admin routes require header `x-admin-key: <ADMIN_KEY>`.
- `GET /api/admin/state`: returns state plus admin overview data.
- `POST /api/admin/settings`: updates stake, lock minutes, app title, auto-sync settings.
- `POST /api/admin/sync`: manually syncs NetEase schedule/results.
- `POST /api/admin/auto-sync`: conditionally syncs only when app logic says it is needed.
- `POST /api/admin/settle`: settles completed matches that are not already settled.

## Deployment Commands

Install dependencies:

```powershell
cd C:\Users\ShanKai\Projects\WC2026Guess
npm install
```

Log in to Cloudflare:

```powershell
npx wrangler login
```

Apply remote D1 migrations:

```powershell
npm run db:migrate:remote
```

Deploy Pages:

```powershell
npx wrangler pages deploy public --project-name wc2026guess --commit-dirty=true
```

Set or rotate the Pages admin secret:

```powershell
npx wrangler pages secret put ADMIN_KEY --project-name wc2026guess
```

Deploy cron Worker:

```powershell
npx wrangler secret put ADMIN_KEY --config wrangler.sync.toml
npx wrangler deploy --config wrangler.sync.toml
```

## Local Development

Initialize local D1:

```powershell
npm run db:migrate:local
```

Run local Pages dev:

```powershell
npm run dev
```

If local dev complains about `ADMIN_KEY`, create `.dev.vars`:

```powershell
"ADMIN_KEY=local-admin" | Out-File -Encoding utf8 .dev.vars
```

Local URLs:

- User page: `http://localhost:8788`
- Admin page: `http://localhost:8788/admin`

## Deployment Session Notes

What was done successfully:

- Created D1 database `wc2026guess`.
- Wrote the D1 database ID into `wrangler.toml`.
- Applied remote migration `0001_init.sql`; Wrangler reported 115 commands executed successfully.
- Created Cloudflare Pages project `wc2026guess`.
- Deployed the Pages app successfully.
- Set `ADMIN_KEY` on the Pages project.
- Redeployed Pages after setting the secret.
- Verified production homepage returns HTTP 200.
- Verified production `/api/state` returns HTTP 200 and D1-backed match data.
- Set `ADMIN_KEY` on the cron Worker.
- Deployed cron Worker `wc2026guess-sync`.
- Verified production `/api/admin/state` returns HTTP 200 when using the admin key.
- Later changed auto-sync to post-match only: no real-time score polling and no knockout pre-match polling.

Bug fixed during local verification:

- A `public/_redirects` file caused a `/admin` redirect loop in Wrangler local dev.
- The file was deleted and the fix was committed/pushed.

## Pricing Context

For the current small WeChat group usage, the project should stay within Cloudflare free limits.

Relevant Cloudflare free-plan limits checked on 2026-06-12:

- Workers/Pages Functions: 100,000 requests/day.
- Static asset requests: free and unlimited.
- D1: 5 million rows read/day, 100,000 rows written/day, 5 GB storage total.
- Cron Worker every hour is only 24 invocations/day.

If the Cloudflare account is upgraded to Workers Paid, it has a minimum monthly charge and overage billing. On the free plan, exceeding D1 daily limits should generally cause errors rather than automatic overage billing.

## Safety And Legal Notes

- The app uses NetEase's public World Cup page API for private, lightweight schedule/result sync.
- The app should avoid aggressive polling.
- Current logic syncs conservatively: the cron Worker checks hourly, and the app only calls NetEase after a match should have finished and still needs settlement.
- Estimated NetEase API calls for the whole tournament after this change are roughly 90-110, instead of several hundred.
- The app is for a private group and does not process real payments.
- Settlement output is informational; users manually transfer money in WeChat if they choose.

## Things To Improve Later

- Add an export/backup flow for D1 data before the tournament starts.
- Add an admin view for users and predictions by match.
- Add simple anti-duplicate-name handling if the group gets larger.
- Add a page showing exact match-level winners/losers.
- Consider a custom domain if sharing `pages.dev` is not ideal.
- Consider disabling the public `workers.dev` URL for the cron Worker if it is not needed.

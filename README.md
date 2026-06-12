# 2026 World Cup WeChat Pool

A simple local web app for a private World Cup prediction pool.

## Run

```powershell
npm start
```

Open:

- User page: `http://localhost:3000`
- Admin page: `http://localhost:3000/admin`

The server prints the admin key on startup. It is also stored in `db.json` under `settings.adminKey`.

## How It Works

- Users enter a display name once. The browser stores a local user id, so they do not need to log in again on the same phone.
- Predictions lock before kickoff. The default lock window is 60 minutes.
- Group-stage matches allow `主胜 / 平 / 客胜`.
- Knockout matches allow only `主胜 / 客胜`.
- The default stake is 10 RMB per prediction.
- After a match is settled, incorrect predictions lose the stake. The losing pool is split evenly among correct predictions.
- If everyone who predicted is wrong, the match is void.
- The app only records predictions and settlement suggestions. It does not process payments.

## Daily Settlement

The statistics page nets all settled matches for a China-date and generates the smallest practical transfer list, for example:

```text
Alice -> Bob: 20.00 元
Chen -> Dana: 10.00 元
```

Use the `复制通知` button to paste the settlement message into WeChat.

## Admin

The admin page can:

- Change the stake amount.
- Change the lock window.
- Turn automatic sync on or off.
- Change the automatic sync interval.
- Change how many hours before knockout matches the app checks the NetEase schedule.
- Manually sync the NetEase schedule and scores.
- Manually settle completed matches.

Automatic sync is intentionally light:

- Group stage: syncs after a match should have finished and has not been settled.
- Knockout stage: syncs within the configured pre-match window so team placeholders can update.
- Live matches: syncs while a match is in progress.

## Files

- `server.js`: Node server, API, settlement logic, NetEase sync.
- `public/index.html`: user-facing app.
- `public/admin.html`: admin page.
- `db.json`: local database generated at runtime.
- `worldcup_2026_schedule_cn.csv`: initial China-time schedule seed.

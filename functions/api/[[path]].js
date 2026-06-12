const NETEASE_API =
  "https://sports.163.com/caipiao/api/web/relottery/activity/matchInfo/worldCup2026/matchListGroup";

const GROUP_STAGE_ID = 232934;
const MATCH_SETTLE_DELAY_MS = 2 * 60 * 60 * 1000;

const STAGE_NAMES = {
  232934: "小组赛",
  232927: "1/16决赛",
  232928: "1/8决赛",
  232929: "1/4决赛",
  232930: "半决赛",
  232931: "季军赛",
  232932: "决赛",
};

const DEFAULT_SETTINGS = {
  stakeAmount: 10,
  lockMinutes: 60,
  appTitle: "2026 世界杯微信群竞猜",
  lastSyncAt: null,
  autoSyncEnabled: true,
  autoSyncMinutes: 60,
};

function nowIso() {
  return new Date().toISOString();
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readBody(request) {
  if (!request.body) return {};
  try {
    return await request.json();
  } catch {
    throw new Error("请求 JSON 格式不正确");
  }
}

function chinaDateFromMs(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function chinaTimeFromMs(ms) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function parseSetting(key, value) {
  if (value == null) return DEFAULT_SETTINGS[key];
  if (["stakeAmount", "lockMinutes", "autoSyncMinutes"].includes(key)) return Number(value);
  if (key === "autoSyncEnabled") return value === "true";
  if (key === "lastSyncAt") return value || null;
  return value;
}

async function ensureSettings(db) {
  const statements = Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
    db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
      .bind(key, value == null ? "" : String(value))
  );
  await db.batch(statements);
}

async function readSettings(db) {
  await ensureSettings(db);
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows.results || []) {
    if (row.key in settings) settings[row.key] = parseSetting(row.key, row.value);
  }
  return settings;
}

async function writeSetting(db, key, value) {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value == null ? "" : String(value))
    .run();
}

function toPublicUser(user) {
  return user ? { id: user.id, name: user.name, createdAt: user.created_at } : null;
}

function parseMatch(row) {
  return {
    id: String(row.id),
    matchInfoId: Number(row.match_info_id),
    stageId: Number(row.stage_id),
    stageName: row.stage_name,
    group: row.group_name || "",
    chinaDate: row.china_date,
    chinaTime: row.china_time,
    chinaDateTime: row.china_datetime,
    kickoffMs: Number(row.kickoff_ms),
    homeTeam: row.home_team || "",
    awayTeam: row.away_team || "",
    venue: row.venue || "",
    matchStatus: Number(row.match_status || 1),
    footballLiveScore: row.football_live_score ? JSON.parse(row.football_live_score) : null,
    updatedAt: row.updated_at,
  };
}

function allowedPicks(match) {
  return match.stageId === GROUP_STAGE_ID ? ["H", "D", "A"] : ["H", "A"];
}

function outcomeLabel(outcome) {
  return { H: "主胜", D: "平", A: "客胜" }[outcome] || "未定";
}

function scoreText(match) {
  const score = match.footballLiveScore;
  if (!score) return "";
  if (score.homeScore == null || score.guestScore == null) return "";
  return `${score.homeScore}-${score.guestScore}`;
}

function matchOutcome(match) {
  const score = match.footballLiveScore || {};
  const home = Number(score.homeScore ?? score.homeNormalScore);
  const away = Number(score.guestScore ?? score.awayScore ?? score.guestNormalScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "H";
  if (away > home) return "A";
  if (match.stageId === GROUP_STAGE_ID) return "D";

  const homePen = Number(score.homePenaltyKick);
  const awayPen = Number(score.awayPenaltyKick ?? score.guestPenaltyKick);
  if (Number.isFinite(homePen) && Number.isFinite(awayPen) && homePen !== awayPen) {
    return homePen > awayPen ? "H" : "A";
  }
  return null;
}

function isLocked(match, settings) {
  return Date.now() >= match.kickoffMs - settings.lockMinutes * 60 * 1000;
}

function settlementFromRow(row) {
  if (!row) return null;
  return {
    matchId: String(row.match_id),
    settledAt: row.settled_at,
    chinaDate: row.china_date,
    result: row.result,
    resultLabel: row.result_label,
    stakeAmount: Number(row.stake_amount),
    scoreText: row.score_text || "",
    status: row.status,
    voidReason: row.void_reason || "",
    entries: row.entries ? JSON.parse(row.entries) : [],
  };
}

function publicMatch(match, settings, prediction, settlement, publicPredictions = []) {
  const mySettlementEntry =
    prediction && settlement?.entries
      ? settlement.entries.find((entry) => entry.userId === prediction.userId) || null
      : null;
  const locked = isLocked(match, settings);
  const revealPredictions = locked || Boolean(settlement);
  return {
    ...match,
    locked,
    allowedPicks: allowedPicks(match),
    myPrediction: prediction || null,
    mySettlementEntry,
    publicPredictions: revealPredictions ? publicPredictions : [],
    settlement: settlement
      ? {
          status: settlement.status,
          result: settlement.result,
          resultLabel: settlement.resultLabel,
          scoreText: settlement.scoreText,
          voidReason: settlement.voidReason,
        }
      : null,
    scoreText: scoreText(match),
  };
}

async function getAllMatches(db) {
  const rows = await db.prepare("SELECT * FROM matches ORDER BY kickoff_ms").all();
  return (rows.results || []).map(parseMatch);
}

async function getSettlements(db) {
  const rows = await db.prepare("SELECT * FROM settlements").all();
  return (rows.results || []).map(settlementFromRow);
}

async function getUserPredictions(db, userId) {
  if (!userId) return {};
  const rows = await db.prepare("SELECT * FROM predictions WHERE user_id = ?").bind(userId).all();
  return Object.fromEntries(
    (rows.results || []).map((row) => [
      String(row.match_id),
      {
        userId: row.user_id,
        matchId: String(row.match_id),
        pick: row.pick,
        pickLabel: row.pick_label,
        stakeAmount: Number(row.stake_amount),
        updatedAt: row.updated_at,
      },
    ])
  );
}

async function getPublicPredictions(db) {
  const rows = await db
    .prepare(
      `SELECT p.match_id, p.user_id, p.pick, p.pick_label, p.updated_at, u.name
       FROM predictions p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.updated_at ASC`
    )
    .all();
  const byMatch = {};
  for (const row of rows.results || []) {
    const matchId = String(row.match_id);
    byMatch[matchId] = byMatch[matchId] || [];
    byMatch[matchId].push({
      userId: row.user_id,
      name: row.name || "未知用户",
      pick: row.pick,
      pickLabel: row.pick_label,
      updatedAt: row.updated_at,
    });
  }
  return byMatch;
}

async function dailySummary(db, date) {
  const rows = await db
    .prepare("SELECT * FROM settlements WHERE china_date = ? ORDER BY CAST(match_id AS INTEGER)")
    .bind(date)
    .all();
  const settlements = (rows.results || []).map(settlementFromRow);
  const balances = {};
  const names = {};

  for (const settlement of settlements) {
    for (const entry of settlement.entries || []) {
      balances[entry.userId] = Math.round(((balances[entry.userId] || 0) + entry.amount) * 100) / 100;
      names[entry.userId] = entry.name;
    }
  }

  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < 0)
    .map(([userId, amount]) => ({ userId, amount: Math.round(-amount * 100) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0)
    .map(([userId, amount]) => ({ userId, amount: Math.round(amount * 100) }))
    .sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({
      fromUserId: debtors[i].userId,
      fromName: names[debtors[i].userId] || "未知用户",
      toUserId: creditors[j].userId,
      toName: names[creditors[j].userId] || "未知用户",
      amount: cents / 100,
    });
    debtors[i].amount -= cents;
    creditors[j].amount -= cents;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  const balanceRows = Object.entries(balances)
    .map(([userId, amount]) => ({ userId, name: names[userId] || "未知用户", amount }))
    .sort((a, b) => b.amount - a.amount);

  return { date, settlements, balances: balanceRows, transfers };
}

function allTimeLeaderboard(settlements) {
  const totals = {};
  const names = {};
  for (const settlement of settlements) {
    for (const entry of settlement.entries || []) {
      totals[entry.userId] = Math.round(((totals[entry.userId] || 0) + entry.amount) * 100) / 100;
      names[entry.userId] = entry.name;
    }
  }
  return Object.entries(totals)
    .map(([userId, amount]) => ({ userId, name: names[userId] || "未知用户", amount }))
    .sort((a, b) => b.amount - a.amount);
}

async function predictionCount(db) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM predictions").first();
  return Number(row?.count || 0);
}

async function stateFor(db, userId, options = {}) {
  const settings = await readSettings(db);
  if (!options.skipAutoSync) await maybeAutoSync(db, settings);

  const [user, usersRows, matches, predictionsByMatch, publicPredictionsByMatch, settlements] = await Promise.all([
    userId ? db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first() : null,
    db.prepare("SELECT * FROM users ORDER BY name").all(),
    getAllMatches(db),
    getUserPredictions(db, userId),
    getPublicPredictions(db),
    getSettlements(db),
  ]);

  const settlementsByMatch = Object.fromEntries(settlements.map((settlement) => [settlement.matchId, settlement]));
  const dates = [...new Set(matches.map((match) => match.chinaDate))].sort();
  const today = chinaDateFromMs(Date.now());
  const selectedDate = dates.includes(today) ? today : dates.find((date) => date >= today) || dates[0];

  return {
    settings,
    user: toPublicUser(user),
    users: (usersRows.results || []).map(toPublicUser),
    matches: matches.map((match) =>
      publicMatch(
        match,
        settings,
        predictionsByMatch[match.id],
        settlementsByMatch[match.id],
        publicPredictionsByMatch[match.id] || []
      )
    ),
    dates,
    selectedDate,
    todaySummary: await dailySummary(db, selectedDate),
    leaderboard: allTimeLeaderboard(settlements),
  };
}

async function settleMatch(db, match, force = false) {
  if (!force) {
    const existing = await db.prepare("SELECT * FROM settlements WHERE match_id = ?").bind(match.id).first();
    if (existing) return settlementFromRow(existing);
  }
  if (Number(match.matchStatus) !== 3 && Number(match.footballLiveScore?.matchStatus) !== 3) return null;

  const result = matchOutcome(match);
  const rows = await db
    .prepare(
      `SELECT p.*, u.name
       FROM predictions p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.match_id = ?`
    )
    .bind(match.id)
    .all();
  const predictions = (rows.results || []).map((row) => ({
    userId: row.user_id,
    matchId: String(row.match_id),
    pick: row.pick,
    pickLabel: row.pick_label,
    stakeAmount: Number(row.stake_amount),
    name: row.name || "未知用户",
  }));

  const settledAt = nowIso();
  const base = {
    matchId: match.id,
    settledAt,
    chinaDate: match.chinaDate,
    result,
    resultLabel: outcomeLabel(result),
    stakeAmount: predictions.length ? Math.max(...predictions.map((item) => Number(item.stakeAmount || 0))) : 0,
    scoreText: scoreText(match),
  };

  let settlement;
  if (!result || predictions.length === 0) {
    settlement = {
      ...base,
      status: "void",
      voidReason: result ? "无人竞猜" : "结果未能判断",
      entries: [],
    };
  } else {
    const winners = predictions.filter((prediction) => prediction.pick === result);
    const losers = predictions.filter((prediction) => prediction.pick !== result);
    if (winners.length === 0) {
      settlement = {
        ...base,
        status: "void",
        voidReason: "全部猜错，流局",
        entries: predictions.map((prediction) => ({
          userId: prediction.userId,
          name: prediction.name,
          pick: prediction.pick,
          pickLabel: outcomeLabel(prediction.pick),
          amount: 0,
        })),
      };
    } else {
      const loserEntries = losers.map((loser) => {
        const cents = Math.round(Number(loser.stakeAmount || 0) * 100);
        return {
          userId: loser.userId,
          name: loser.name,
          pick: loser.pick,
          pickLabel: outcomeLabel(loser.pick),
          amount: -(cents / 100),
          cents,
        };
      });
      const poolCents = loserEntries.reduce((total, entry) => total + entry.cents, 0);
      const baseWin = Math.floor(poolCents / winners.length);
      let remainder = poolCents - baseWin * winners.length;
      const winnerEntries = winners.map((winner) => {
        const cents = baseWin + (remainder > 0 ? 1 : 0);
        remainder -= remainder > 0 ? 1 : 0;
        return {
          userId: winner.userId,
          name: winner.name,
          pick: winner.pick,
          pickLabel: outcomeLabel(winner.pick),
          amount: cents / 100,
        };
      });
      settlement = {
        ...base,
        status: "settled",
        entries: [...loserEntries.map(({ cents, ...entry }) => entry), ...winnerEntries],
      };
    }
  }

  await db
    .prepare(
      `INSERT INTO settlements
        (match_id, settled_at, china_date, result, result_label, stake_amount, score_text, status, void_reason, entries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
        settled_at = excluded.settled_at,
        china_date = excluded.china_date,
        result = excluded.result,
        result_label = excluded.result_label,
        stake_amount = excluded.stake_amount,
        score_text = excluded.score_text,
        status = excluded.status,
        void_reason = excluded.void_reason,
        entries = excluded.entries`
    )
    .bind(
      settlement.matchId,
      settlement.settledAt,
      settlement.chinaDate,
      settlement.result,
      settlement.resultLabel,
      settlement.stakeAmount,
      settlement.scoreText,
      settlement.status,
      settlement.voidReason || "",
      JSON.stringify(settlement.entries)
    )
    .run();

  return settlement;
}

async function settleCompletedMatches(db, force = false) {
  const matches = await getAllMatches(db);
  const settlements = [];
  for (const match of matches) {
    const settlement = await settleMatch(db, match, force);
    if (settlement) settlements.push(settlement);
  }
  return settlements;
}

function flatten(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

async function requestNetease() {
  const response = await fetch(NETEASE_API, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*",
      Origin: "https://sports.163.com",
      Referer: "https://sports.163.com/caipiao/worldcup2026",
      "Content-Type": "application/json",
    },
    body: "",
  });
  if (!response.ok) throw new Error(`网易接口 HTTP ${response.status}`);
  return response.json();
}

async function syncFromNetease(db) {
  const payload = await requestNetease();
  if (payload.code !== 200 || !payload.data) {
    throw new Error(`网易接口返回异常: ${JSON.stringify(payload).slice(0, 200)}`);
  }

  const now = nowIso();
  let updated = 0;
  const statements = [];
  for (const item of flatten(payload.data)) {
    const id = String(item.matchInfoId);
    const home = item.homeTeam || {};
    const away = item.guestTeam || {};
    const stage = item.stageInfo || {};
    const kickoffMs = Number(item.matchTime);
    if (!id || !Number.isFinite(kickoffMs)) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO matches
            (id, match_info_id, stage_id, stage_name, group_name, china_date, china_time, china_datetime,
             kickoff_ms, home_team, away_team, venue, match_status, football_live_score, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             match_info_id = excluded.match_info_id,
             stage_id = excluded.stage_id,
             stage_name = excluded.stage_name,
             group_name = excluded.group_name,
             china_date = excluded.china_date,
             china_time = excluded.china_time,
             china_datetime = excluded.china_datetime,
             kickoff_ms = excluded.kickoff_ms,
             home_team = excluded.home_team,
             away_team = excluded.away_team,
             venue = excluded.venue,
             match_status = excluded.match_status,
             football_live_score = excluded.football_live_score,
             updated_at = excluded.updated_at`
        )
        .bind(
          id,
          item.matchInfoId,
          Number(stage.stage || 0),
          STAGE_NAMES[stage.stage] || "",
          stage.groupNum ? "ABCDEFGHIJKL"[Number(stage.groupNum) - 1] : "",
          chinaDateFromMs(kickoffMs),
          chinaTimeFromMs(kickoffMs),
          `${chinaDateFromMs(kickoffMs)} ${chinaTimeFromMs(kickoffMs)}:00`,
          kickoffMs,
          home.teamName || "",
          away.teamName || "",
          typeof item.venue === "string" ? item.venue : "",
          Number(item.matchStatus || 1),
          item.footballLiveScore ? JSON.stringify(item.footballLiveScore) : "",
          now
        )
    );
    updated += 1;
  }
  if (statements.length) await db.batch(statements);
  await writeSetting(db, "lastSyncAt", now);
  await settleCompletedMatches(db, false);
  return { updated, lastSyncAt: now };
}

async function maybeAutoSync(db, settings) {
  if (!settings.autoSyncEnabled) return false;
  const now = Date.now();
  const lastSyncMs = settings.lastSyncAt ? Date.parse(settings.lastSyncAt) : 0;
  const intervalMs = Math.max(60, Number(settings.autoSyncMinutes || 60)) * 60 * 1000;
  if (lastSyncMs && now - lastSyncMs < intervalMs) return false;

  const rows = await db
    .prepare(
      `SELECT m.*
       FROM matches m
       LEFT JOIN settlements s ON s.match_id = m.id
       WHERE s.match_id IS NULL`
    )
    .all();
  const matches = (rows.results || []).map(parseMatch);
  const shouldSync = matches.some((match) => {
    const kickoff = Number(match.kickoffMs);
    return Number.isFinite(kickoff) && kickoff + MATCH_SETTLE_DELAY_MS <= now;
  });

  if (!shouldSync) return false;
  try {
    await syncFromNetease(db);
    return true;
  } catch (error) {
    console.error("Auto sync failed:", error.message);
    return false;
  }
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_KEY) {
    return { ok: false, response: json({ error: "还没有配置 ADMIN_KEY 环境变量" }, 500) };
  }
  const key = request.headers.get("x-admin-key");
  if (!key || key !== env.ADMIN_KEY) {
    return { ok: false, response: json({ error: "管理员口令不正确" }, 401) };
  }
  return { ok: true };
}

async function handleApi(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: "D1 binding DB 未配置" }, 500);

  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && pathname === "/api/state") {
    return json(await stateFor(db, url.searchParams.get("userId")));
  }

  if (method === "POST" && pathname === "/api/users") {
    const body = await readBody(request);
    const id = String(body.userId || crypto.randomUUID());
    const name = String(body.name || "").trim().slice(0, 24);
    if (!name) return json({ error: "请填写名称" }, 400);
    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO users (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
      )
      .bind(id, name, now, now)
      .run();
    return json({ user: { id, name, createdAt: now }, state: await stateFor(db, id, { skipAutoSync: true }) });
  }

  if (method === "POST" && pathname === "/api/predictions") {
    const body = await readBody(request);
    const userId = String(body.userId || "");
    const matchId = String(body.matchId || "");
    const pick = String(body.pick || "");
    const [settings, user, matchRow] = await Promise.all([
      readSettings(db),
      db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first(),
      db.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first(),
    ]);
    if (!user) return json({ error: "请先填写名称" }, 401);
    if (!matchRow) return json({ error: "比赛不存在" }, 404);

    const match = parseMatch(matchRow);
    if (isLocked(match, settings)) return json({ error: "这场比赛已经锁定，无法修改" }, 409);
    if (!allowedPicks(match).includes(pick)) return json({ error: "这个阶段不支持该选项" }, 400);

    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO predictions (match_id, user_id, pick, pick_label, stake_amount, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_id, user_id) DO UPDATE SET
          pick = excluded.pick,
          pick_label = excluded.pick_label,
          stake_amount = excluded.stake_amount,
          updated_at = excluded.updated_at`
      )
      .bind(matchId, userId, pick, outcomeLabel(pick), Number(settings.stakeAmount), now)
      .run();
    return json({ match: publicMatch(match, settings, { userId, matchId, pick, pickLabel: outcomeLabel(pick) }, null) });
  }

  if (method === "GET" && pathname === "/api/summary") {
    const date = url.searchParams.get("date") || chinaDateFromMs(Date.now());
    return json(await dailySummary(db, date));
  }

  if (pathname.startsWith("/api/admin")) {
    const admin = await requireAdmin(request, env);
    if (!admin.ok) return admin.response;

    if (method === "GET" && pathname === "/api/admin/state") {
      return json({
        ...(await stateFor(db, null)),
        adminKey: "ADMIN_KEY 已配置",
        predictionCount: await predictionCount(db),
      });
    }

    if (method === "POST" && pathname === "/api/admin/settings") {
      const body = await readBody(request);
      const settings = {
        stakeAmount: Math.max(1, Math.round(Number(body.stakeAmount || 10) * 100) / 100),
        lockMinutes: Math.max(1, Math.round(Number(body.lockMinutes || 60))),
        appTitle: String(body.appTitle || DEFAULT_SETTINGS.appTitle).trim().slice(0, 40),
        autoSyncEnabled: Boolean(body.autoSyncEnabled),
        autoSyncMinutes: Math.max(60, Math.round(Number(body.autoSyncMinutes || 60))),
      };
      await db.batch([
        db.prepare("UPDATE settings SET value = ? WHERE key = 'stakeAmount'").bind(String(settings.stakeAmount)),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'lockMinutes'").bind(String(settings.lockMinutes)),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'appTitle'").bind(settings.appTitle),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'autoSyncEnabled'").bind(String(settings.autoSyncEnabled)),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'autoSyncMinutes'").bind(String(settings.autoSyncMinutes)),
      ]);
      return json({ settings: await readSettings(db) });
    }

    if (method === "POST" && pathname === "/api/admin/sync") return json(await syncFromNetease(db));

    if (method === "POST" && pathname === "/api/admin/auto-sync") {
      const settings = await readSettings(db);
      const synced = await maybeAutoSync(db, settings);
      return json({ ok: true, synced, settings: await readSettings(db) });
    }

    if (method === "POST" && pathname === "/api/admin/settle") {
      const settlements = await settleCompletedMatches(db, false);
      return json({ ok: true, settlements: settlements.length });
    }
  }

  return json({ error: "Not found" }, 404);
}

export async function onRequest(context) {
  try {
    return await handleApi(context);
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "服务异常" }, 500);
  }
}

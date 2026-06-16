const NETEASE_API =
  "https://sports.163.com/caipiao/api/web/relottery/activity/matchInfo/worldCup2026/matchListGroup";

const GROUP_STAGE_ID = 232934;
const MATCH_SETTLE_DELAY_MS = 2 * 60 * 60 * 1000;
const MATCH_VISIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_POOL_ID = "pool_default";
const DEFAULT_POOL_SLUG = "main";

const STAGE_NAMES = {
  232934: "小组赛",
  232927: "1/16决赛",
  232928: "1/8决赛",
  232929: "1/4决赛",
  232930: "半决赛",
  232931: "季军赛",
  232932: "决赛",
};

const DEFAULT_GLOBAL_SETTINGS = {
  appTitle: "2026 世界杯微信群竞猜",
  lastSyncAt: null,
  autoSyncEnabled: true,
  autoSyncMinutes: 60,
};

const DEFAULT_POOL_SETTINGS = {
  stakeAmount: 10,
  lockMinutes: 60,
  maxUsers: 50,
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

function parseGlobalSetting(key, value) {
  if (value == null) return DEFAULT_GLOBAL_SETTINGS[key];
  if (key === "autoSyncMinutes") return Number(value);
  if (key === "autoSyncEnabled") return value === "true";
  if (key === "lastSyncAt") return value || null;
  return value;
}

function parsePoolSetting(key, value) {
  if (value == null) return DEFAULT_POOL_SETTINGS[key];
  if (["stakeAmount", "lockMinutes", "maxUsers"].includes(key)) return Number(value);
  return value;
}

async function ensureGlobalSettings(db) {
  const statements = Object.entries(DEFAULT_GLOBAL_SETTINGS).map(([key, value]) =>
    db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
      .bind(key, value == null ? "" : String(value))
  );
  await db.batch(statements);
}

async function ensureDefaultPool(db) {
  await ensureGlobalSettings(db);
  const appTitleRow = await db.prepare("SELECT value FROM settings WHERE key = 'appTitle'").first();
  const poolName = String(appTitleRow?.value || DEFAULT_GLOBAL_SETTINGS.appTitle);
  await db
    .prepare(
      `INSERT OR IGNORE INTO pools (id, slug, name, created_at, updated_at, is_default)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .bind(DEFAULT_POOL_ID, DEFAULT_POOL_SLUG, poolName, nowIso(), nowIso())
    .run();

  const poolSettingPairs = Object.entries(DEFAULT_POOL_SETTINGS);
  const statements = [];
  for (const [key, defaultValue] of poolSettingPairs) {
    const globalRow = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
    const value = globalRow?.value ?? String(defaultValue);
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO pool_settings (pool_id, key, value) VALUES (?, ?, ?)")
        .bind(DEFAULT_POOL_ID, key, String(value))
    );
  }
  if (statements.length) await db.batch(statements);
}

async function getPools(db) {
  await ensureDefaultPool(db);
  const rows = await db.prepare("SELECT * FROM pools ORDER BY is_default DESC, created_at ASC").all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDefault: Boolean(row.is_default),
    shareUrl: `/?pool=${encodeURIComponent(row.slug)}`,
  }));
}

async function resolvePool(db, { poolId, poolSlug } = {}) {
  await ensureDefaultPool(db);
  let row = null;
  if (poolId) {
    row = await db.prepare("SELECT * FROM pools WHERE id = ?").bind(poolId).first();
  } else {
    const slug = String(poolSlug || DEFAULT_POOL_SLUG);
    row = await db.prepare("SELECT * FROM pools WHERE slug = ?").bind(slug).first();
  }
  if (!row) throw new Error("竞猜房间不存在");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDefault: Boolean(row.is_default),
    shareUrl: `/?pool=${encodeURIComponent(row.slug)}`,
  };
}

async function readGlobalSettings(db) {
  await ensureGlobalSettings(db);
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const settings = { ...DEFAULT_GLOBAL_SETTINGS };
  for (const row of rows.results || []) {
    if (row.key in settings) settings[row.key] = parseGlobalSetting(row.key, row.value);
  }
  return settings;
}

async function readPoolSettings(db, poolId) {
  await ensureDefaultPool(db);
  const rows = await db.prepare("SELECT key, value FROM pool_settings WHERE pool_id = ?").bind(poolId).all();
  const settings = { ...DEFAULT_POOL_SETTINGS };
  for (const row of rows.results || []) {
    if (row.key in settings) settings[row.key] = parsePoolSetting(row.key, row.value);
  }
  return settings;
}

async function writeGlobalSetting(db, key, value) {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value == null ? "" : String(value))
    .run();
}

async function writePoolSetting(db, poolId, key, value) {
  await db
    .prepare(
      "INSERT INTO pool_settings (pool_id, key, value) VALUES (?, ?, ?) ON CONFLICT(pool_id, key) DO UPDATE SET value = excluded.value"
    )
    .bind(poolId, key, value == null ? "" : String(value))
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

function isVisibleForPrediction(match) {
  return Number(match.kickoffMs) <= Date.now() + MATCH_VISIBILITY_WINDOW_MS;
}

function settlementFromRow(row) {
  if (!row) return null;
  return {
    poolId: row.pool_id,
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
  return {
    ...match,
    locked: isLocked(match, settings),
    allowedPicks: allowedPicks(match),
    myPrediction: prediction || null,
    mySettlementEntry,
    publicPredictions,
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

async function getSettlements(db, poolId) {
  const rows = await db.prepare("SELECT * FROM settlements WHERE pool_id = ?").bind(poolId).all();
  return (rows.results || []).map(settlementFromRow);
}

async function getUserPredictions(db, poolId, userId) {
  if (!userId) return {};
  const rows = await db
    .prepare("SELECT * FROM predictions WHERE pool_id = ? AND user_id = ?")
    .bind(poolId, userId)
    .all();
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

async function getPublicPredictions(db, poolId) {
  const rows = await db
    .prepare(
      `SELECT p.match_id, p.user_id, p.pick, p.pick_label, p.updated_at, u.name
       FROM predictions p
       LEFT JOIN users u ON u.pool_id = p.pool_id AND u.id = p.user_id
       WHERE p.pool_id = ?
       ORDER BY p.updated_at ASC`
    )
    .bind(poolId)
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

async function dailySummary(db, poolId, date) {
  const rows = await db
    .prepare("SELECT * FROM settlements WHERE pool_id = ? AND china_date = ? ORDER BY CAST(match_id AS INTEGER)")
    .bind(poolId, date)
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

async function predictionCount(db, poolId) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM predictions WHERE pool_id = ?").bind(poolId).first();
  return Number(row?.count || 0);
}

async function adminUsers(db, poolId) {
  const rows = await db
    .prepare(
      `SELECT u.id, u.name, u.created_at, u.updated_at, COUNT(p.match_id) AS prediction_count
       FROM users u
       LEFT JOIN predictions p ON p.pool_id = u.pool_id AND p.user_id = u.id
       WHERE u.pool_id = ?
       GROUP BY u.id
       ORDER BY u.created_at ASC`
    )
    .bind(poolId)
    .all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    predictionCount: Number(row.prediction_count || 0),
  }));
}

async function adminPredictionUsers(db, poolId) {
  const [users, predictionRows] = await Promise.all([
    adminUsers(db, poolId),
    db
      .prepare(
        `SELECT
           u.id AS user_id,
           u.name AS user_name,
           p.match_id,
           p.pick,
           p.pick_label,
           p.stake_amount,
           p.updated_at,
           m.home_team,
           m.away_team,
           m.china_date,
           m.china_time,
           m.kickoff_ms,
           m.stage_name,
           m.group_name,
           m.match_status,
           s.status AS settlement_status,
           s.result_label,
           s.score_text,
           s.entries
         FROM predictions p
         INNER JOIN users u ON u.pool_id = p.pool_id AND u.id = p.user_id
         INNER JOIN matches m ON m.id = p.match_id
         LEFT JOIN settlements s ON s.pool_id = p.pool_id AND s.match_id = p.match_id
         WHERE p.pool_id = ?
         ORDER BY u.name ASC, m.kickoff_ms DESC, p.updated_at DESC`
      )
      .bind(poolId)
      .all(),
  ]);

  const byUserId = Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        ...user,
        predictions: [],
      },
    ])
  );

  for (const row of predictionRows.results || []) {
    const bucket = byUserId[row.user_id];
    if (!bucket) continue;
    let settlementAmount = null;
    if (row.entries) {
      const entries = JSON.parse(row.entries);
      const matched = entries.find((entry) => entry.userId === row.user_id);
      if (matched) settlementAmount = Number(matched.amount || 0);
    }
    bucket.predictions.push({
      matchId: String(row.match_id),
      homeTeam: row.home_team || "",
      awayTeam: row.away_team || "",
      chinaDate: row.china_date,
      chinaTime: row.china_time,
      kickoffMs: Number(row.kickoff_ms),
      stageName: row.stage_name || "",
      group: row.group_name || "",
      matchStatus: Number(row.match_status || 1),
      pick: row.pick,
      pickLabel: row.pick_label || outcomeLabel(row.pick),
      stakeAmount: Number(row.stake_amount || 0),
      updatedAt: row.updated_at,
      settlement: row.settlement_status
        ? {
            status: row.settlement_status,
            resultLabel: row.result_label || "",
            scoreText: row.score_text || "",
            amount: settlementAmount,
          }
        : null,
    });
  }

  return Object.values(byUserId);
}

async function stateFor(db, userId, poolRef = {}, options = {}) {
  const pool = await resolvePool(db, poolRef);
  const [globalSettings, poolSettings] = await Promise.all([readGlobalSettings(db), readPoolSettings(db, pool.id)]);
  if (!options.skipAutoSync) await maybeAutoSync(db, globalSettings);

  const [user, usersRows, matches, predictionsByMatch, publicPredictionsByMatch, settlements] = await Promise.all([
    userId ? db.prepare("SELECT * FROM users WHERE pool_id = ? AND id = ?").bind(pool.id, userId).first() : null,
    db.prepare("SELECT * FROM users WHERE pool_id = ? ORDER BY name").bind(pool.id).all(),
    getAllMatches(db),
    getUserPredictions(db, pool.id, userId),
    getPublicPredictions(db, pool.id),
    getSettlements(db, pool.id),
  ]);

  const settings = { ...globalSettings, ...poolSettings };
  const settlementsByMatch = Object.fromEntries(settlements.map((settlement) => [settlement.matchId, settlement]));
  const dates = [...new Set(matches.map((match) => match.chinaDate))].sort();
  const today = chinaDateFromMs(Date.now());
  const selectedDate = dates.includes(today) ? today : dates.find((date) => date >= today) || dates[0];

  return {
    pool,
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
    todaySummary: await dailySummary(db, pool.id, selectedDate),
    leaderboard: allTimeLeaderboard(settlements),
  };
}

async function settleMatch(db, poolId, match, force = false) {
  if (!force) {
    const existing = await db
      .prepare("SELECT * FROM settlements WHERE pool_id = ? AND match_id = ?")
      .bind(poolId, match.id)
      .first();
    if (existing) return settlementFromRow(existing);
  }
  if (Number(match.matchStatus) !== 3 && Number(match.footballLiveScore?.matchStatus) !== 3) return null;

  const result = matchOutcome(match);
  const rows = await db
    .prepare(
      `SELECT p.*, u.name
       FROM predictions p
       LEFT JOIN users u ON u.pool_id = p.pool_id AND u.id = p.user_id
       WHERE p.pool_id = ? AND p.match_id = ?`
    )
    .bind(poolId, match.id)
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
    poolId,
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
        (pool_id, match_id, settled_at, china_date, result, result_label, stake_amount, score_text, status, void_reason, entries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pool_id, match_id) DO UPDATE SET
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
      settlement.poolId,
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

async function settleCompletedMatches(db, poolId = null, force = false) {
  const matches = await getAllMatches(db);
  const pools = poolId ? [await resolvePool(db, { poolId })] : await getPools(db);
  const settlements = [];
  for (const pool of pools) {
    for (const match of matches) {
      const settlement = await settleMatch(db, pool.id, match, force);
      if (settlement) settlements.push(settlement);
    }
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
  await writeGlobalSetting(db, "lastSyncAt", now);
  await settleCompletedMatches(db, null, false);
  return { updated, lastSyncAt: now };
}

async function maybeAutoSync(db, globalSettings) {
  if (!globalSettings.autoSyncEnabled) return false;
  const now = Date.now();
  const lastSyncMs = globalSettings.lastSyncAt ? Date.parse(globalSettings.lastSyncAt) : 0;
  const intervalMs = Math.max(60, Number(globalSettings.autoSyncMinutes || 60)) * 60 * 1000;
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

function sanitizePoolSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function createPool(db, body) {
  const name = String(body.name || "").trim().slice(0, 40);
  const slug = sanitizePoolSlug(body.slug);
  if (!name) throw new Error("请填写房间名称");
  if (!slug) throw new Error("请填写房间代码");

  const existing = await db.prepare("SELECT id FROM pools WHERE slug = ?").bind(slug).first();
  if (existing) throw new Error("房间代码已存在");

  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO pools (id, slug, name, created_at, updated_at, is_default)
       VALUES (?, ?, ?, ?, ?, 0)`
    )
    .bind(id, slug, name, now, now)
    .run();

  const stakeAmount = Math.max(1, Math.round(Number(body.stakeAmount || DEFAULT_POOL_SETTINGS.stakeAmount) * 100) / 100);
  const lockMinutes = Math.max(1, Math.round(Number(body.lockMinutes || DEFAULT_POOL_SETTINGS.lockMinutes)));
  const maxUsers = Math.max(1, Math.round(Number(body.maxUsers || DEFAULT_POOL_SETTINGS.maxUsers)));

  await db.batch([
    db.prepare("INSERT INTO pool_settings (pool_id, key, value) VALUES (?, 'stakeAmount', ?)").bind(id, String(stakeAmount)),
    db.prepare("INSERT INTO pool_settings (pool_id, key, value) VALUES (?, 'lockMinutes', ?)").bind(id, String(lockMinutes)),
    db.prepare("INSERT INTO pool_settings (pool_id, key, value) VALUES (?, 'maxUsers', ?)").bind(id, String(maxUsers)),
  ]);

  return resolvePool(db, { poolId: id });
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
    return json(await stateFor(db, url.searchParams.get("userId"), { poolSlug: url.searchParams.get("pool") }));
  }

  if (method === "POST" && pathname === "/api/users") {
    const body = await readBody(request);
    const pool = await resolvePool(db, { poolSlug: body.pool || DEFAULT_POOL_SLUG });
    const id = String(body.userId || crypto.randomUUID());
    const name = String(body.name || "").trim().slice(0, 24);
    if (!name) return json({ error: "请填写名称" }, 400);

    const [poolSettings, existingUser, userCountRow] = await Promise.all([
      readPoolSettings(db, pool.id),
      db.prepare("SELECT id FROM users WHERE pool_id = ? AND id = ?").bind(pool.id, id).first(),
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE pool_id = ?").bind(pool.id).first(),
    ]);
    if (!existingUser && Number(userCountRow?.count || 0) >= Number(poolSettings.maxUsers || DEFAULT_POOL_SETTINGS.maxUsers)) {
      return json({ error: "该房间用户人数已满，请联系管理员" }, 409);
    }

    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO users (pool_id, id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pool_id, id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
      )
      .bind(pool.id, id, name, now, now)
      .run();
    return json({
      user: { id, name, createdAt: now },
      state: await stateFor(db, id, { poolId: pool.id }, { skipAutoSync: true }),
    });
  }

  if (method === "POST" && pathname === "/api/predictions") {
    const body = await readBody(request);
    const pool = await resolvePool(db, { poolSlug: body.pool || DEFAULT_POOL_SLUG });
    const userId = String(body.userId || "");
    const matchId = String(body.matchId || "");
    const pick = String(body.pick || "");
    const [settings, user, matchRow] = await Promise.all([
      readPoolSettings(db, pool.id),
      db.prepare("SELECT * FROM users WHERE pool_id = ? AND id = ?").bind(pool.id, userId).first(),
      db.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first(),
    ]);
    if (!user) return json({ error: "请先填写名称" }, 401);
    if (!matchRow) return json({ error: "比赛不存在" }, 404);

    const match = parseMatch(matchRow);
    if (!isVisibleForPrediction(match)) return json({ error: "只能竞猜未来 24 小时内的比赛" }, 409);
    if (isLocked(match, settings)) return json({ error: "这场比赛已经锁定，无法修改" }, 409);
    if (!allowedPicks(match).includes(pick)) return json({ error: "这个阶段不支持该选项" }, 400);

    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO predictions (pool_id, match_id, user_id, pick, pick_label, stake_amount, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pool_id, match_id, user_id) DO UPDATE SET
          pick = excluded.pick,
          pick_label = excluded.pick_label,
          stake_amount = excluded.stake_amount,
          updated_at = excluded.updated_at`
      )
      .bind(pool.id, matchId, userId, pick, outcomeLabel(pick), Number(settings.stakeAmount), now)
      .run();
    return json({ match: publicMatch(match, settings, { userId, matchId, pick, pickLabel: outcomeLabel(pick) }, null) });
  }

  if (method === "GET" && pathname === "/api/summary") {
    const pool = await resolvePool(db, { poolSlug: url.searchParams.get("pool") || DEFAULT_POOL_SLUG });
    const date = url.searchParams.get("date") || chinaDateFromMs(Date.now());
    return json(await dailySummary(db, pool.id, date));
  }

  if (pathname.startsWith("/api/admin")) {
    const admin = await requireAdmin(request, env);
    if (!admin.ok) return admin.response;

    if (method === "GET" && pathname === "/api/admin/state") {
      const poolRef = {
        poolId: url.searchParams.get("poolId") || undefined,
        poolSlug: url.searchParams.get("pool") || DEFAULT_POOL_SLUG,
      };
      const baseState = await stateFor(db, null, poolRef);
      return json({
        ...baseState,
        pools: await getPools(db),
        globalSettings: await readGlobalSettings(db),
        poolSettings: await readPoolSettings(db, baseState.pool.id),
        predictionCount: await predictionCount(db, baseState.pool.id),
        adminUsers: await adminUsers(db, baseState.pool.id),
        adminPredictionUsers: await adminPredictionUsers(db, baseState.pool.id),
      });
    }

    if (method === "POST" && pathname === "/api/admin/pools/create") {
      const body = await readBody(request);
      return json({ ok: true, pool: await createPool(db, body) });
    }

    if (method === "POST" && pathname === "/api/admin/settings") {
      const body = await readBody(request);
      const pool = await resolvePool(db, { poolId: body.poolId });
      const globalSettings = {
        appTitle: String(body.appTitle || DEFAULT_GLOBAL_SETTINGS.appTitle).trim().slice(0, 40),
        autoSyncEnabled: Boolean(body.autoSyncEnabled),
        autoSyncMinutes: Math.max(60, Math.round(Number(body.autoSyncMinutes || DEFAULT_GLOBAL_SETTINGS.autoSyncMinutes))),
      };
      const poolSettings = {
        stakeAmount: Math.max(1, Math.round(Number(body.stakeAmount || DEFAULT_POOL_SETTINGS.stakeAmount) * 100) / 100),
        lockMinutes: Math.max(1, Math.round(Number(body.lockMinutes || DEFAULT_POOL_SETTINGS.lockMinutes))),
        maxUsers: Math.max(1, Math.round(Number(body.maxUsers || DEFAULT_POOL_SETTINGS.maxUsers))),
      };
      const poolName = String(body.poolName || pool.name).trim().slice(0, 40) || pool.name;

      await db.batch([
        db.prepare("UPDATE pools SET name = ?, updated_at = ? WHERE id = ?").bind(poolName, nowIso(), pool.id),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'appTitle'").bind(globalSettings.appTitle),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'autoSyncEnabled'").bind(String(globalSettings.autoSyncEnabled)),
        db.prepare("UPDATE settings SET value = ? WHERE key = 'autoSyncMinutes'").bind(String(globalSettings.autoSyncMinutes)),
        db.prepare("INSERT INTO pool_settings (pool_id, key, value) VALUES (?, 'stakeAmount', ?) ON CONFLICT(pool_id, key) DO UPDATE SET value = excluded.value").bind(pool.id, String(poolSettings.stakeAmount)),
        db.prepare("INSERT INTO pool_settings (pool_id, key, value) VALUES (?, 'lockMinutes', ?) ON CONFLICT(pool_id, key) DO UPDATE SET value = excluded.value").bind(pool.id, String(poolSettings.lockMinutes)),
        db.prepare("INSERT INTO pool_settings (pool_id, key, value) VALUES (?, 'maxUsers', ?) ON CONFLICT(pool_id, key) DO UPDATE SET value = excluded.value").bind(pool.id, String(poolSettings.maxUsers)),
      ]);
      return json({
        ok: true,
        pool: await resolvePool(db, { poolId: pool.id }),
        globalSettings: await readGlobalSettings(db),
        poolSettings: await readPoolSettings(db, pool.id),
      });
    }

    if (method === "POST" && pathname === "/api/admin/users/update") {
      const body = await readBody(request);
      const pool = await resolvePool(db, { poolId: body.poolId });
      const userId = String(body.userId || "");
      const name = String(body.name || "").trim().slice(0, 24);
      if (!userId) return json({ error: "缺少用户 ID" }, 400);
      if (!name) return json({ error: "请填写用户名称" }, 400);
      const now = nowIso();
      const result = await db
        .prepare("UPDATE users SET name = ?, updated_at = ? WHERE pool_id = ? AND id = ?")
        .bind(name, now, pool.id, userId)
        .run();
      if (!result.meta?.changes) return json({ error: "用户不存在" }, 404);
      return json({ ok: true, user: { id: userId, name, updatedAt: now } });
    }

    if (method === "POST" && pathname === "/api/admin/users/delete") {
      const body = await readBody(request);
      const pool = await resolvePool(db, { poolId: body.poolId });
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "缺少用户 ID" }, 400);
      await db.batch([
        db.prepare("DELETE FROM predictions WHERE pool_id = ? AND user_id = ?").bind(pool.id, userId),
        db.prepare("DELETE FROM users WHERE pool_id = ? AND id = ?").bind(pool.id, userId),
      ]);
      return json({ ok: true });
    }

    if (method === "POST" && pathname === "/api/admin/sync") return json(await syncFromNetease(db));

    if (method === "POST" && pathname === "/api/admin/auto-sync") {
      const settings = await readGlobalSettings(db);
      const synced = await maybeAutoSync(db, settings);
      return json({ ok: true, synced, settings: await readGlobalSettings(db) });
    }

    if (method === "POST" && pathname === "/api/admin/settle") {
      const body = await readBody(request);
      const pool = await resolvePool(db, { poolId: body.poolId });
      const settlements = await settleCompletedMatches(db, pool.id, false);
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

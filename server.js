const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(ROOT, "db.json");
const CSV_PATH = path.join(ROOT, "worldcup_2026_schedule_cn.csv");
const NETEASE_API =
  "https://sports.163.com/caipiao/api/web/relottery/activity/matchInfo/worldCup2026/matchListGroup";

const STAGE_NAMES = {
  232934: "小组赛",
  232927: "1/16决赛",
  232928: "1/8决赛",
  232929: "1/4决赛",
  232930: "半决赛",
  232931: "季军赛",
  232932: "决赛",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function nowIso() {
  return new Date().toISOString();
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

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += ch;
    }
  }
  values.push(value);
  return values;
}

function loadSeedMatches() {
  const csv = fs.readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "").trim();
  const [headerLine, ...lines] = csv.split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  const matches = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((key, index) => [key, values[index] || ""]));
    const id = String(row.match_info_id);
    const kickoffMs = Number(row.source_match_time_raw);
    matches[id] = {
      id,
      matchInfoId: Number(row.match_info_id),
      stageId: Number(row.stage_id),
      stageName: row.stage_name,
      group: row.group,
      chinaDate: row.china_date,
      chinaTime: row.china_time,
      chinaDateTime: row.china_datetime,
      kickoffMs,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      venue: row.venue,
      matchStatus: Number(row.match_status || 1),
      footballLiveScore: null,
      updatedAt: nowIso(),
    };
  }
  return matches;
}

function createDb() {
  return {
    settings: {
      stakeAmount: 10,
      lockMinutes: 60,
      adminKey: crypto.randomBytes(12).toString("hex"),
      appTitle: "2026 世界杯微信群竞猜",
      lastSyncAt: null,
      autoSyncEnabled: true,
      autoSyncMinutes: 30,
      knockoutLookaheadHours: 12,
    },
    users: {},
    matches: loadSeedMatches(),
    predictions: {},
    settlements: {},
  };
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const db = createDb();
    saveDb(db);
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function ensureSettings(database) {
  const defaults = createDb().settings;
  database.settings = { ...defaults, ...database.settings };
  return database;
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

let db = ensureSettings(loadDb());
saveDb(db);

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, createdAt: user.createdAt } : null;
}

function matchOutcome(match) {
  const score = match.footballLiveScore || {};
  const home = Number(score.homeScore ?? score.homeNormalScore);
  const away = Number(score.guestScore ?? score.awayScore ?? score.guestNormalScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "H";
  if (away > home) return "A";
  if (match.stageId === 232934) return "D";

  const homePen = Number(score.homePenaltyKick);
  const awayPen = Number(score.awayPenaltyKick ?? score.guestPenaltyKick);
  if (Number.isFinite(homePen) && Number.isFinite(awayPen) && homePen !== awayPen) {
    return homePen > awayPen ? "H" : "A";
  }
  return null;
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

function isLocked(match) {
  return Date.now() >= match.kickoffMs - db.settings.lockMinutes * 60 * 1000;
}

function allowedPicks(match) {
  return match.stageId === 232934 ? ["H", "D", "A"] : ["H", "A"];
}

function settleMatch(match, force = false) {
  if (!force && db.settlements[match.id]) return db.settlements[match.id];
  if (Number(match.matchStatus) !== 3 && Number(match.footballLiveScore?.matchStatus) !== 3) {
    return null;
  }

  const result = matchOutcome(match);
  const matchPredictions = Object.values(db.predictions[match.id] || {});
  const stakeCents = Math.round(Number(db.settings.stakeAmount || 10) * 100);
  const settledAt = nowIso();

  if (!result || matchPredictions.length === 0) {
    db.settlements[match.id] = {
      matchId: match.id,
      settledAt,
      chinaDate: match.chinaDate,
      result,
      resultLabel: outcomeLabel(result),
      stakeAmount: stakeCents / 100,
      scoreText: scoreText(match),
      status: "void",
      voidReason: result ? "无人竞猜" : "结果未能判断",
      entries: [],
    };
    return db.settlements[match.id];
  }

  const winners = matchPredictions.filter((prediction) => prediction.pick === result);
  const losers = matchPredictions.filter((prediction) => prediction.pick !== result);
  if (winners.length === 0) {
    db.settlements[match.id] = {
      matchId: match.id,
      settledAt,
      chinaDate: match.chinaDate,
      result,
      resultLabel: outcomeLabel(result),
      stakeAmount: stakeCents / 100,
      scoreText: scoreText(match),
      status: "void",
      voidReason: "全部猜错，流局",
      entries: matchPredictions.map((prediction) => ({
        userId: prediction.userId,
        name: db.users[prediction.userId]?.name || "未知用户",
        pick: prediction.pick,
        pickLabel: outcomeLabel(prediction.pick),
        amount: 0,
      })),
    };
    return db.settlements[match.id];
  }

  const poolCents = losers.length * stakeCents;
  const baseWin = Math.floor(poolCents / winners.length);
  let remainder = poolCents - baseWin * winners.length;
  const entries = [];

  for (const loser of losers) {
    entries.push({
      userId: loser.userId,
      name: db.users[loser.userId]?.name || "未知用户",
      pick: loser.pick,
      pickLabel: outcomeLabel(loser.pick),
      amount: -(stakeCents / 100),
    });
  }
  for (const winner of winners) {
    const cents = baseWin + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
    entries.push({
      userId: winner.userId,
      name: db.users[winner.userId]?.name || "未知用户",
      pick: winner.pick,
      pickLabel: outcomeLabel(winner.pick),
      amount: cents / 100,
    });
  }

  db.settlements[match.id] = {
    matchId: match.id,
    settledAt,
    chinaDate: match.chinaDate,
    result,
    resultLabel: outcomeLabel(result),
    stakeAmount: stakeCents / 100,
    scoreText: scoreText(match),
    status: "settled",
    entries,
  };
  return db.settlements[match.id];
}

function settleCompletedMatches(force = false) {
  const settlements = [];
  for (const match of Object.values(db.matches)) {
    const settlement = settleMatch(match, force);
    if (settlement) settlements.push(settlement);
  }
  saveDb(db);
  return settlements;
}

function dailySummary(date) {
  const settlements = Object.values(db.settlements)
    .filter((item) => item.chinaDate === date)
    .sort((a, b) => Number(a.matchId) - Number(b.matchId));
  const balances = {};
  for (const settlement of settlements) {
    for (const entry of settlement.entries || []) {
      balances[entry.userId] = Math.round(((balances[entry.userId] || 0) + entry.amount) * 100) / 100;
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
      fromName: db.users[debtors[i].userId]?.name || "未知用户",
      toUserId: creditors[j].userId,
      toName: db.users[creditors[j].userId]?.name || "未知用户",
      amount: cents / 100,
    });
    debtors[i].amount -= cents;
    creditors[j].amount -= cents;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  const balanceRows = Object.entries(balances)
    .map(([userId, amount]) => ({
      userId,
      name: db.users[userId]?.name || "未知用户",
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { date, settlements, balances: balanceRows, transfers };
}

function allTimeLeaderboard() {
  const totals = {};
  for (const settlement of Object.values(db.settlements)) {
    for (const entry of settlement.entries || []) {
      totals[entry.userId] = Math.round(((totals[entry.userId] || 0) + entry.amount) * 100) / 100;
    }
  }
  return Object.entries(totals)
    .map(([userId, amount]) => ({
      userId,
      name: db.users[userId]?.name || "未知用户",
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function predictionCount() {
  return Object.values(db.predictions).reduce(
    (total, predictionsByMatch) => total + Object.keys(predictionsByMatch).length,
    0
  );
}

function publicMatch(match, userId) {
  const prediction = userId ? db.predictions[match.id]?.[userId] || null : null;
  const settlement = db.settlements[match.id] || null;
  return {
    ...match,
    locked: isLocked(match),
    allowedPicks: allowedPicks(match),
    myPrediction: prediction,
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

function stateFor(userId) {
  const user = publicUser(db.users[userId]);
  const dates = [...new Set(Object.values(db.matches).map((match) => match.chinaDate))].sort();
  const today = chinaDateFromMs(Date.now());
  const selectedDate = dates.includes(today) ? today : dates.find((date) => date >= today) || dates[0];
  return {
    settings: {
      appTitle: db.settings.appTitle,
      stakeAmount: db.settings.stakeAmount,
      lockMinutes: db.settings.lockMinutes,
      lastSyncAt: db.settings.lastSyncAt,
      autoSyncEnabled: db.settings.autoSyncEnabled,
      autoSyncMinutes: db.settings.autoSyncMinutes,
      knockoutLookaheadHours: db.settings.knockoutLookaheadHours,
    },
    user,
    users: Object.values(db.users).map(publicUser).sort((a, b) => a.name.localeCompare(b.name, "zh")),
    matches: Object.values(db.matches)
      .sort((a, b) => a.kickoffMs - b.kickoffMs)
      .map((match) => publicMatch(match, userId)),
    dates,
    selectedDate,
    todaySummary: dailySummary(selectedDate),
    leaderboard: allTimeLeaderboard(),
  };
}

function requestJson(url, body = "") {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json, text/plain, */*",
          Origin: "https://sports.163.com",
          Referer: "https://sports.163.com/caipiao/worldcup2026",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function flatten(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function syncFromNetease() {
  return requestJson(NETEASE_API).then((payload) => {
    if (payload.code !== 200 || !payload.data) {
      throw new Error(`网易接口返回异常: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    let updated = 0;
    for (const item of flatten(payload.data)) {
      const id = String(item.matchInfoId);
      const home = item.homeTeam || {};
      const away = item.guestTeam || {};
      const stage = item.stageInfo || {};
      const existing = db.matches[id] || {};
      const kickoffMs = Number(item.matchTime || existing.kickoffMs);
      db.matches[id] = {
        ...existing,
        id,
        matchInfoId: item.matchInfoId,
        stageId: Number(stage.stage || existing.stageId),
        stageName: STAGE_NAMES[stage.stage] || existing.stageName || "",
        group: stage.groupNum ? "ABCDEFGHIJKL"[Number(stage.groupNum) - 1] : existing.group || "",
        chinaDate: chinaDateFromMs(kickoffMs),
        chinaTime: chinaTimeFromMs(kickoffMs),
        chinaDateTime: `${chinaDateFromMs(kickoffMs)} ${chinaTimeFromMs(kickoffMs)}:00`,
        kickoffMs,
        homeTeam: home.teamName || existing.homeTeam || "",
        awayTeam: away.teamName || existing.awayTeam || "",
        venue: typeof item.venue === "string" ? item.venue : existing.venue || "",
        matchStatus: Number(item.matchStatus || existing.matchStatus || 1),
        footballLiveScore: item.footballLiveScore || existing.footballLiveScore || null,
        updatedAt: nowIso(),
      };
      updated += 1;
    }
    db.settings.lastSyncAt = nowIso();
    settleCompletedMatches(false);
    saveDb(db);
    return { updated, lastSyncAt: db.settings.lastSyncAt };
  });
}

function shouldAutoSync() {
  if (!db.settings.autoSyncEnabled) return false;
  const now = Date.now();
  const lastSyncMs = db.settings.lastSyncAt ? Date.parse(db.settings.lastSyncAt) : 0;
  const intervalMs = Math.max(5, Number(db.settings.autoSyncMinutes || 30)) * 60 * 1000;
  if (lastSyncMs && now - lastSyncMs < intervalMs) return false;

  const knockoutLookaheadMs =
    Math.max(1, Number(db.settings.knockoutLookaheadHours || 12)) * 60 * 60 * 1000;
  return Object.values(db.matches).some((match) => {
    const kickoff = Number(match.kickoffMs);
    if (!Number.isFinite(kickoff)) return false;
    if (Number(match.matchStatus) === 2 || Number(match.footballLiveScore?.matchStatus) === 2) return true;
    if (match.stageId === 232934) {
      return kickoff + 2 * 60 * 60 * 1000 <= now && !db.settlements[match.id];
    }
    return kickoff - knockoutLookaheadMs <= now && kickoff + 3 * 60 * 60 * 1000 >= now;
  });
}

function startAutoSync() {
  setInterval(() => {
    if (!shouldAutoSync()) return;
    syncFromNetease().catch((error) => console.error("Auto sync failed:", error.message));
  }, 5 * 60 * 1000);
}

function requireAdmin(req, res) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== db.settings.adminKey) {
    jsonResponse(res, 401, { error: "管理员口令不正确" });
    return false;
  }
  return true;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    jsonResponse(res, 200, stateFor(url.searchParams.get("userId")));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    const body = await readBody(req);
    const id = String(body.userId || crypto.randomUUID());
    const name = String(body.name || "").trim().slice(0, 24);
    if (!name) {
      jsonResponse(res, 400, { error: "请填写名称" });
      return;
    }
    db.users[id] = db.users[id] || { id, createdAt: nowIso() };
    db.users[id].name = name;
    db.users[id].updatedAt = nowIso();
    saveDb(db);
    jsonResponse(res, 200, { user: publicUser(db.users[id]), state: stateFor(id) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/predictions") {
    const body = await readBody(req);
    const userId = String(body.userId || "");
    const matchId = String(body.matchId || "");
    const pick = String(body.pick || "");
    const user = db.users[userId];
    const match = db.matches[matchId];
    if (!user) {
      jsonResponse(res, 401, { error: "请先填写名称" });
      return;
    }
    if (!match) {
      jsonResponse(res, 404, { error: "比赛不存在" });
      return;
    }
    if (isLocked(match)) {
      jsonResponse(res, 409, { error: "这场比赛已经锁定，无法修改" });
      return;
    }
    if (!allowedPicks(match).includes(pick)) {
      jsonResponse(res, 400, { error: "这个阶段不支持该选项" });
      return;
    }
    db.predictions[matchId] = db.predictions[matchId] || {};
    db.predictions[matchId][userId] = {
      userId,
      matchId,
      pick,
      pickLabel: outcomeLabel(pick),
      stakeAmount: Number(db.settings.stakeAmount),
      updatedAt: nowIso(),
    };
    saveDb(db);
    jsonResponse(res, 200, { match: publicMatch(match, userId) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/summary") {
    const date = url.searchParams.get("date") || chinaDateFromMs(Date.now());
    jsonResponse(res, 200, dailySummary(date));
    return;
  }

  if (url.pathname.startsWith("/api/admin")) {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET" && url.pathname === "/api/admin/state") {
      jsonResponse(res, 200, {
        ...stateFor(null),
        adminKey: db.settings.adminKey,
        predictionCount: predictionCount(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/settings") {
      const body = await readBody(req);
      db.settings.stakeAmount = Math.max(1, Math.round(Number(body.stakeAmount || 10) * 100) / 100);
      db.settings.lockMinutes = Math.max(1, Math.round(Number(body.lockMinutes || 60)));
      db.settings.appTitle = String(body.appTitle || db.settings.appTitle).trim().slice(0, 40);
      db.settings.autoSyncEnabled = Boolean(body.autoSyncEnabled);
      db.settings.autoSyncMinutes = Math.max(5, Math.round(Number(body.autoSyncMinutes || 30)));
      db.settings.knockoutLookaheadHours = Math.max(
        1,
        Math.round(Number(body.knockoutLookaheadHours || 12))
      );
      saveDb(db);
      jsonResponse(res, 200, { settings: db.settings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/sync") {
      const result = await syncFromNetease();
      jsonResponse(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/settle") {
      settleCompletedMatches(false);
      jsonResponse(res, 200, { ok: true, settlements: Object.values(db.settlements).length });
      return;
    }
  }

  jsonResponse(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      jsonResponse(res, 500, { error: error.message || "服务异常" });
    });
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`World Cup pool app: http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
  console.log(`Admin key: ${db.settings.adminKey}`);
});

startAutoSync();

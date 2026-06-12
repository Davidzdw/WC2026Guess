const MATCH_VISIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const state = {
  data: null,
  userId: localStorage.getItem("wc_user_id") || crypto.randomUUID(),
  activeView: "matches",
  shouldAnchorToday: true,
};

localStorage.setItem("wc_user_id", state.userId);

const $ = (selector) => document.querySelector(selector);

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function pickLabel(pick) {
  return { H: "主胜", D: "平", A: "客胜" }[pick] || "未选";
}

function statusLabel(match) {
  if (Number(match.matchStatus) === 3) return { text: "已结束", className: "done" };
  if (Number(match.matchStatus) === 2) return { text: "进行中", className: "live" };
  if (match.locked) return { text: "已锁定", className: "" };
  return { text: "可竞猜", className: "" };
}

function formatAmount(amount) {
  const value = Number(amount || 0);
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} 元`;
}

function formatDateHeading(date) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "Asia/Shanghai" }).format(parsed);
  return `${date} ${weekday}`;
}

function upcomingWindowEndMs() {
  return Date.now() + MATCH_VISIBILITY_WINDOW_MS;
}

function visibleMatches() {
  return (state.data?.matches || []).filter((match) => Number(match.kickoffMs) <= upcomingWindowEndMs());
}

function visibleDates() {
  return [...new Set(visibleMatches().map((match) => match.chinaDate))].sort();
}

function todayAnchorDate() {
  const dates = visibleDates();
  return state.data.selectedDate && dates.includes(state.data.selectedDate) ? state.data.selectedDate : dates[0];
}

function dateId(date) {
  return `match-date-${date}`;
}

function scrollToDate(date, behavior = "smooth") {
  const target = document.getElementById(dateId(date));
  if (!target) return;
  target.scrollIntoView({ behavior, block: "start" });
}

function renderProfile() {
  const user = state.data.user;
  $("#appTitle").textContent = state.data.settings.appTitle;
  $("#nameInput").value = user?.name || "";
  $("#profileTitle").textContent = user ? `你好，${user.name}` : "填写后会记住在这台设备上";
}

function renderDateOptions() {
  const dates = visibleDates();
  const options = dates.map((date) => `<option value="${date}">${date}</option>`).join("");
  $("#summaryDateSelect").innerHTML = options;
  $("#summaryDateSelect").value = dates.includes(state.data.selectedDate) ? state.data.selectedDate : dates[0] || "";
}

function pickClass(match, pick) {
  const classes = ["pick"];
  if (match.myPrediction?.pick === pick) classes.push("selected");
  if (match.settlement?.result === pick) classes.push("result-pick");
  if (match.mySettlementEntry && match.myPrediction?.pick === pick) {
    if (match.settlement?.status === "void") classes.push("void-pick");
    else if (Number(match.mySettlementEntry.amount) > 0) classes.push("correct-pick");
    else if (Number(match.mySettlementEntry.amount) < 0) classes.push("wrong-pick");
  }
  return classes.join(" ");
}

function predictionMeta(match) {
  if (match.settlement) {
    if (!match.myPrediction) return "未竞猜";
    if (match.settlement.status === "void") {
      return match.mySettlementEntry ? `流局 ${match.myPrediction.pickLabel}` : "流局，未竞猜";
    }
    if (!match.mySettlementEntry) return `已选 ${match.myPrediction.pickLabel}`;
    const amount = Number(match.mySettlementEntry.amount || 0);
    if (amount > 0) return `猜对 ${formatAmount(amount)}`;
    if (amount < 0) return `猜错 ${formatAmount(amount)}`;
    return `流局 ${match.myPrediction.pickLabel}`;
  }
  if (match.myPrediction) return `已选 ${match.myPrediction.pickLabel}`;
  if (match.locked) return "开赛前已锁定";
  if (state.data.user) return `每场 ${state.data.settings.stakeAmount} 元`;
  return "先填写名称";
}

function predictionMetaClass(match) {
  if (!match.settlement || !match.mySettlementEntry) return "";
  const amount = Number(match.mySettlementEntry.amount || 0);
  if (amount > 0) return "amount-positive";
  if (amount < 0) return "amount-negative";
  return "";
}

function renderPublicPredictions(match) {
  const predictions = match.publicPredictions || [];
  if (!match.locked && !match.settlement) {
    return `<div class="public-picks muted">锁定后公开大家的选择</div>`;
  }
  if (!predictions.length) {
    return `<div class="public-picks muted">暂无人竞猜</div>`;
  }

  const groups = Object.fromEntries(match.allowedPicks.map((pick) => [pick, []]));
  for (const prediction of predictions) {
    groups[prediction.pick] = groups[prediction.pick] || [];
    groups[prediction.pick].push(prediction);
  }

  return `
    <div class="public-picks">
      <p class="public-picks-title">大家的选择</p>
      <div class="public-pick-groups">
        ${match.allowedPicks
          .map((pick) => {
            const rows = groups[pick] || [];
            return `
              <div class="public-pick-group ${match.settlement?.result === pick ? "public-pick-result" : ""}">
                <div class="public-pick-heading">
                  <span>${pickLabel(pick)}</span>
                  <strong>${rows.length}</strong>
                </div>
                <div class="public-pick-names">
                  ${
                    rows.length
                      ? rows
                          .map(
                            (row) =>
                              `<span class="public-pick-name ${
                                row.userId === state.userId ? "me" : ""
                              }">${row.name}</span>`
                          )
                          .join("")
                      : `<span class="public-pick-empty">-</span>`
                  }
                </div>
              </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

function renderMatchCard(match) {
  const status = statusLabel(match);
  const picks = match.allowedPicks;
  const pickRowClass = picks.length === 2 ? "pick-row two" : "pick-row";
  const result = match.settlement
    ? `<span class="status-pill done">结果 ${match.settlement.scoreText || ""} ${
        match.settlement.resultLabel || ""
      }</span>`
    : "";
  const disabled = match.locked || !state.data.user ? "disabled" : "";
  const buttons = picks
    .map(
      (pick) => `
        <button
          class="${pickClass(match, pick)}"
          data-match-id="${match.id}"
          data-pick="${pick}"
          ${disabled}
          type="button"
        >${pickLabel(pick)}</button>`
    )
    .join("");

  return `
    <article class="match-card">
      <div class="match-time">
        <strong>${match.chinaTime}</strong>
        <span>${match.stageName}${match.group ? ` · ${match.group}组` : ""}</span>
      </div>
      <div class="teams">
        <h3>${match.homeTeam || "待定"} vs ${match.awayTeam || "待定"}</h3>
        <p>${match.venue || "赛场待定"} <span class="status-pill ${status.className}">${status.text}</span> ${result}</p>
      </div>
      <div>
        <div class="${pickRowClass}">${buttons}</div>
        <div class="pick-meta ${predictionMetaClass(match)}">${predictionMeta(match)}</div>
        ${renderPublicPredictions(match)}
      </div>
    </article>`;
}

function renderMatches() {
  const dates = visibleDates();
  const matches = visibleMatches();
  if (!matches.length) {
    $("#matchList").innerHTML = `
      <section class="summary-block">
        <h3>暂无可展示比赛</h3>
        <p class="muted">这里只显示已经发生的比赛，以及未来 24 小时内会开赛的比赛。</p>
      </section>`;
    return;
  }

  $("#matchList").innerHTML = dates
    .map((date) => {
      const matchesForDate = matches.filter((match) => match.chinaDate === date);
      const isToday = date === todayAnchorDate();
      return `
        <section id="${dateId(date)}" class="match-date-section ${isToday ? "today-section" : ""}">
          <div class="date-heading">
            <div>
              <p class="section-kicker">${isToday ? "今天" : "比赛日"}</p>
              <h2>${formatDateHeading(date)}</h2>
            </div>
            <span>${matchesForDate.length} 场</span>
          </div>
          <div class="date-match-list">
            ${matchesForDate.map(renderMatchCard).join("")}
          </div>
        </section>`;
    })
    .join("");
}

function summaryText(summary) {
  const lines = [`${summary.date} 世界杯竞猜结算`];
  if (!summary.transfers.length) lines.push("今日无需转账。");
  else summary.transfers.forEach((transfer) => lines.push(`${transfer.fromName} -> ${transfer.toName}: ${transfer.amount.toFixed(2)} 元`));
  return lines.join("\n");
}

function renderSummary(summary = state.data.todaySummary) {
  const transferRows = summary.transfers.length
    ? summary.transfers
        .map(
          (transfer) => `
          <div class="transfer-row">
            <span>${transfer.fromName} 转给 ${transfer.toName}</span>
            <strong>${transfer.amount.toFixed(2)} 元</strong>
          </div>`
        )
        .join("")
    : `<p class="muted">这一天没有需要转账的净额。</p>`;

  const balanceRows = summary.balances.length
    ? summary.balances
        .map(
          (row) => `
          <div class="balance-row">
            <span>${row.name}</span>
            <strong class="${row.amount >= 0 ? "amount-positive" : "amount-negative"}">${formatAmount(row.amount)}</strong>
          </div>`
        )
        .join("")
    : `<p class="muted">还没有结算记录。</p>`;

  const resultRows = summary.settlements.length
    ? summary.settlements
        .map((settlement) => {
          const match = state.data.matches.find((item) => item.id === settlement.matchId);
          const status =
            settlement.status === "void"
              ? `流局，${settlement.voidReason}`
              : `${settlement.scoreText || ""} ${settlement.resultLabel}`;
          return `
            <div class="match-result-row">
              <span>${match?.homeTeam || "待定"} vs ${match?.awayTeam || "待定"}</span>
              <strong>${status}</strong>
            </div>`;
        })
        .join("")
    : `<p class="muted">这一天暂时没有已结算比赛。</p>`;

  $("#dailySummary").innerHTML = `
    <div class="summary-block">
      <h3>转账建议</h3>
      ${transferRows}
    </div>
    <div class="summary-block">
      <h3>当日净额</h3>
      ${balanceRows}
    </div>
    <div class="summary-block">
      <h3>比赛结算</h3>
      ${resultRows}
    </div>`;
  $("#copySummaryButton").dataset.copyText = summaryText(summary);
}

function renderLeaderboard() {
  $("#leaderboard").innerHTML = state.data.leaderboard.length
    ? state.data.leaderboard
        .map(
          (row, index) => `
          <div class="leader-row">
            <span>${index + 1}. ${row.name}</span>
            <strong class="${row.amount >= 0 ? "amount-positive" : "amount-negative"}">${formatAmount(row.amount)}</strong>
          </div>`
        )
        .join("")
    : `<div class="summary-block"><p class="muted">还没有结算记录。</p></div>`;
}

function render() {
  renderProfile();
  renderDateOptions();
  renderMatches();
  renderSummary();
  renderLeaderboard();
  if (state.shouldAnchorToday) {
    const anchorDate = todayAnchorDate();
    state.shouldAnchorToday = false;
    if (anchorDate) window.requestAnimationFrame(() => scrollToDate(anchorDate, "auto"));
  }
}

async function loadState() {
  state.data = await api(`/api/state?userId=${encodeURIComponent(state.userId)}`);
  render();
}

async function refreshSummary(date) {
  const summary = await api(`/api/summary?date=${encodeURIComponent(date)}`);
  renderSummary(summary);
}

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ userId: state.userId, name: $("#nameInput").value }),
    });
    state.data = payload.state;
    state.shouldAnchorToday = false;
    render();
    toast("名称已保存");
  } catch (error) {
    toast(error.message);
  }
});

$("#matchList").addEventListener("click", async (event) => {
  const button = event.target.closest(".pick");
  if (!button) return;
  try {
    await api("/api/predictions", {
      method: "POST",
      body: JSON.stringify({
        userId: state.userId,
        matchId: button.dataset.matchId,
        pick: button.dataset.pick,
      }),
    });
    state.shouldAnchorToday = false;
    await loadState();
    toast("已保存选择");
  } catch (error) {
    toast(error.message);
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeView = tab.dataset.view;
    document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node === tab));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $(`#${state.activeView}View`).classList.add("active");
    if (state.activeView === "matches" && todayAnchorDate()) scrollToDate(todayAnchorDate());
  });
});

$("#todayButton").addEventListener("click", () => {
  const anchorDate = todayAnchorDate();
  if (anchorDate) scrollToDate(anchorDate);
});
$("#summaryDateSelect").addEventListener("change", (event) => refreshSummary(event.target.value));
$("#refreshButton").addEventListener("click", () => {
  state.shouldAnchorToday = false;
  loadState().then(() => toast("已刷新"));
});
$("#copySummaryButton").addEventListener("click", async () => {
  const text = $("#copySummaryButton").dataset.copyText || "";
  await navigator.clipboard.writeText(text);
  toast("已复制，可以粘贴到微信群");
});

loadState().catch((error) => toast(error.message));

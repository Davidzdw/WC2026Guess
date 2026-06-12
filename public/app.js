const state = {
  data: null,
  userId: localStorage.getItem("wc_user_id") || crypto.randomUUID(),
  activeView: "matches",
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

function selectedDate() {
  return $("#dateSelect").value || state.data.selectedDate;
}

function renderProfile() {
  const user = state.data.user;
  $("#appTitle").textContent = state.data.settings.appTitle;
  $("#nameInput").value = user?.name || "";
  $("#profileTitle").textContent = user ? `你好，${user.name}` : "填写后会记住在这台手机上";
}

function renderDateOptions() {
  const options = state.data.dates
    .map((date) => `<option value="${date}">${date}</option>`)
    .join("");
  $("#dateSelect").innerHTML = options;
  $("#summaryDateSelect").innerHTML = options;
  $("#dateSelect").value = state.data.selectedDate;
  $("#summaryDateSelect").value = state.data.selectedDate;
}

function renderMatches() {
  const date = selectedDate();
  const matches = state.data.matches.filter((match) => match.chinaDate === date);
  $("#matchList").innerHTML = matches
    .map((match) => {
      const status = statusLabel(match);
      const picks = match.allowedPicks;
      const pickClass = picks.length === 2 ? "pick-row two" : "pick-row";
      const result = match.settlement
        ? `<span class="status-pill done">结果 ${match.settlement.scoreText || ""} ${match.settlement.resultLabel || ""}</span>`
        : "";
      const disabled = match.locked || !state.data.user ? "disabled" : "";
      const buttons = picks
        .map(
          (pick) => `
            <button
              class="pick ${match.myPrediction?.pick === pick ? "selected" : ""}"
              data-match-id="${match.id}"
              data-pick="${pick}"
              ${disabled}
              type="button"
            >${pickLabel(pick)}</button>`
        )
        .join("");
      const meta = match.myPrediction
        ? `已选 ${match.myPrediction.pickLabel}`
        : match.locked
          ? "开赛前已锁定"
          : state.data.user
            ? `每场 ${state.data.settings.stakeAmount} 元`
            : "先填写名称";
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
            <div class="${pickClass}">${buttons}</div>
            <div class="pick-meta">${meta}</div>
          </div>
        </article>`;
    })
    .join("");
}

function summaryText(summary) {
  const lines = [`${summary.date} 世界杯竞猜结算`];
  if (!summary.transfers.length) {
    lines.push("今日无需转账。");
  } else {
    for (const transfer of summary.transfers) {
      lines.push(`${transfer.fromName} -> ${transfer.toName}：${transfer.amount.toFixed(2)} 元`);
    }
  }
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
              ? `流局：${settlement.voidReason}`
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
    const currentDate = selectedDate();
    await api("/api/predictions", {
      method: "POST",
      body: JSON.stringify({
        userId: state.userId,
        matchId: button.dataset.matchId,
        pick: button.dataset.pick,
      }),
    });
    await loadState();
    $("#dateSelect").value = currentDate;
    renderMatches();
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
  });
});

$("#dateSelect").addEventListener("change", renderMatches);
$("#summaryDateSelect").addEventListener("change", (event) => refreshSummary(event.target.value));
$("#refreshButton").addEventListener("click", () => loadState().then(() => toast("已刷新")));
$("#copySummaryButton").addEventListener("click", async () => {
  const text = $("#copySummaryButton").dataset.copyText || "";
  await navigator.clipboard.writeText(text);
  toast("已复制，可粘贴到微信群");
});

loadState().catch((error) => toast(error.message));

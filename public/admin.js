const admin = {
  key: localStorage.getItem("wc_admin_key") || "",
  selectedPoolId: localStorage.getItem("wc_admin_pool_id") || "",
  data: null,
};

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
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": admin.key,
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function formatDateTime(iso) {
  if (!iso) return "未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function currentPool() {
  return admin.data?.pool;
}

function currentPoolShareUrl(pool = currentPool()) {
  if (!pool) return "";
  const origin = window.location.origin;
  return `${origin}${pool.shareUrl}`;
}

function formatPredictionStatus(prediction) {
  if (!prediction.settlement) {
    if (Number(prediction.matchStatus) === 3) return "已结束，待结算";
    if (Number(prediction.matchStatus) === 2) return "进行中";
    return "未结算";
  }
  if (prediction.settlement.status === "void") return "流局";
  const amount = Number(prediction.settlement.amount || 0);
  if (amount > 0) return `猜对 +${amount.toFixed(2)} 元`;
  if (amount < 0) return `猜错 ${amount.toFixed(2)} 元`;
  return "已结算";
}

function renderPoolLinks() {
  const pools = admin.data.pools || [];
  $("#poolLinks").innerHTML = pools
    .map(
      (pool) => `
        <div class="pool-link-row ${pool.id === currentPool().id ? "pool-link-row-active" : ""}">
          <div>
            <strong>${escapeHtml(pool.name)}</strong>
            <div class="muted">${escapeHtml(currentPoolShareUrl(pool))}</div>
          </div>
          <button class="ghost-button copy-pool-link-button" data-pool-link="${escapeHtml(currentPoolShareUrl(pool))}" type="button">复制链接</button>
        </div>
      `
    )
    .join("");
}

function renderUsers() {
  const users = admin.data.adminUsers || admin.data.users || [];
  const maxUsers = Number(admin.data.poolSettings.maxUsers || 0);
  $("#userList").innerHTML = `
    <div class="user-limit-note">当前 ${users.length} 人${maxUsers ? ` / 最多 ${maxUsers} 人` : ""}</div>
    ${users
      .map(
        (user) => `
          <div class="user-row" data-user-id="${escapeHtml(user.id)}">
            <div>
              <input class="user-name-input" value="${escapeHtml(user.name)}" maxlength="24" />
              <div class="user-meta">
                ${escapeHtml(user.id)}
                · ${Number(user.predictionCount || 0)} 个预测
                · 创建 ${formatDateTime(user.createdAt)}
              </div>
            </div>
            <button class="ghost-button save-user-button" type="button">保存</button>
            <button class="danger-button delete-user-button" type="button">移除</button>
          </div>
        `
      )
      .join("")}
  `;
}

function renderPredictionUsers() {
  const users = admin.data.adminPredictionUsers || [];
  $("#predictionUsers").innerHTML = users.length
    ? users
        .map((user) => {
          const rows = user.predictions.length
            ? user.predictions
                .map(
                  (prediction) => `
                    <div class="prediction-row">
                      <div>
                        <div class="prediction-match">${escapeHtml(prediction.homeTeam)} vs ${escapeHtml(
                          prediction.awayTeam
                        )}</div>
                        <div class="prediction-meta">
                          ${escapeHtml(prediction.chinaDate)} ${escapeHtml(prediction.chinaTime)}
                          · ${escapeHtml(prediction.stageName)}${prediction.group ? ` · ${escapeHtml(prediction.group)}组` : ""}
                          · 选择 ${escapeHtml(prediction.pickLabel)}
                        </div>
                      </div>
                      <div class="prediction-outcome">
                        ${
                          prediction.settlement
                            ? `<div>${escapeHtml(prediction.settlement.scoreText || "")} ${escapeHtml(
                                prediction.settlement.resultLabel || ""
                              )}</div>`
                            : ""
                        }
                        <strong class="${
                          Number(prediction.settlement?.amount || 0) > 0
                            ? "amount-positive"
                            : Number(prediction.settlement?.amount || 0) < 0
                              ? "amount-negative"
                              : ""
                        }">${escapeHtml(formatPredictionStatus(prediction))}</strong>
                      </div>
                    </div>
                  `
                )
                .join("")
            : `<p class="muted">这个用户还没有提交过竞猜。</p>`;

          return `
            <section class="prediction-user-card">
              <div class="prediction-user-header">
                <div>
                  <h3>${escapeHtml(user.name)}</h3>
                  <p class="muted">${Number(user.predictionCount || 0)} 个预测 · 创建 ${formatDateTime(user.createdAt)}</p>
                </div>
                <span class="status-pill">${escapeHtml(user.id)}</span>
              </div>
              <div class="prediction-user-list">${rows}</div>
            </section>
          `;
        })
        .join("")
    : `<p class="muted">当前房间还没有任何竞猜记录。</p>`;
}

function renderAdmin() {
  $("#adminLogin").classList.add("hidden");
  $("#adminPanel").classList.remove("hidden");
  $("#adminPanel").classList.add("active");

  admin.selectedPoolId = currentPool().id;
  localStorage.setItem("wc_admin_pool_id", admin.selectedPoolId);

  $("#poolSelect").innerHTML = admin.data.pools
    .map((pool) => `<option value="${pool.id}">${escapeHtml(pool.name)} (${escapeHtml(pool.slug)})</option>`)
    .join("");
  $("#poolSelect").value = currentPool().id;

  $("#appTitleInput").value = admin.data.globalSettings.appTitle;
  $("#poolNameInput").value = currentPool().name;
  $("#stakeInput").value = admin.data.poolSettings.stakeAmount;
  $("#lockInput").value = admin.data.poolSettings.lockMinutes;
  $("#maxUsersInput").value = admin.data.poolSettings.maxUsers || 50;
  $("#autoSyncInput").checked = Boolean(admin.data.globalSettings.autoSyncEnabled);
  $("#autoSyncMinutesInput").value = Math.max(60, Number(admin.data.globalSettings.autoSyncMinutes || 60));
  $("#syncStatus").textContent = `上次同步：${formatDateTime(admin.data.globalSettings.lastSyncAt)}`;

  const settled = admin.data.matches.filter((match) => match.settlement).length;
  const locked = admin.data.matches.filter((match) => match.locked && Number(match.matchStatus) !== 3).length;
  const users = (admin.data.adminUsers || admin.data.users || []).length;
  const maxUsers = admin.data.poolSettings.maxUsers || 50;
  const predictions = admin.data.predictionCount || 0;
  $("#adminOverview").innerHTML = `
    <div class="overview-tile">房间<strong>${escapeHtml(currentPool().name)}</strong></div>
    <div class="overview-tile">用户数<strong>${users}/${maxUsers}</strong></div>
    <div class="overview-tile">已结算比赛<strong>${settled}</strong></div>
    <div class="overview-tile">预测数<strong>${predictions}</strong></div>
  `;

  renderPoolLinks();
  renderUsers();
  renderPredictionUsers();
}

async function loadAdmin(poolId = admin.selectedPoolId) {
  if (!admin.key) return;
  const suffix = poolId ? `?poolId=${encodeURIComponent(poolId)}` : "";
  admin.data = await api(`/api/admin/state${suffix}`);
  renderAdmin();
}

$("#adminKeyInput").value = admin.key;

$("#adminKeyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  admin.key = $("#adminKeyInput").value.trim();
  localStorage.setItem("wc_admin_key", admin.key);
  try {
    await loadAdmin();
    toast("已进入管理页");
  } catch (error) {
    toast(error.message);
  }
});

$("#poolSelect").addEventListener("change", async (event) => {
  admin.selectedPoolId = event.target.value;
  await loadAdmin(admin.selectedPoolId);
});

$("#createPoolForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/admin/pools/create", {
      method: "POST",
      body: JSON.stringify({
        name: $("#newPoolNameInput").value,
        slug: $("#newPoolSlugInput").value,
      }),
    });
    $("#newPoolNameInput").value = "";
    $("#newPoolSlugInput").value = "";
    admin.selectedPoolId = result.pool.id;
    await loadAdmin(admin.selectedPoolId);
    toast("新房间已创建");
  } catch (error) {
    toast(error.message);
  }
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        poolId: currentPool().id,
        appTitle: $("#appTitleInput").value,
        poolName: $("#poolNameInput").value,
        stakeAmount: $("#stakeInput").value,
        lockMinutes: $("#lockInput").value,
        maxUsers: $("#maxUsersInput").value,
        autoSyncEnabled: $("#autoSyncInput").checked,
        autoSyncMinutes: $("#autoSyncMinutesInput").value,
      }),
    });
    await loadAdmin(currentPool().id);
    toast("设置已保存");
  } catch (error) {
    toast(error.message);
  }
});

$("#syncButton").addEventListener("click", async () => {
  try {
    $("#syncButton").disabled = true;
    $("#syncStatus").textContent = "正在同步网易赛程和赛果...";
    const result = await api("/api/admin/sync", { method: "POST", body: "{}" });
    await loadAdmin(currentPool().id);
    toast(`已同步 ${result.updated} 场`);
  } catch (error) {
    toast(error.message);
  } finally {
    $("#syncButton").disabled = false;
  }
});

$("#settleButton").addEventListener("click", async () => {
  try {
    await api("/api/admin/settle", { method: "POST", body: JSON.stringify({ poolId: currentPool().id }) });
    await loadAdmin(currentPool().id);
    toast("已结算当前房间可结算比赛");
  } catch (error) {
    toast(error.message);
  }
});

$("#userList").addEventListener("click", async (event) => {
  const row = event.target.closest(".user-row");
  if (!row) return;
  const userId = row.dataset.userId;
  const name = row.querySelector(".user-name-input").value.trim();

  try {
    if (event.target.matches(".save-user-button")) {
      await api("/api/admin/users/update", {
        method: "POST",
        body: JSON.stringify({ poolId: currentPool().id, userId, name }),
      });
      await loadAdmin(currentPool().id);
      toast("用户名称已保存");
    }

    if (event.target.matches(".delete-user-button")) {
      const confirmed = window.confirm(`确定移除「${name || userId}」吗？他的预测也会被删除。`);
      if (!confirmed) return;
      await api("/api/admin/users/delete", {
        method: "POST",
        body: JSON.stringify({ poolId: currentPool().id, userId }),
      });
      await loadAdmin(currentPool().id);
      toast("用户已移除");
    }
  } catch (error) {
    toast(error.message);
  }
});

$("#poolLinks").addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-pool-link-button");
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.poolLink || "");
  toast("房间链接已复制");
});

loadAdmin().catch(() => {
  $("#adminPanel").classList.add("hidden");
  $("#adminLogin").classList.remove("hidden");
});

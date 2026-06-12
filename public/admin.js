const admin = {
  key: localStorage.getItem("wc_admin_key") || "",
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

function renderUsers() {
  const users = admin.data.adminUsers || admin.data.users || [];
  const maxUsers = Number(admin.data.settings.maxUsers || 0);
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

function renderAdmin() {
  $("#adminLogin").classList.add("hidden");
  $("#adminPanel").classList.remove("hidden");
  $("#adminPanel").classList.add("active");
  $("#appTitleInput").value = admin.data.settings.appTitle;
  $("#stakeInput").value = admin.data.settings.stakeAmount;
  $("#lockInput").value = admin.data.settings.lockMinutes;
  $("#maxUsersInput").value = admin.data.settings.maxUsers || 50;
  $("#autoSyncInput").checked = Boolean(admin.data.settings.autoSyncEnabled);
  $("#autoSyncMinutesInput").value = Math.max(60, Number(admin.data.settings.autoSyncMinutes || 60));
  $("#syncStatus").textContent = `上次同步：${formatDateTime(admin.data.settings.lastSyncAt)}`;

  const settled = admin.data.matches.filter((match) => match.settlement).length;
  const locked = admin.data.matches.filter((match) => match.locked && Number(match.matchStatus) !== 3).length;
  const users = (admin.data.adminUsers || admin.data.users || []).length;
  const maxUsers = admin.data.settings.maxUsers || 50;
  const predictions = admin.data.predictionCount || 0;
  $("#adminOverview").innerHTML = `
    <div class="overview-tile">用户数<strong>${users}/${maxUsers}</strong></div>
    <div class="overview-tile">已结算比赛<strong>${settled}</strong></div>
    <div class="overview-tile">已锁定未完赛<strong>${locked}</strong></div>
    <div class="overview-tile">预测数<strong>${predictions}</strong></div>
  `;
  renderUsers();
}

async function loadAdmin() {
  if (!admin.key) return;
  admin.data = await api("/api/admin/state");
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

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        appTitle: $("#appTitleInput").value,
        stakeAmount: $("#stakeInput").value,
        lockMinutes: $("#lockInput").value,
        maxUsers: $("#maxUsersInput").value,
        autoSyncEnabled: $("#autoSyncInput").checked,
        autoSyncMinutes: $("#autoSyncMinutesInput").value,
      }),
    });
    await loadAdmin();
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
    await loadAdmin();
    toast(`已同步 ${result.updated} 场`);
  } catch (error) {
    toast(error.message);
  } finally {
    $("#syncButton").disabled = false;
  }
});

$("#settleButton").addEventListener("click", async () => {
  try {
    await api("/api/admin/settle", { method: "POST", body: "{}" });
    await loadAdmin();
    toast("已结算可结算比赛");
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
        body: JSON.stringify({ userId, name }),
      });
      await loadAdmin();
      toast("用户名称已保存");
    }

    if (event.target.matches(".delete-user-button")) {
      const confirmed = window.confirm(`确定移除「${name || userId}」吗？他的预测也会被删除。`);
      if (!confirmed) return;
      await api("/api/admin/users/delete", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      await loadAdmin();
      toast("用户已移除");
    }
  } catch (error) {
    toast(error.message);
  }
});

loadAdmin().catch(() => {
  $("#adminPanel").classList.add("hidden");
  $("#adminLogin").classList.remove("hidden");
});

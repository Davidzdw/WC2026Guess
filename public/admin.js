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

function formatDateTime(iso) {
  if (!iso) return "未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function renderAdmin() {
  $("#adminLogin").classList.add("hidden");
  $("#adminPanel").classList.remove("hidden");
  $("#adminPanel").classList.add("active");
  $("#appTitleInput").value = admin.data.settings.appTitle;
  $("#stakeInput").value = admin.data.settings.stakeAmount;
  $("#lockInput").value = admin.data.settings.lockMinutes;
  $("#autoSyncInput").checked = Boolean(admin.data.settings.autoSyncEnabled);
  $("#autoSyncMinutesInput").value = admin.data.settings.autoSyncMinutes;
  $("#lookaheadInput").value = admin.data.settings.knockoutLookaheadHours;
  $("#syncStatus").textContent = `上次同步：${formatDateTime(admin.data.settings.lastSyncAt)}`;

  const settled = admin.data.matches.filter((match) => match.settlement).length;
  const locked = admin.data.matches.filter((match) => match.locked && Number(match.matchStatus) !== 3).length;
  const users = admin.data.users.length;
  const predictions = admin.data.predictionCount || 0;
  $("#adminOverview").innerHTML = `
    <div class="overview-tile">用户数<strong>${users}</strong></div>
    <div class="overview-tile">已结算比赛<strong>${settled}</strong></div>
    <div class="overview-tile">已锁定未完赛<strong>${locked}</strong></div>
    <div class="overview-tile">预测数<strong>${predictions}</strong></div>
  `;
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
        autoSyncEnabled: $("#autoSyncInput").checked,
        autoSyncMinutes: $("#autoSyncMinutesInput").value,
        knockoutLookaheadHours: $("#lookaheadInput").value,
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
    $("#syncStatus").textContent = "正在同步网易赛程和比分...";
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

loadAdmin().catch(() => {
  $("#adminPanel").classList.add("hidden");
  $("#adminLogin").classList.remove("hidden");
});

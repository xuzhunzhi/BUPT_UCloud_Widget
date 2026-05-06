const statusEl = document.getElementById("status");
const statCount = document.getElementById("stat-count");
const statTime = document.getElementById("stat-time");
const statLogin = document.getElementById("stat-login");
const btnSync = document.getElementById("btn-sync");
const btnLogin = document.getElementById("btn-login");
const btnWidget = document.getElementById("btn-open-widget");
const btnSettings = document.getElementById("btn-settings");
const loginBanner = document.getElementById("login-needed-banner");
const btnAutoLogin = document.getElementById("btn-auto-login");
const btnManualLogin = document.getElementById("btn-manual-login");

function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", Boolean(isErr));
}

async function hasLoginSession() {
  try { return await window.buptHw.hasLoginSession(); } catch (_) { return false; }
}

async function getCreds() {
  try { return await window.buptHw.getCredentialsConfig(); } catch (_) { return { username: "", auto_login: false }; }
}

async function updateLoginBanner() {
  const hasSession = await hasLoginSession();
  const creds = await getCreds();
  if (!hasSession) {
    loginBanner.hidden = false;
    btnAutoLogin.hidden = !(creds && creds.auto_login && creds.username);
  } else {
    loginBanner.hidden = true;
  }
}

async function refreshStats() {
  try {
    const data = await window.buptHw.getCache();
    const items = data.items || [];
    const n = items.length;
    statCount.textContent = data._error && !n ? "—" : String(n);
    statTime.textContent = data.updated_at || "—";
  } catch (e) {
    statCount.textContent = "—";
    statTime.textContent = "—";
  }
  try {
    const ok = await hasLoginSession();
    statLogin.textContent = ok ? "已保存（本机）" : "未登录或未导出会话";
  } catch (_) {
    statLogin.textContent = "—";
  }
  await updateLoginBanner();
}

async function doSync() {
  btnSync.disabled = true;
  setStatus("正在同步（启动 Python 抓取）…");
  try {
    const res = await window.buptHw.runFetch();
    const data = await window.buptHw.getCache();
    if (res.ok) {
      const n = (data.items || []).length;
      if (data._warning && n === 0) {
        setStatus(data._warning, true);
      } else {
        setStatus(`同步完成（退出码 ${res.code}），共 ${n} 条`);
      }
    } else {
      const tail = (res.logs && (res.logs.stderr || res.logs.stdout)) || res.error || "";
      setStatus(`同步失败（退出码 ${res.code}）。${tail.slice(0, 280)}`, true);
    }
    await refreshStats();
  } catch (e) {
    setStatus(`同步异常：${e.message}`, true);
  } finally {
    btnSync.disabled = false;
  }
}

btnSync.addEventListener("click", () => doSync());

btnAutoLogin.addEventListener("click", async () => {
  await doSync();
});

btnManualLogin.addEventListener("click", async () => {
  try {
    await window.buptHw.openLoginWindow();
    setStatus("请在登录窗口完成网页登录，再点击「保存登录并关闭」。");
  } catch (e) {
    setStatus(`无法打开登录窗口：${e.message}`, true);
  }
});

btnLogin.addEventListener("click", async () => {
  try {
    await window.buptHw.openLoginWindow();
    setStatus("请在登录窗口完成网页登录，再点击「保存登录并关闭」。");
  } catch (e) {
    setStatus(`无法打开登录窗口：${e.message}`, true);
  }
});

btnWidget.addEventListener("click", async () => {
  try {
    await window.buptHw.openWidgetWindow();
    setStatus("已打开桌面小组件窗口。");
  } catch (e) {
    setStatus(`无法打开小组件：${e.message}`, true);
  }
});

if (btnSettings) {
  btnSettings.addEventListener("click", async () => {
    try {
      await window.buptHw.openSettingsWindow();
      setStatus("已打开设置。");
    } catch (e) {
      setStatus(`无法打开设置：${e.message}`, true);
    }
  });
}

if (window.buptHw.onLoginSessionSaved) {
  window.buptHw.onLoginSessionSaved(async () => {
    await refreshStats();
    setStatus("登录已保存。可在主页或小组件中点击「立即同步」拉取待办。");
  });
}

if (window.buptHw.onCacheUpdated) {
  window.buptHw.onCacheUpdated(async () => {
    await refreshStats();
  });
}

if (window.buptHw.onPrefsChanged) {
  window.buptHw.onPrefsChanged(() => {
    refreshStats();
  });
}

refreshStats().then(() => setStatus("就绪"));

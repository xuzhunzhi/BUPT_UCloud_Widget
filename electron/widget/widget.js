const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const btnSync = document.getElementById("btn-sync");
const btnLogin = document.getElementById("btn-login");
const btnHome = document.getElementById("btn-home");
const metaTime = document.getElementById("meta-time");
const metaRefresh = document.getElementById("meta-refresh");

function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", Boolean(isErr));
}

function render(data) {
  const items = data.items || [];
  if (data._error && !items.length) {
    listEl.innerHTML = `<div class="empty">${escapeHtml(data._error)}</div>`;
    metaTime.textContent = "";
    return;
  }
  if (!items.length) {
    if (data._warning) {
      listEl.innerHTML = `<div class="empty">${escapeHtml(data._warning)}</div>`;
    } else {
      listEl.innerHTML =
        '<div class="empty">暂无条目。请先在主页「立即同步」或点击本窗口「立即同步」。<br/>仍为空可执行 <code>python python/app.py fetch --debug</code></div>';
    }
    metaTime.textContent = data.updated_at ? `缓存时间：${data.updated_at}` : "";
    return;
  }

  metaTime.textContent = data.updated_at ? `缓存时间：${data.updated_at}` : "";

  const frag = document.createDocumentFragment();
  items.forEach((it, i) => {
    const div = document.createElement("div");
    div.className = "card";
    const title = escapeHtml(it.title || "（无标题）");
    const course = it.course ? `<p class="card-meta">${escapeHtml(it.course)}</p>` : "";
    const due = it.due ? `<p class="card-due">${escapeHtml(it.due)}</p>` : "";
    div.innerHTML = `
      <p class="card-title">${i + 1}. ${title}</p>
      ${course}
      ${due}
    `;
    frag.appendChild(div);
  });
  listEl.innerHTML = "";
  listEl.appendChild(frag);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refreshLoginHint() {
  if (!btnLogin) return;
  try {
    const ok = await window.buptHw.hasLoginSession();
    btnLogin.title = ok
      ? "已保存本机登录态，可重新登录以更新"
      : "在客户端内打开教学空间页面登录（无需 Chromium 脚本）";
    btnLogin.textContent = ok ? "重新登录" : "登录";
  } catch (_) {
    btnLogin.textContent = "登录";
  }
}

async function loadCache() {
  try {
    const data = await window.buptHw.getCache();
    render(data);
    setStatus("就绪");
    await refreshLoginHint();
  } catch (e) {
    setStatus(`读取缓存失败：${e.message}`, true);
  }
}

async function doSync() {
  btnSync.disabled = true;
  setStatus("正在同步（启动 Python 抓取）…");
  try {
    const res = await window.buptHw.runFetch();
    const data = res.cache || (await window.buptHw.getCache());
    if (res.ok) {
      render(data);
      const n = (data.items || []).length;
      if (data._warning && n === 0) {
        setStatus(data._warning, true);
      } else {
        setStatus(`同步完成（退出码 ${res.code}），共 ${n} 条`);
      }
    } else {
      render(data);
      const tail = (res.logs && (res.logs.stderr || res.logs.stdout)) || res.error || "";
      setStatus(`同步失败（退出码 ${res.code}）。${tail.slice(0, 220)}`, true);
    }
  } catch (e) {
    setStatus(`同步异常：${e.message}`, true);
  } finally {
    btnSync.disabled = false;
  }
}

let autoTimer = null;

function clearAutoTimer() {
  if (autoTimer != null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

function scheduleAuto(refreshMin) {
  clearAutoTimer();
  const ms = Math.max(1, refreshMin) * 60 * 1000;
  autoTimer = setInterval(() => {
    if (!btnSync.disabled) doSync();
  }, ms);
}

async function applyRefreshSchedule() {
  let refreshMin = 30;
  try {
    refreshMin = await window.buptHw.getRefreshMinutes();
  } catch (_) {}
  if (metaRefresh) {
    metaRefresh.textContent = `每 ${refreshMin} 分钟自动同步待办（爬取并写入缓存）`;
  }
  scheduleAuto(refreshMin);
}

async function init() {
  await loadCache();
  await applyRefreshSchedule();
}

btnSync.addEventListener("click", () => doSync());

if (btnHome) {
  btnHome.addEventListener("click", async () => {
    try {
      await window.buptHw.openHomeWindow();
    } catch (e) {
      setStatus(`无法打开主页：${e.message}`, true);
    }
  });
}

if (btnLogin) {
  btnLogin.addEventListener("click", async () => {
    try {
      await window.buptHw.openLoginWindow();
      setStatus("请在登录窗口完成登录后点击「保存登录并关闭」");
    } catch (e) {
      setStatus(`无法打开登录窗口：${e.message}`, true);
    }
  });
}

if (window.buptHw.onLoginSessionSaved) {
  window.buptHw.onLoginSessionSaved(() => {
    refreshLoginHint();
    setStatus("登录已保存到本机，可点击「立即同步」拉取待办");
  });
}

if (window.buptHw.onCacheUpdated) {
  window.buptHw.onCacheUpdated(() => {
    loadCache();
  });
}

if (window.buptHw.onPrefsChanged) {
  window.buptHw.onPrefsChanged(() => {
    applyRefreshSchedule();
  });
}

init();

// Home Tab
// ===== Home Tab =====
(function () {
  var statusHome = document.getElementById("status-home");
  var userAvatar = document.getElementById("user-avatar");
  var userName = document.getElementById("user-name");
  var userId = document.getElementById("user-id");
  var statCourseCount = document.getElementById("stat-course-count");
  var statTaskCount = document.getElementById("stat-task-count");
  var btnSyncHome = document.getElementById("btn-sync-home");
  var btnSwitchUser = document.getElementById("btn-switch-user");
  var btnOpenWidget = document.getElementById("btn-open-widget-home");
  var cacheUpdated = document.getElementById("cache-updated");
  var cacheStatus = document.getElementById("cache-status");

  function setHomeStatus(text, isErr) {
    statusHome.textContent = text;
    statusHome.classList.toggle("err", !!isErr);
  }

  async function refreshHomeStats() {
    try {
      var creds = await window.buptHw.getCredentialsConfig();
      if (creds && creds.username) {
        userName.textContent = creds.username;
        userId.textContent = "学号 " + creds.username;
        userAvatar.textContent = creds.username.charAt(0).toUpperCase();
      } else {
        userName.textContent = "未登录";
        userId.textContent = "";
        userAvatar.textContent = "?";
      }
    } catch (_) {}

    try {
      var data = await window.buptHw.getCache();
      var items = data.items || [];
      statTaskCount.textContent = String(items.length);
      var cc = data.course_count;
      statCourseCount.textContent = (cc != null && cc > 0) ? String(cc) : "—";
      cacheUpdated.textContent = "上次同步：" + (data.updated_at || "—");
    } catch (_) {
      statTaskCount.textContent = "—";
      statCourseCount.textContent = "—";
    }

    try {
      var hasSession = await window.buptHw.hasLoginSession();
      cacheStatus.textContent = hasSession ? "登录态：已保存" : "登录态：未登录";
    } catch (_) {
      cacheStatus.textContent = "";
    }
  }

  async function doHomeSync() {
    btnSyncHome.disabled = true;
    btnSyncHome.classList.add("syncing");
    setHomeStatus("正在同步（启动 Python 抓取）…");
    try {
      var res = await window.buptHw.runFetch();
      var data = await window.buptHw.getCache();
      var n = (data.items || []).length;
      if (res.ok) {
        setHomeStatus("同步完成，共 " + n + " 条");
      } else {
        var tail = (res.logs && (res.logs.stderr || res.logs.stdout)) || res.error || "";
        setHomeStatus("同步失败（退出码 " + res.code + "）。" + tail.slice(0, 200), true);
      }
      await refreshHomeStats();
    } catch (e) {
      setHomeStatus("同步异常：" + (e.message || e), true);
    } finally {
      btnSyncHome.disabled = false;
      btnSyncHome.classList.remove("syncing");
    }
  }

  btnSyncHome.addEventListener("click", doHomeSync);

  btnSwitchUser.addEventListener("click", function () {
    try { window.buptHw.openLoginWindow(); } catch (_) {}
  });

  btnOpenWidget.addEventListener("click", function () {
    try {
      window.buptHw.openWidgetWindow();
      setHomeStatus("已打开桌面小组件窗口。");
    } catch (e) {
      setHomeStatus("无法打开小组件：" + (e.message || e), true);
    }
  });

  if (window.buptHw.onCacheUpdated) {
    window.buptHw.onCacheUpdated(refreshHomeStats);
  }

  if (window.buptHw.onPrefsChanged) {
    window.buptHw.onPrefsChanged(refreshHomeStats);
  }

  if (window.buptHw.onLoginSessionSaved) {
    window.buptHw.onLoginSessionSaved(function () {
      refreshHomeStats();
      setHomeStatus("登录已保存。可点击「立即同步」拉取待办。");
    });
  }

  refreshHomeStats().then(function () { setHomeStatus(""); });
})();

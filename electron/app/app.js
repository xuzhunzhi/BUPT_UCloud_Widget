// ===== Tab Switching Engine =====
const tabPanels = document.getElementById("tab-panels");
const tabBtns = document.querySelectorAll(".tab-btn");
const TOTAL_TABS = 4;
const TAB_IDS = ["tab-home", "tab-tasks", "tab-courses", "tab-settings"];

let currentTab = 0;
let scrollPositions = {};

function switchTab(index, instant) {
  if (index < 0 || index >= TOTAL_TABS) return;
  currentTab = index;

  if (instant) tabPanels.classList.add("no-transition");
  tabPanels.style.transform = `translateX(-${index * 100}%)`;
  if (instant) {
    tabPanels.offsetHeight;
    tabPanels.classList.remove("no-transition");
  }

  tabBtns.forEach((btn, i) => {
    btn.classList.toggle("active", i === index);
    btn.setAttribute("aria-selected", i === index ? "true" : "false");
  });

  var panel = document.getElementById(TAB_IDS[index]);
  if (panel && scrollPositions[index] != null) {
    panel.scrollTop = scrollPositions[index];
  }

  // Lazy-load settings on first switch to tab 3
  if (index === 3 && !settingsLoaded) {
    settingsLoaded = true;
    loadSettings().then(function () { setSettingsStatus(""); });
  }
}

function saveScrollPosition() {
  var panel = document.getElementById(TAB_IDS[currentTab]);
  if (panel) scrollPositions[currentTab] = panel.scrollTop;
}

tabBtns.forEach(function (btn) {
  btn.addEventListener("click", function () {
    var idx = parseInt(btn.dataset.tab, 10);
    if (idx !== currentTab) {
      saveScrollPosition();
      switchTab(idx);
    }
  });
});

// ===== Swipe (Pointer Events) =====
var swipeStartX = 0;
var swipeDeltaX = 0;
var isSwiping = false;

tabPanels.addEventListener("pointerdown", function (e) {
  swipeStartX = e.clientX;
  swipeDeltaX = 0;
  isSwiping = true;
  tabPanels.classList.add("swiping", "no-transition");
});

tabPanels.addEventListener("pointermove", function (e) {
  if (!isSwiping) return;
  swipeDeltaX = e.clientX - swipeStartX;

  if (Math.abs(swipeDeltaX) < 10) return;

  var maxOffset = (TOTAL_TABS - 1) * 100;
  var baseOffset = currentTab * 100;
  var pixelRatio = (100 / tabPanels.offsetWidth) * swipeDeltaX;
  var newOffset = -baseOffset + pixelRatio;
  newOffset = Math.max(-maxOffset, Math.min(0, newOffset));
  tabPanels.style.transform = "translateX(" + newOffset + "%)";
});

function endSwipe() {
  if (!isSwiping) return;
  isSwiping = false;
  tabPanels.classList.remove("swiping", "no-transition");

  var absDelta = Math.abs(swipeDeltaX);
  if (absDelta > 50) {
    if (swipeDeltaX > 0 && currentTab > 0) {
      saveScrollPosition();
      switchTab(currentTab - 1);
    } else if (swipeDeltaX < 0 && currentTab < TOTAL_TABS - 1) {
      saveScrollPosition();
      switchTab(currentTab + 1);
    } else {
      switchTab(currentTab);
    }
  } else {
    switchTab(currentTab);
  }
}

tabPanels.addEventListener("pointerup", endSwipe);
tabPanels.addEventListener("pointerleave", endSwipe);
tabPanels.addEventListener("pointercancel", endSwipe);

// ===== IPC: main process can command a tab switch =====
if (window.buptHw && window.buptHw.onSwitchTab) {
  window.buptHw.onSwitchTab(function (index) {
    saveScrollPosition();
    switchTab(index);
  });
}

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
      cacheStatus.textContent = "状态：就绪";
    }
  }

  async function doHomeSync() {
    btnSyncHome.disabled = true;
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

  refreshHomeStats().then(function () { setHomeStatus("就绪"); });
})();

// ===== Settings Tab (lazy-loaded) =====
var settingsLoaded = false;
var loadedCreds = { username: "", password: "" };

function setSettingsStatus(text, isErr) {
  var el = document.getElementById("settings-status");
  if (el) {
    el.textContent = text;
    el.classList.toggle("err", Boolean(isErr));
  }
}

function selectedTheme() {
  var r = document.querySelector('input[name="theme"]:checked');
  return r ? r.value : "system";
}

async function loadSettings() {
  var el = function (id) { return document.getElementById("settings-" + id); };

  try {
    var p = await window.buptHw.getStartupPrefs();
    var theme = p.theme || "system";
    var tr = document.querySelector('input[name="theme"][value="' + theme + '"]');
    if (tr) tr.checked = true;

    var syncMin = await window.buptHw.getSyncIntervalMinutes();
    var syncEl = el("sync-minutes");
    if (syncEl) syncEl.value = String(syncMin);

    var chkBoot = el("chk-boot");
    var chkAutosync = el("chk-autosync");
    if (chkBoot) chkBoot.checked = !!p.openAtLogin;
    if (chkAutosync) chkAutosync.checked = p.autoSyncOnLaunch !== false;

    var smode = p.startupOpenMode || "home";
    var sr = document.querySelector('input[name="startupOpenMode"][value="' + smode + '"]');
    if (sr) sr.checked = true;

    var hintBoot = el("hint-boot");
    if (hintBoot) {
      if (!p.isPackaged) {
        hintBoot.textContent = "开发模式下「开机启动」可能指向 Electron 与仓库路径；安装版更稳定。";
      } else if (p.loginItemOpenAtLogin != null && p.loginItemOpenAtLogin !== p.openAtLogin) {
        hintBoot.textContent = "若与系统「任务管理器 → 启动」不一致，可在系统中启用/禁用。";
      } else {
        hintBoot.textContent = "";
      }
    }

    var alertMaster = el("alert-master");
    var alert3d = el("alert-3d");
    var alert1d = el("alert-1d");
    var alertU = el("alert-u");
    var cool3d = el("cool-3d");
    var cool1d = el("cool-1d");
    var coolU = el("cool-u");
    var pollMin = el("poll-min");

    if (alertMaster) alertMaster.checked = p.alertEnabled !== false;
    if (alert3d) alert3d.checked = p.alertThreeDay !== false;
    if (alert1d) alert1d.checked = p.alertOneDay !== false;
    if (alertU) alertU.checked = p.alertUrgent !== false;
    if (cool3d) cool3d.value = String(p.alertCooldown3dMin ?? 360);
    if (cool1d) cool1d.value = String(p.alertCooldown1dMin ?? 120);
    if (coolU) coolU.value = String(p.alertCooldownUrgentMin ?? 30);
    if (pollMin) pollMin.value = String(p.alertPollMinutes ?? 15);

    try {
      var creds = await window.buptHw.getCredentialsConfig();
      var credUser = el("cred-user");
      var credPass = el("cred-pass");
      var credHint = el("cred-hint");
      if (creds && creds.username) {
        if (credUser) credUser.value = creds.username;
        if (credPass) credPass.value = creds.password || "";
        loadedCreds = { username: creds.username, password: creds.password || "" };
        if (credHint) credHint.textContent = creds.auto_login ? "自动登录已开启" : "凭据已保存（自动登录未开启）";
      } else {
        if (credUser) credUser.value = "";
        if (credPass) credPass.value = "";
        loadedCreds = { username: "", password: "" };
        if (credHint) credHint.textContent = "未设置凭据";
      }
    } catch (_) {
      var ch = el("cred-hint");
      if (ch) ch.textContent = "无法读取凭据配置";
    }
  } catch (e) {
    setSettingsStatus("加载失败：" + (e.message || e), true);
  }
}

async function saveSettings() {
  var el = function (id) { return document.getElementById("settings-" + id); };
  var btnSave = el("btn-save");
  if (btnSave) btnSave.disabled = true;
  setSettingsStatus("正在保存…");

  try {
    var credUser = el("cred-user");
    var credPass = el("cred-pass");
    var u = credUser ? credUser.value.trim() : "";
    var p = credPass ? credPass.value.trim() : "";
    var changed = u !== loadedCreds.username || p !== loadedCreds.password;

    if (changed) {
      if (!u && !p) {
        await window.buptHw.saveCredentials("", "");
        loadedCreds = { username: "", password: "" };
        var credHint = el("cred-hint");
        if (credHint) credHint.textContent = "凭据已清空";
      } else if (!u || !p) {
        setSettingsStatus("学号和密码必须同时填写或同时清空", true);
        if (btnSave) btnSave.disabled = false;
        return;
      } else {
        var r = await window.buptHw.saveCredentials(u, p);
        if (r && !r.ok) {
          setSettingsStatus("凭据保存失败：" + (r.error || "未知错误"), true);
          if (btnSave) btnSave.disabled = false;
          return;
        }
        loadedCreds = { username: u, password: p };
        var ch = el("cred-hint");
        if (ch) ch.textContent = "凭据已保存，自动登录已开启";
      }
    }

    var theme = selectedTheme();
    await window.buptHw.setTheme(theme);

    var syncMinEl = el("sync-minutes");
    var sm = Math.max(1, Math.min(1440, parseInt(syncMinEl ? syncMinEl.value : "30", 10) || 30));
    await window.buptHw.setSyncIntervalMinutes(sm);

    var startupModeEl = document.querySelector('input[name="startupOpenMode"]:checked');
    var startupOpenMode = startupModeEl ? startupModeEl.value : "home";

    var chkBoot = el("chk-boot");
    var chkAutosync = el("chk-autosync");
    var alertMaster = el("alert-master");
    var alert3d = el("alert-3d");
    var alert1d = el("alert-1d");
    var alertU = el("alert-u");
    var cool3d = el("cool-3d");
    var cool1d = el("cool-1d");
    var coolU = el("cool-u");
    var pollMin = el("poll-min");

    await window.buptHw.setStartupPrefs({
      startupOpenMode: startupOpenMode,
      openAtLogin: chkBoot ? chkBoot.checked : false,
      autoSyncOnLaunch: chkAutosync ? chkAutosync.checked : true,
      alertEnabled: alertMaster ? alertMaster.checked : false,
      alertThreeDay: alert3d ? alert3d.checked : true,
      alertOneDay: alert1d ? alert1d.checked : true,
      alertUrgent: alertU ? alertU.checked : true,
      alertCooldown3dMin: Math.max(30, parseInt(cool3d ? cool3d.value : "360", 10) || 360),
      alertCooldown1dMin: Math.max(15, parseInt(cool1d ? cool1d.value : "120", 10) || 120),
      alertCooldownUrgentMin: Math.max(5, parseInt(coolU ? coolU.value : "30", 10) || 30),
      alertPollMinutes: Math.max(5, Math.min(120, parseInt(pollMin ? pollMin.value : "15", 10) || 15)),
    });

    setSettingsStatus("已保存。");
  } catch (e) {
    setSettingsStatus("保存失败：" + (e.message || e), true);
  } finally {
    if (btnSave) btnSave.disabled = false;
  }
}

// Theme radio listeners + save button
document.addEventListener("DOMContentLoaded", function () {
  var themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      try { window.buptHw.setTheme(selectedTheme()); } catch (_) {}
    });
  });

  var saveBtn = document.getElementById("settings-btn-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", saveSettings);
  }
});

// ===== Initialize =====
switchTab(0, true);

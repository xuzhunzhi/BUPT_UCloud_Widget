// Settings Tab
var settingsLoaded = false;
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

    // 下载路径
    var dlDir = el("download-dir");
    if (dlDir) {
      try {
        var savedDir = await window.buptHw.getDownloadDir();
        dlDir.value = savedDir || "";
      } catch (_) {}
    }

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

async function saveCredentials() {
  var el = function (id) { return document.getElementById("settings-" + id); };
  var credUser = el("cred-user");
  var credPass = el("cred-pass");
  var u = credUser ? credUser.value.trim() : "";
  var p = credPass ? credPass.value.trim() : "";

  if (!u && !p) {
    await window.buptHw.saveCredentials("", "");
    loadedCreds = { username: "", password: "" };
    var credHint = el("cred-hint");
    if (credHint) credHint.textContent = "凭据已清空";
    setSettingsStatus("凭据已清空");
    return;
  }
  if (!u || !p) {
    setSettingsStatus("学号和密码必须同时填写或同时清空", true);
    return;
  }
  var r = await window.buptHw.saveCredentials(u, p);
  if (r && !r.ok) {
    setSettingsStatus("凭据保存失败：" + (r.error || "未知错误"), true);
    return;
  }
  loadedCreds = { username: u, password: p };
  var ch = el("cred-hint");
  if (ch) ch.textContent = "凭据已保存，自动登录已开启";
  setSettingsStatus("凭据已保存");
}

async function saveAllPrefs() {
  var el = function (id) { return document.getElementById("settings-" + id); };
  try {
    var theme = selectedTheme();
    await window.buptHw.setTheme(theme);

    var syncMinEl = el("sync-minutes");
    var sm = Math.max(1, Math.min(1440, parseInt(syncMinEl ? syncMinEl.value : "30", 10) || 30));
    await window.buptHw.setSyncIntervalMinutes(sm);

    var dlDirEl = el("download-dir");
    if (dlDirEl) {
      await window.buptHw.setDownloadDir(dlDirEl.value.trim() || null);
    }

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
  } catch (_) {}
}

// 下载目录（点击输入框浏览）
function setupDownloadDirBrowse() {
  var input = document.getElementById("settings-download-dir");
  if (!input) return;
  input.addEventListener("click", async function () {
    var result = await window.buptHw.selectDownloadDir();
    if (result.ok && result.path) {
      input.value = result.path;
      saveAllPrefs();
    }
  });
}

// Settings auto-save + credential-specific save button
document.addEventListener("DOMContentLoaded", function () {
  // Theme radios auto-save
  var themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      try { window.buptHw.setTheme(selectedTheme()); } catch (_) {}
    });
  });

  // Credential save button
  var credBtn = document.getElementById("settings-btn-save-creds");
  if (credBtn) {
    credBtn.addEventListener("click", saveCredentials);
  }

  // Auto-save on any settings change
  function wireAutoSave(sel, event) {
    var els = document.querySelectorAll(sel);
    els.forEach(function (el) { el.addEventListener(event, saveAllPrefs); });
  }
  wireAutoSave('#settings-sync-minutes', 'change');
  wireAutoSave('#settings-chk-boot', 'change');
  wireAutoSave('#settings-chk-autosync', 'change');
  wireAutoSave('input[name="startupOpenMode"]', 'change');
  wireAutoSave('#settings-alert-master', 'change');
  wireAutoSave('#settings-alert-3d', 'change');
  wireAutoSave('#settings-alert-1d', 'change');
  wireAutoSave('#settings-alert-u', 'change');
  wireAutoSave('#settings-cool-3d', 'change');
  wireAutoSave('#settings-cool-1d', 'change');
  wireAutoSave('#settings-cool-u', 'change');
  wireAutoSave('#settings-poll-min', 'change');

  setupDownloadDirBrowse();

  // Title bar controls
  var btnMin = document.getElementById("titlebar-minimize");
  var btnClose = document.getElementById("titlebar-close");
  if (btnMin && window.buptHw.windowMinimize) {
    btnMin.addEventListener("click", function () { window.buptHw.windowMinimize(); });
  }
  if (btnClose && window.buptHw.windowClose) {
    btnClose.addEventListener("click", function () { window.buptHw.windowClose(); });
  }

  // Double-click title bar to toggle maximize (if available)
  var titlebar = document.getElementById("titlebar");
  if (titlebar && window.buptHw.windowMaximizeToggle) {
    titlebar.addEventListener("dblclick", function (e) {
      // Ignore double-click on controls
      if (e.target.closest(".titlebar-controls")) return;
      window.buptHw.windowMaximizeToggle();
    });
  }
});


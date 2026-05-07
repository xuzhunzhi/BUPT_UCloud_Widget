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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ===== Tasks Tab =====
(function () {
  var statusTasks = document.getElementById("status-tasks");
  var tasksList = document.getElementById("tasks-list");
  var tasksEmpty = document.getElementById("tasks-empty");
  var tasksCount = document.getElementById("tasks-count");
  var tasksUpdated = document.getElementById("tasks-updated");
  var btnSyncTasks = document.getElementById("btn-sync-tasks");
  var searchInput = document.getElementById("tasks-search");
  var searchClear = document.getElementById("tasks-search-clear");
  var filterCourse = document.getElementById("tasks-filter-course");
  var filterStatus = document.getElementById("tasks-filter-status");

  var allItems = [];
  var courseSet = {};

  function setTasksStatus(text, isErr) {
    statusTasks.textContent = text;
    statusTasks.classList.toggle("err", !!isErr);
  }

  // Parse due string to Date. Returns null if unparseable.
  function parseDueDate(due) {
    if (!due || typeof due !== "string") return null;
    var s = due.trim();
    if (!s) return null;

    // YYYY-MM-DD HH:MM:SS or YYYY-MM-DD HH:MM (with optional "截止" suffix)
    var m = s.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})/);
    if (!m) return null;

    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10) - 1;
    var d = parseInt(m[3], 10);
    var hh = 23;
    var mm = 59;
    var ss = 0;

    var tm = s.match(/(\d{1,2})\s*:\s*(\d{2})(?::(\d{2}))?/);
    if (tm) {
      hh = parseInt(tm[1], 10);
      mm = parseInt(tm[2], 10);
      if (tm[3] != null) ss = parseInt(tm[3], 10);
    }

    var dt = new Date(y, mo, d, hh, mm, ss);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function isOverdue(due) {
    var dt = parseDueDate(due);
    if (!dt) return false;
    return (dt.getTime() - Date.now()) / 3600000 < 0;
  }

  function hoursUntil(due) {
    var dt = parseDueDate(due);
    if (!dt) return null;
    return (dt.getTime() - Date.now()) / 3600000;
  }

  function urgencyLabel(it) {
    if (it.submitted) return "已提交";
    if (isOverdue(it.due)) return "已逾期";
    var dt = parseDueDate(it.due);
    if (!dt) return "";
    var hours = (dt.getTime() - Date.now()) / 3600000;
    if (hours < 24) return "即将截止";
    if (hours < 72) return "临近截止";
    return "";
  }

  function formatDueDisplay(due) {
    if (!due) return "";
    // Clean up: remove trailing "截止", limit length
    var s = due.replace(/截止\s*$/, "").trim();
    return s.length > 30 ? s.slice(0, 30) + "..." : s;
  }

  function buildCourseFilter(items) {
    var seen = {};
    var courses = [];
    items.forEach(function (it) {
      var c = (it.course || "").trim();
      if (c && !seen[c]) {
        seen[c] = true;
        courses.push(c);
      }
    });
    courses.sort();
    // Keep "全部课程" option, remove old options
    while (filterCourse.options.length > 1) {
      filterCourse.remove(1);
    }
    courses.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      filterCourse.appendChild(opt);
    });
  }

  function applyFilters() {
    var searchText = (searchInput.value || "").trim().toLowerCase();
    var courseVal = filterCourse.value;
    var statusVal = filterStatus.value;

    return allItems.filter(function (it) {
      if (courseVal && (it.course || "").trim() !== courseVal) return false;
      if (statusVal === "not-overdue" && isOverdue(it.due)) return false;
      if (statusVal === "submitted" && !it.submitted) return false;
      if (statusVal === "overdue" && !isOverdue(it.due)) return false;
      if (statusVal === "urgent") {
        var h = hoursUntil(it.due);
        if (h === null || h < 0 || h >= 24) return false;
      }
      if (statusVal === "soon") {
        var h2 = hoursUntil(it.due);
        if (h2 === null || h2 < 24 || h2 >= 72) return false;
      }
      if (statusVal === "upcoming") {
        var h3 = hoursUntil(it.due);
        if (h3 === null || h3 < 72 || h3 >= 168) return false;
      }
      if (searchText) {
        var title = (it.title || "").toLowerCase();
        var course = (it.course || "").toLowerCase();
        if (title.indexOf(searchText) === -1 && course.indexOf(searchText) === -1) return false;
      }
      return true;
    });
  }

  function sortByDue(items) {
    return items.slice().sort(function (a, b) {
      var da = parseDueDate(a.due);
      var db = parseDueDate(b.due);
      if (da && db) return da.getTime() - db.getTime();
      if (da && !db) return -1;
      if (!da && db) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });
  }

  function renderTasks() {
    var filtered = applyFilters();
    var sorted = sortByDue(filtered);

    if (!allItems.length) {
      tasksList.innerHTML = "";
      tasksEmpty.style.display = "flex";
      tasksCount.textContent = "";
      tasksUpdated.textContent = "";
      searchClear.style.display = "none";
      return;
    }

    if (!sorted.length) {
      tasksList.innerHTML = "";
      tasksEmpty.style.display = "flex";
      tasksEmpty.querySelector(".empty-text").textContent = "没有匹配的作业";
      tasksEmpty.querySelector(".empty-hint").textContent = "试试调整筛选条件或搜索关键词";
      tasksCount.textContent = "0 / " + allItems.length + " 条";
      return;
    }

    tasksEmpty.style.display = "none";

    // Summary
    var overdueCount = 0;
    var submittedCount = 0;
    sorted.forEach(function (it) {
      if (it.submitted) submittedCount++;
      else if (isOverdue(it.due)) overdueCount++;
    });
    var summary = sorted.length + " 条";
    if (overdueCount > 0) summary += "（" + overdueCount + " 已逾期）";
    if (submittedCount > 0) summary += "（" + submittedCount + " 已提交）";
    if (sorted.length !== allItems.length) summary += " / 筛选自 " + allItems.length + " 条";
    tasksCount.textContent = summary;

    // Render cards
    var frag = document.createDocumentFragment();
    sorted.forEach(function (it, i) {
      var card = document.createElement("div");
      card.className = "task-card";
      if (it.submitted) {
        card.classList.add("submitted");
      } else if (isOverdue(it.due)) {
        card.classList.add("urgent-overdue");
      } else {
        var h = hoursUntil(it.due);
        if (h !== null && h < 24) card.classList.add("urgent-critical");
        else if (h !== null && h < 72) card.classList.add("urgent-soon");
      }

      var label = urgencyLabel(it);
      var dueText = formatDueDisplay(it.due);
      var dueHtml = escapeHtml(dueText);
      if (it.submitted) {
        dueHtml = '<span class="submitted-tag">已提交</span>';
      } else if (label) {
        dueHtml = '<span class="due-label">' + label + "</span>" + dueHtml;
      }

      var dueCls = "";
      if (it.submitted) dueCls = "normal";
      else if (isOverdue(it.due)) dueCls = "overdue";

      card.innerHTML =
        '<div class="task-row">' +
          '<div class="task-info">' +
            '<p class="task-title">' + escapeHtml(it.title || "（无标题）") + "</p>" +
            (it.course ? '<p class="task-course">' + escapeHtml(it.course) + "</p>" : "") +
          "</div>" +
          '<div class="task-due ' + dueCls + '">' +
            dueHtml +
          "</div>" +
        "</div>";

      // TODO: future — click to expand inline content detail

      frag.appendChild(card);
    });

    tasksList.innerHTML = "";
    tasksList.appendChild(frag);
  }

  function loadTasksCache() {
    window.buptHw.getCache().then(function (data) {
      allItems = data.items || [];
      courseSet = {};
      allItems.forEach(function (it) {
        var c = (it.course || "").trim();
        if (c) courseSet[c] = true;
      });
      buildCourseFilter(allItems);
      tasksUpdated.textContent = data.updated_at ? "上次同步：" + data.updated_at : "";
      renderTasks();
      setTasksStatus("就绪");
    }).catch(function (e) {
      setTasksStatus("读取缓存失败：" + (e.message || e), true);
      allItems = [];
      renderTasks();
    });
  }

  function doTasksSync() {
    btnSyncTasks.disabled = true;
    setTasksStatus("正在同步...");
    window.buptHw.runFetch().then(function (res) {
      return window.buptHw.getCache().then(function (data) {
        allItems = data.items || [];
        buildCourseFilter(allItems);
        tasksUpdated.textContent = data.updated_at ? "上次同步：" + data.updated_at : "";
        renderTasks();
        if (res.ok) {
          setTasksStatus("同步完成，共 " + allItems.length + " 条");
        } else {
          var tail = (res.logs && (res.logs.stderr || res.logs.stdout)) || res.error || "";
          setTasksStatus("同步失败（退出码 " + res.code + "）。" + tail.slice(0, 200), true);
        }
      });
    }).catch(function (e) {
      setTasksStatus("同步异常：" + (e.message || e), true);
    }).then(function () {
      btnSyncTasks.disabled = false;
    });
  }

  // Event listeners
  btnSyncTasks.addEventListener("click", doTasksSync);

  searchInput.addEventListener("input", function () {
    searchClear.style.display = searchInput.value ? "block" : "none";
    renderTasks();
  });

  searchClear.addEventListener("click", function () {
    searchInput.value = "";
    searchClear.style.display = "none";
    renderTasks();
  });

  filterCourse.addEventListener("change", function () {
    renderTasks();
  });

  filterStatus.addEventListener("change", function () {
    renderTasks();
  });

  // Listen for cache updates
  if (window.buptHw.onCacheUpdated) {
    window.buptHw.onCacheUpdated(function () {
      loadTasksCache();
    });
  }

  if (window.buptHw.onPrefsChanged) {
    window.buptHw.onPrefsChanged(function () {
      loadTasksCache();
    });
  }

  // Init
  loadTasksCache();
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

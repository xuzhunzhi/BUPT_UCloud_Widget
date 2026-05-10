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

  // Lazy-load courses on first switch to tab 2
  if (index === 2 && !coursesLoaded) {
    coursesLoaded = true;
    loadCourses();
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

  refreshHomeStats().then(function () { setHomeStatus("就绪"); });
})();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Generate a deterministic color from a string (for course accents)
function stringToColor(str) {
  var hues = [200, 160, 280, 340, 40, 100, 20, 300, 180, 80];
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var idx = Math.abs(hash) % hues.length;
  return "hsl(" + hues[idx] + ", 55%, 55%)";
}

function sanitizeHtml(html) {
  // Strip script and iframe tags
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "")
    .replace(/ on\w+='[^']*'/gi, "");
}

// ===== Shared time utility functions =====
function parseDueDate(due) {
  if (!due || typeof due !== "string") return null;
  var s = due.trim();
  if (!s) return null;

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
  var s = due.replace(/截止\s*$/, "").trim();
  return s.length > 30 ? s.slice(0, 30) + "..." : s;
}

// ===== Tasks Tab =====
(function () {
  var statusTasks = document.getElementById("status-tasks");
  var tasksList = document.getElementById("tasks-list");
  var tasksEmpty = document.getElementById("tasks-empty");
  var tasksCount = document.getElementById("tasks-count");
  var tasksUpdated = document.getElementById("tasks-updated");
  var btnSyncTasks = document.getElementById("btn-sync-tasks");
  var filterCourse = document.getElementById("tasks-filter-course");
  var filterStatus = document.getElementById("tasks-filter-status");
  var tasksToolbar = document.querySelector(".tasks-toolbar");
  var tasksSummary = document.querySelector(".tasks-summary");
  var tasksHeader = document.querySelector(".tasks-header");

  var allItems = [];
  var courseSet = {};

  function setTasksStatus(text, isErr) {
    statusTasks.textContent = text;
    statusTasks.classList.toggle("err", !!isErr);
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
        card.style.setProperty("--task-color", "var(--err, #f08080)");
      } else {
        var h = hoursUntil(it.due);
        if (h !== null && h < 24) card.style.setProperty("--task-color", "var(--warn, #e8a045)");
        else if (h !== null && h < 72) card.style.setProperty("--task-color", "#c9a845");
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

      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        showTaskDetail(it, card);
      });

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
    btnSyncTasks.classList.add("syncing");
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
      btnSyncTasks.classList.remove("syncing");
    });
  }

  // Event listeners
  btnSyncTasks.addEventListener("click", doTasksSync);

  filterCourse.addEventListener("change", function () {
    renderTasks();
  });

  filterStatus.addEventListener("change", function () {
    renderTasks();
  });

  // Fix Chromium <select> 下拉菜单被 overflow:hidden 裁剪的问题
  function fixSelectOverflow(sel) {
    var panel = sel.closest(".tab-panel");
    if (!panel) return;
    sel.addEventListener("mousedown", function () {
      panel.style.overflow = "visible";
    });
    sel.addEventListener("change", function () {
      panel.style.overflowY = "auto";
      panel.style.overflowX = "hidden";
    });
    sel.addEventListener("blur", function () {
      panel.style.overflowY = "auto";
      panel.style.overflowX = "hidden";
    });
  }
  fixSelectOverflow(filterCourse);
  fixSelectOverflow(filterStatus);

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

  // ===== Task Detail View =====
  var taskDetailEl = document.getElementById("task-detail");
  var taskDetailBack = document.getElementById("task-detail-back");
  var taskDetailTitle = document.getElementById("task-detail-title");
  var taskDetailMeta = document.getElementById("task-detail-meta");
  var taskDetailBody = document.getElementById("task-detail-body");
  var taskDetailStatus = document.getElementById("task-detail-status");

  function showTaskDetail(item, cardEl) {
    // Set transform-origin from the card position for expand animation
    if (cardEl) {
      var panelRect = taskDetailEl.closest(".tab-panel").getBoundingClientRect();
      var cardRect = cardEl.getBoundingClientRect();
      var originX = ((cardRect.left + cardRect.width / 2) - panelRect.left) / panelRect.width * 100;
      var originY = ((cardRect.top + cardRect.height / 2) - panelRect.top) / panelRect.height * 100;
      taskDetailEl.style.transformOrigin = originX + "% " + originY + "%";
    } else {
      taskDetailEl.style.transformOrigin = "";
    }

    // Hide list view
    tasksList.style.display = "none";
    if (tasksToolbar) tasksToolbar.style.display = "none";
    if (tasksSummary) tasksSummary.style.display = "none";
    if (tasksHeader) tasksHeader.style.display = "none";
    tasksEmpty.style.display = "none";

    // Title
    taskDetailTitle.textContent = item.title || "（无标题）";

    // Meta info as pills
    var dueText = formatDueDisplay(item.due);
    var metaHtml = "";
    if (item.course) {
      metaHtml += '<span class="meta-item"><span class="meta-icon">&#x1F4DA;</span> ' + escapeHtml(item.course) + "</span>";
    }
    if (dueText) {
      metaHtml += '<span class="meta-item"><span class="meta-icon">&#x23F3;</span> ' + escapeHtml(dueText) + "</span>";
    }

    var statusText = "";
    var statusCls = "";
    if (item.submitted) {
      statusText = "已提交";
    } else if (isOverdue(item.due)) {
      statusText = "已逾期";
      statusCls = "overdue";
    } else {
      var h = hoursUntil(item.due);
      if (h !== null && h < 24) {
        statusText = "即将截止";
        statusCls = "urgent";
      } else if (h !== null && h < 72) {
        statusText = "临近截止";
        statusCls = "urgent";
      }
    }
    taskDetailStatus.textContent = statusText;
    taskDetailStatus.className = "task-detail-status" + (statusCls ? " " + statusCls : "");
    taskDetailStatus.style.display = statusText ? "inline" : "none";
    if (statusText) {
      metaHtml += '<span class="meta-item" style="border-color:color-mix(in srgb, var(--accent,#5b9fd4) 30%,transparent)"><span class="meta-icon">&#x1F7E2;</span> ' + statusText + "</span>";
    }
    taskDetailMeta.innerHTML = metaHtml;

    // Body content
    var content = (item.content || "").trim();
    if (content) {
      taskDetailBody.innerHTML = sanitizeHtml(content);
    } else {
      taskDetailBody.innerHTML = '<p style="color:var(--muted,#8b9bb4)">暂无作业内容</p>';
    }

    // Trigger expand animation
    taskDetailEl.classList.remove("shrink");
    taskDetailEl.classList.remove("expand");
    void taskDetailEl.offsetHeight; // force reflow
    taskDetailEl.style.display = "block";
    taskDetailEl.classList.add("expand");
  }

  function hideTaskDetail() {
    taskDetailEl.classList.remove("expand");
    taskDetailEl.classList.add("shrink");
    setTimeout(function () {
      taskDetailEl.style.display = "none";
      taskDetailEl.classList.remove("shrink");
      tasksList.style.display = "";
      if (tasksToolbar) tasksToolbar.style.display = "";
      if (tasksSummary) tasksSummary.style.display = "";
      if (tasksHeader) tasksHeader.style.display = "";
      renderTasks();
    }, 220);
  }

  taskDetailBack.addEventListener("click", hideTaskDetail);

  // 监听课程页传来的「查看作业详情」事件
  document.addEventListener("show-task-detail", function (e) {
    var item = e.detail;
    if (item) showTaskDetail(item, null);
  });

  // 拦截附件链接点击：非图片文件在文件夹中显示
  taskDetailBody.addEventListener("click", function (e) {
    var link = e.target.closest("a[href^='attachment:///']");
    if (link) {
      e.preventDefault();
      var fileHref = link.getAttribute("href");
      var filePath = decodeURIComponent(fileHref.replace(/^attachment:\/\/\//, ""));
      var isImage = /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(filePath);
      if (!isImage) {
        var win = window.buptHw;
        if (win.showInFolder) win.showInFolder(filePath);
        if (win.openFile) win.openFile(filePath);
      }
      return;
    }

    // 教师上传的资源附件：点击后实时下载
    var resLink = e.target.closest("a.resource-download");
    if (resLink) {
      e.preventDefault();
      var rid = resLink.getAttribute("data-resource-id");
      var rname = resLink.getAttribute("data-resource-name") || "";
      var filePath = resLink.getAttribute("data-file-path");

      // 如果已经下载过，直接打开文件夹
      if (filePath && window.buptHw.showInFolder) {
        window.buptHw.showInFolder(filePath);
        return;
      }

      if (rid && window.buptHw.downloadResource) {
        // 禁用链接，显示下载中
        resLink.style.opacity = "0.5";
        resLink.style.pointerEvents = "none";
        resLink.textContent = "下载中... " + rname;
        window.buptHw.downloadResource(rid, rname).then(function (result) {
          if (!result.ok) {
            resLink.style.opacity = "1";
            resLink.style.pointerEvents = "auto";
            resLink.textContent = "\u{1F4CE} " + rname + "（下载失败: " + (result.error || "未知错误") + "）";
          } else {
            // 保存路径，下次点击打开文件夹
            resLink.setAttribute("data-file-path", result.filePath);
            resLink.textContent = "📂 " + rname;
          }
        });
      }
    }
  });

  // Init
  loadTasksCache();
})();

// ===== Courses Tab (lazy-loaded) =====
var coursesLoaded = false;

function loadCourses() {
  var coursesList = document.getElementById("courses-list");
  var coursesEmpty = document.getElementById("courses-empty");
  var coursesCount = document.getElementById("courses-count");
  var statusCourses = document.getElementById("status-courses");
  var courseDetailEl = document.getElementById("course-detail");
  var courseDetailName = document.getElementById("course-detail-name");
  var courseDetailItems = document.getElementById("course-detail-items");
  var courseDetailBack = document.getElementById("course-detail-back");
  var allCachedItems = [];

  function setStatus(text, isErr) {
    statusCourses.textContent = text;
    statusCourses.classList.toggle("err", !!isErr);
  }

  function renderCourses(courses) {
    if (!courses || !courses.length) {
      coursesList.innerHTML = "";
      coursesEmpty.style.display = "flex";
      coursesCount.textContent = "";
      return;
    }

    coursesEmpty.style.display = "none";
    coursesCount.textContent = courses.length + " 门";

    // Build per-course stats from cached items
    var stats = {};
    allCachedItems.forEach(function (it) {
      var c = (it.course || "").trim();
      if (!c) return;
      if (!stats[c]) stats[c] = { total: 0, unsubmitted: 0 };
      stats[c].total++;
      if (!it.submitted) stats[c].unsubmitted++;
    });

    var frag = document.createDocumentFragment();
    courses.forEach(function (course) {
      var name = course.siteName || "未知课程";
      var initial = name.charAt(0).toUpperCase();
      var color = stringToColor(name);
      var s = stats[name] || { total: 0, unsubmitted: 0 };

      var card = document.createElement("div");
      card.className = "course-card";
      card.style.setProperty("--course-color", color);

      card.innerHTML =
        '<div class="course-card-left">' +
          '<span class="course-avatar">' + escapeHtml(initial) + "</span>" +
        "</div>" +
        '<div class="course-card-body">' +
          '<p class="course-name">' + escapeHtml(name) + "</p>" +
          '<p class="course-id">' + escapeHtml(course.id || "") + "</p>" +
          '<div class="course-stats">' +
            '<span class="course-stat">作业 ' + s.total + '</span>' +
            (s.unsubmitted > 0 ? '<span class="course-stat course-stat-pending">未交 ' + s.unsubmitted + '</span>' : '<span class="course-stat course-stat-done">已交齐</span>') +
          "</div>" +
        "</div>";

      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        showCourseDetail(name);
      });

      frag.appendChild(card);
    });

    coursesList.innerHTML = "";
    coursesList.appendChild(frag);
  }

  function showCourseDetail(courseName) {
    coursesList.style.display = "none";
    coursesEmpty.style.display = "none";
    courseDetailEl.style.display = "block";
    courseDetailName.textContent = courseName;

    var items = allCachedItems.filter(function (it) {
      return (it.course || "").trim() === courseName;
    });

    // Sort by due date
    items.sort(function (a, b) {
      var da = parseDueDate(a.due);
      var db = parseDueDate(b.due);
      if (da && db) return da.getTime() - db.getTime();
      if (da && !db) return -1;
      if (!da && db) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });

    if (!items.length) {
      courseDetailItems.innerHTML = '<p style="color:var(--muted,#8b9bb4);padding:20px;text-align:center">该课程暂无作业</p>';
      setStatus(courseName + " — 暂无作业");
      return;
    }

    var frag = document.createDocumentFragment();
    items.forEach(function (it) {
      var card = document.createElement("div");
      card.className = "task-card";
      if (it.submitted) {
        card.classList.add("submitted");
      } else if (isOverdue(it.due)) {
        card.style.setProperty("--task-color", "var(--err, #f08080)");
      } else {
        var h = hoursUntil(it.due);
        if (h !== null && h < 24) card.style.setProperty("--task-color", "var(--warn, #e8a045)");
        else if (h !== null && h < 72) card.style.setProperty("--task-color", "#c9a845");
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
        '<div class="task-row" style="padding:12px 16px">' +
          '<div class="task-info">' +
            '<p class="task-title">' + escapeHtml(it.title || "（无标题）") + "</p>" +
          "</div>" +
          '<div class="task-due ' + dueCls + '">' +
            dueHtml +
          "</div>" +
        "</div>";

      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        // Switch to tasks tab and show detail
        saveScrollPosition();
        switchTab(1);
        // Need a small delay for the tab to render
        setTimeout(function () {
          // Dispatch a custom event that the tasks tab can pick up
          var evt = new CustomEvent("show-task-detail", { detail: it });
          document.dispatchEvent(evt);
        }, 50);
      });

      frag.appendChild(card);
    });

    courseDetailItems.innerHTML = "";
    courseDetailItems.appendChild(frag);
    setStatus(courseName + " — " + items.length + " 项作业");
  }

  function hideCourseDetail() {
    courseDetailEl.style.display = "none";
    coursesList.style.display = "";
    setStatus("");
  }

  courseDetailBack.addEventListener("click", hideCourseDetail);

  function loadCoursesCache() {
    window.buptHw.getCache().then(function (data) {
      allCachedItems = data.items || [];
      var courses = data.courses || [];
      renderCourses(courses);
      if (courses.length > 0) {
        setStatus("共 " + courses.length + " 门课程");
      } else {
        setStatus("暂无课程数据，请先同步");
      }
    }).catch(function (e) {
      setStatus("读取失败：" + (e.message || e), true);
      renderCourses([]);
    });
  }

  if (window.buptHw.onCacheUpdated) {
    window.buptHw.onCacheUpdated(loadCoursesCache);
  }

  loadCoursesCache();
}

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

    // 保存下载路径
    var dlDirEl = el("download-dir");
    if (dlDirEl) {
      await window.buptHw.setDownloadDir(dlDirEl.value.trim() || null);
    }

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

// 下载目录浏览按钮
function setupDownloadDirBrowse() {
  var btn = document.getElementById("settings-btn-browse-dir");
  var input = document.getElementById("settings-download-dir");
  if (!btn || !input) return;
  btn.addEventListener("click", async function () {
    var result = await window.buptHw.selectDownloadDir();
    if (result.ok && result.path) {
      input.value = result.path;
    }
  });
  // 点击输入框也可以选择目录
  input.addEventListener("click", async function () {
    var result = await window.buptHw.selectDownloadDir();
    if (result.ok && result.path) {
      input.value = result.path;
    }
  });
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

  setupDownloadDirBrowse();
});

// ===== Initialize =====
switchTab(0, true);

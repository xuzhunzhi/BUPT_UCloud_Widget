// Tasks Tab
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
    var overrides = window._globalCourseNameOverrides || {};
    items.forEach(function (it) {
      var c = (it.course || "").trim();
      if (c && !seen[c]) {
        seen[c] = true;
        courses.push(c);
      }
    });
    courses.sort();
    while (filterCourse.options.length > 1) {
      filterCourse.remove(1);
    }
    courses.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = overrides[c] || c;
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
      if (statusVal === "overdue" && (!isOverdue(it.due) || it.submitted)) return false;
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
    var filtered = applyTaskOverrides(applyFilters());
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
      tasksEmpty.querySelector(".empty-hint").textContent = "试试调整筛选条件";
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
        card.style.setProperty("--task-color", "var(--accent2, #7eb87c)");
      } else if (isOverdue(it.due)) {
        card.style.setProperty("--task-color", "var(--err, #f08080)");
      } else {
        var h = hoursUntil(it.due);
        if (h !== null && h < 24) card.style.setProperty("--task-color", "var(--warn, #e8a045)");
        else if (h !== null && h < 72) card.style.setProperty("--task-color", "#c9a845");
        else card.style.setProperty("--task-color", "var(--accent, #5b9fd4)");
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

      var courseOverrides = window._globalCourseNameOverrides || {};
      var displayCourse = (it.course && courseOverrides[it.course.trim()]) || it.course || "";
      card.innerHTML =
        '<div class="task-row">' +
          '<div class="task-info">' +
            '<p class="task-title">' + escapeHtml(it.title || "（无标题）") + "</p>" +
            (displayCourse ? '<p class="task-course">' + escapeHtml(displayCourse) + "</p>" : "") +
          "</div>" +
          '<div class="task-due ' + dueCls + '">' +
            dueHtml +
          "</div>" +
        "</div>";

      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        showTaskDetail(it, card);
      });
      card.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showTaskContextMenu(e.clientX, e.clientY, it);
      });

      if (window._staggerCards) {
        card.style.animation = "fadeSlideUp 0.3s ease-out both";
        card.style.animationDelay = (i * 30) + "ms";
      }
      frag.appendChild(card);
    });
    window._staggerCards = false;

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
      setTasksStatus("");
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

  // Filter popup toggle
  var btnFilter = document.getElementById("btn-filter-popup");
  var filterPopup = document.getElementById("filter-popup");
  if (btnFilter && filterPopup) {
    btnFilter.addEventListener("click", function (e) {
      e.stopPropagation();
      filterPopup.style.display = (filterPopup.style.display !== "none") ? "none" : "flex";
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".filter-btn-wrap")) {
        filterPopup.style.display = "none";
      }
    });
  }

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

  // Listen for course prefs changes (name overrides)
  document.addEventListener("course-prefs-changed", function () {
    buildCourseFilter(allItems);
    renderTasks();
  });

  // ===== Task Detail View =====
  var taskDetailEl = document.getElementById("task-detail");
  var taskDetailBack = document.getElementById("task-detail-back");
  var taskDetailTitle = document.getElementById("task-detail-title");
  var taskDetailMeta = document.getElementById("task-detail-meta");
  var taskDetailBody = document.getElementById("task-detail-body");
  var taskDetailStatus = document.getElementById("task-detail-status");

  function showTaskDetail(item, cardEl) {
    // Save current scroll position before switching to detail view
    saveScrollPosition();
    tasksList.closest(".tab-panel").scrollTop = 0;
    // Reduce top spacer for detail view
    var tabInner = taskDetailEl.closest(".tab-inner");
    if (tabInner) tabInner.classList.add("detail-view");

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
    // Restore spacer for list view
    var tabInner = taskDetailEl.closest(".tab-inner");
    if (tabInner) tabInner.classList.remove("detail-view");
    var tasksPanel = tasksList.closest(".tab-panel");
    var savedPos = scrollPositions[1] || 0;
    var fromCourse = window._fromCourseDetail;
    window._fromCourseDetail = false;
    window._staggerCards = true;
    setTimeout(function () {
      taskDetailEl.style.display = "none";
      taskDetailEl.classList.remove("shrink");
      tasksList.style.display = "";
      if (tasksToolbar) tasksToolbar.style.display = "";
      if (tasksSummary) tasksSummary.style.display = "";
      if (tasksHeader) tasksHeader.style.display = "";
      renderTasks();
      if (fromCourse) {
        switchTab(2);
      } else {
        if (tasksPanel) tasksPanel.scrollTop = savedPos;
      }
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

  // ===== Context Menu =====
  var contextMenu = document.getElementById("task-context-menu");
  var contextMenuTarget = null;

  function showTaskContextMenu(x, y, item) {
    contextMenuTarget = item;
    contextMenu.style.display = "block";
    contextMenu.style.left = x + "px";
    contextMenu.style.top = y + "px";
    var rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenu.style.left = (x - rect.width) + "px";
    if (rect.bottom > window.innerHeight) contextMenu.style.top = (y - rect.height) + "px";
  }

  function hideContextMenu() {
    contextMenu.style.display = "none";
    contextMenuTarget = null;
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#task-context-menu")) hideContextMenu();
  });

  contextMenu.addEventListener("click", function (e) {
    var action = e.target.getAttribute("data-action");
    if (!action || !contextMenuTarget) return;
    if (action === "delete") {
      var delTitle = contextMenuTarget.title || "";
      var key = delTitle + "|" + (contextMenuTarget.course || "");
      _taskOverrides[key] = { deleted: true };
      window.buptHw.saveTaskOverride(key, { deleted: true });
      hideContextMenu();
      renderTasks();
      setTasksStatus("已删除：" + delTitle);
    } else if (action === "edit") {
      var target = contextMenuTarget;
      hideContextMenu();
      showTaskEditDialog(target);
    }
  });

  // ===== Edit Dialog =====
  var editOverlay = document.getElementById("task-edit-overlay");
  var editTitle = document.getElementById("task-edit-title");
  var editCourse = document.getElementById("task-edit-course");
  var editMonth = document.getElementById("task-edit-month");
  var editDay = document.getElementById("task-edit-day");
  var editTime = document.getElementById("task-edit-time");
  var editCancel = document.getElementById("task-edit-cancel");
  var editSave = document.getElementById("task-edit-save");
  var editTarget = null;

  // Populate wheel selectors
  (function () {
    for (var m = 1; m <= 12; m++) {
      var opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = m + "月";
      editMonth.appendChild(opt);
    }
    for (var d = 1; d <= 31; d++) {
      var opt = document.createElement("option");
      opt.value = String(d);
      opt.textContent = d + "日";
      editDay.appendChild(opt);
    }
    for (var h = 0; h < 24; h++) {
      for (var mi = 0; mi < 60; mi += 30) {
        var hh = h < 10 ? "0" + h : "" + h;
        var mm = mi < 10 ? "0" + mi : "" + mi;
        var opt = document.createElement("option");
        opt.value = hh + ":" + mm;
        opt.textContent = hh + ":" + mm;
        editTime.appendChild(opt);
      }
    }
  })();

  function showTaskEditDialog(item) {
    editTarget = item;
    editTitle.value = item.title || "";
    editCourse.value = item.course || "";
    // Parse due date: "YYYY-MM-DD HH:MM" or similar
    var due = item.due || "";
    var m = "", d = "", t = "";
    var match = due.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (match) {
      editMonth.value = String(parseInt(match[2], 10));
      editDay.value = String(parseInt(match[3], 10));
      editTime.value = String(parseInt(match[4], 10)).padStart(2, "0") + ":" + match[5];
    }
    editOverlay.style.display = "flex";
    editTitle.focus();
  }

  function hideTaskEditDialog() {
    editOverlay.style.display = "none";
    editTarget = null;
  }

  editCancel.addEventListener("click", hideTaskEditDialog);
  editOverlay.addEventListener("click", function (e) {
    if (e.target === editOverlay) hideTaskEditDialog();
  });

  editSave.addEventListener("click", function () {
    if (!editTarget) return;
    var key = (editTarget.title || "") + "|" + (editTarget.course || "");
    var nt = editTitle.value.trim();
    var nc = editCourse.value.trim();
    var year = "";
    var oldMatch = (editTarget.due || "").match(/(\d{4})-/);
    if (oldMatch) year = oldMatch[1];
    var nd = year + "-" + editMonth.value.padStart(2,"0") + "-" + editDay.value.padStart(2,"0") + " " + editTime.value;
    var patch = {};
    if (nt && nt !== editTarget.title) patch.title = nt;
    if (nc !== (editTarget.course || "")) patch.course = nc;
    if (nd !== (editTarget.due || "")) patch.due = nd;
    if (Object.keys(patch).length === 0) { hideTaskEditDialog(); return; }
    _taskOverrides[key] = patch;
    window.buptHw.saveTaskOverride(key, patch).then(function () {
      hideTaskEditDialog();
      renderTasks();
      setTasksStatus("已更新：" + (nt || editTarget.title || ""));
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && editOverlay.style.display !== "none") hideTaskEditDialog();
  });

  // ===== Task Overrides =====
  var _taskOverrides = {};

  function applyTaskOverrides(items) {
    return items.filter(function (it) {
      var key = (it.title || "") + "|" + (it.course || "");
      var ov = _taskOverrides[key];
      if (ov && ov.deleted) return false;
      if (ov) {
        if (ov.title) it.title = ov.title;
        if (ov.course) it.course = ov.course;
        if (ov.due) it.due = ov.due;
      }
      return true;
    });
  }

  // Init: load overrides + course prefs, then tasks
  Promise.all([
    window.buptHw.getTaskOverrides().catch(function () { return {}; }),
    window.buptHw.getCoursePrefs().catch(function () { return {}; })
  ]).then(function (results) {
    _taskOverrides = results[0] || {};
    window._globalCourseNameOverrides = (results[1] && results[1].names) || {};
    loadTasksCache();
  });
})();

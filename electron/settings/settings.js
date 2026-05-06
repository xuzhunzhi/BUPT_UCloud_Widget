const statusEl = document.getElementById("status");
const syncMinutesEl = document.getElementById("sync-minutes");
const syncHint = document.getElementById("sync-hint");
const credUser = document.getElementById("cred-user-settings");
const credPass = document.getElementById("cred-pass-settings");
const credHint = document.getElementById("cred-hint");
const chkBoot = document.getElementById("chk-boot");
const chkAutosync = document.getElementById("chk-autosync");
const hintBoot = document.getElementById("hint-boot");
const alertMaster = document.getElementById("alert-master");
const alert3 = document.getElementById("alert-3d");
const alert1 = document.getElementById("alert-1d");
const alertU = document.getElementById("alert-u");
const cool3 = document.getElementById("cool-3d");
const cool1 = document.getElementById("cool-1d");
const coolU = document.getElementById("cool-u");
const pollMin = document.getElementById("poll-min");
const btnSave = document.getElementById("btn-save");

let loadedCreds = { username: "", password: "" };

function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", Boolean(isErr));
}

function selectedTheme() {
  const r = document.querySelector('input[name="theme"]:checked');
  return r ? r.value : "system";
}

async function loadAll() {
  try {
    const p = await window.buptHw.getStartupPrefs();
    const theme = p.theme || "system";
    const tr = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (tr) tr.checked = true;

    const syncMin = await window.buptHw.getSyncIntervalMinutes();
    syncMinutesEl.value = String(syncMin);
    syncHint.textContent = "当前写入仓库根目录 config.yaml（widget_refresh_minutes）。";

    chkBoot.checked = !!p.openAtLogin;
    chkAutosync.checked = p.autoSyncOnLaunch !== false;

    const smode = p.startupOpenMode || "home";
    const sr = document.querySelector(`input[name="startupOpenMode"][value="${smode}"]`);
    if (sr) sr.checked = true;
    if (hintBoot) {
      if (!p.isPackaged) {
        hintBoot.textContent =
          "开发模式下「开机启动」可能指向 Electron 与仓库路径；安装版更稳定。";
      } else if (p.loginItemOpenAtLogin != null && p.loginItemOpenAtLogin !== p.openAtLogin) {
        hintBoot.textContent =
          "若与系统「任务管理器 → 启动」不一致，可在系统中启用/禁用。";
      } else {
        hintBoot.textContent = "";
      }
    }

    alertMaster.checked = p.alertEnabled !== false;
    alert3.checked = p.alertThreeDay !== false;
    alert1.checked = p.alertOneDay !== false;
    alertU.checked = p.alertUrgent !== false;
    cool3.value = String(p.alertCooldown3dMin ?? 360);
    cool1.value = String(p.alertCooldown1dMin ?? 120);
    coolU.value = String(p.alertCooldownUrgentMin ?? 30);
    pollMin.value = String(p.alertPollMinutes ?? 15);

    try {
      const creds = await window.buptHw.getCredentialsConfig();
      if (creds && creds.username) {
        credUser.value = creds.username;
        credPass.value = creds.password || "";
        loadedCreds = { username: creds.username, password: creds.password || "" };
        credHint.textContent = creds.auto_login ? "自动登录已开启" : "凭据已保存（自动登录未开启）";
      } else {
        credUser.value = "";
        credPass.value = "";
        loadedCreds = { username: "", password: "" };
        credHint.textContent = "未设置凭据";
      }
    } catch (_) {
      credHint.textContent = "无法读取凭据配置";
    }
  } catch (e) {
    setStatus(`加载失败：${e.message}`, true);
  }
}

async function saveAll() {
  btnSave.disabled = true;
  setStatus("正在保存…");
  try {
    const u = credUser.value.trim();
    const p = credPass.value.trim();
    const changed = u !== loadedCreds.username || p !== loadedCreds.password;

    if (changed) {
      // 要清空凭据：两个字段都为空
      if (!u && !p) {
        // 写入空凭据以清除
        await window.buptHw.saveCredentials("", "");
        loadedCreds = { username: "", password: "" };
        credHint.textContent = "凭据已清空";
      } else if (!u || !p) {
        setStatus("学号和密码必须同时填写或同时清空", true);
        btnSave.disabled = false;
        return;
      } else {
        const r = await window.buptHw.saveCredentials(u, p);
        if (r && !r.ok) {
          setStatus("凭据保存失败：" + (r.error || "未知错误"), true);
          btnSave.disabled = false;
          return;
        }
        loadedCreds = { username: u, password: p };
        credHint.textContent = "凭据已保存，自动登录已开启";
      }
    }

    const theme = selectedTheme();
    await window.buptHw.setTheme(theme);

    const sm = Math.max(1, Math.min(1440, parseInt(syncMinutesEl.value, 10) || 30));
    await window.buptHw.setSyncIntervalMinutes(sm);

    const startupModeEl = document.querySelector('input[name="startupOpenMode"]:checked');
    const startupOpenMode = startupModeEl ? startupModeEl.value : "home";

    await window.buptHw.setStartupPrefs({
      startupOpenMode,
      openAtLogin: chkBoot.checked,
      autoSyncOnLaunch: chkAutosync.checked,
      alertEnabled: alertMaster.checked,
      alertThreeDay: alert3.checked,
      alertOneDay: alert1.checked,
      alertUrgent: alertU.checked,
      alertCooldown3dMin: Math.max(30, parseInt(cool3.value, 10) || 360),
      alertCooldown1dMin: Math.max(15, parseInt(cool1.value, 10) || 120),
      alertCooldownUrgentMin: Math.max(5, parseInt(coolU.value, 10) || 30),
      alertPollMinutes: Math.max(5, Math.min(120, parseInt(pollMin.value, 10) || 15)),
    });

    setStatus("已保存。");
  } catch (e) {
    setStatus(`保存失败：${e.message}`, true);
  } finally {
    btnSave.disabled = false;
  }
}

document.querySelectorAll('input[name="theme"]').forEach((el) => {
  el.addEventListener("change", async () => {
    try {
      await window.buptHw.setTheme(selectedTheme());
    } catch (_) {}
  });
});

btnSave.addEventListener("click", () => saveAll());

loadAll().then(() => setStatus(""));

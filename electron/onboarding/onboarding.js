const loginStatusEl = document.getElementById("login-status");
const panelStep2 = document.getElementById("panel-step2");
const btnSaveCred = document.getElementById("btn-save-cred");
const credUser = document.getElementById("cred-user");
const credPass = document.getElementById("cred-pass");
const linkWebviewLogin = document.getElementById("link-webview-login");
const btnDone = document.getElementById("btn-done");
const chkBoot = document.getElementById("chk-boot");
const alertMaster = document.getElementById("alert-master");
const statusEl = document.getElementById("status");
let pollTimer = null;

function setStatus(text, isErr) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", Boolean(isErr));
}

function updateLoginStatus(text, ok) {
  loginStatusEl.textContent = text;
  loginStatusEl.classList.toggle("ok", Boolean(ok));
}

function selectedTheme() {
  const r = document.querySelector('input[name="theme"]:checked');
  return r ? r.value : "system";
}

function selectedStartupMode() {
  const r = document.querySelector('input[name="startupOpenMode"]:checked');
  return r ? r.value : "widget";
}

function enableStep2() {
  panelStep2.classList.add("enabled");
  btnDone.disabled = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshLoginUi() {
  try {
    const hasSession = await window.buptHw.hasLoginSession();
    const creds = await window.buptHw.getCredentialsConfig();
    if (creds && creds.username && creds.auto_login) {
      credUser.value = creds.username;
      updateLoginStatus("已保存凭据，可继续下一步", true);
      enableStep2();
    } else if (hasSession) {
      updateLoginStatus("已保存登录状态（Cookie），可继续下一步", true);
      enableStep2();
    } else {
      updateLoginStatus("尚未保存凭据", false);
      panelStep2.classList.remove("enabled");
      btnDone.disabled = true;
    }
  } catch (_) {
    updateLoginStatus("无法检测登录状态", false);
  }
}

async function loadDefaults() {
  try {
    const p = await window.buptHw.getStartupPrefs();
    const theme = p.theme || "system";
    const tr = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (tr) tr.checked = true;

    const mode = p.startupOpenMode || "widget";
    const mr = document.querySelector(`input[name="startupOpenMode"][value="${mode}"]`);
    if (mr) mr.checked = true;

    chkBoot.checked = p.openAtLogin !== false;
    alertMaster.checked = p.alertEnabled !== false;
  } catch (e) {
    setStatus(`加载偏好失败：${e.message}`, true);
  }
}

btnSaveCred.addEventListener("click", async () => {
  const u = credUser.value.trim();
  const p = credPass.value.trim();
  if (!u || !p) {
    setStatus("请输入学号和密码", true);
    return;
  }
  btnSaveCred.disabled = true;
  setStatus("正在保存凭据…");
  try {
    const r = await window.buptHw.saveCredentials(u, p);
    if (r && r.ok) {
      setStatus("凭据已保存 ✓");
      updateLoginStatus("已保存凭据，可继续下一步", true);
      enableStep2();
    } else {
      setStatus(r && r.error ? r.error : "保存失败", true);
    }
  } catch (e) {
    setStatus(`保存失败：${e.message}`, true);
  }
  btnSaveCred.disabled = false;
});

linkWebviewLogin.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await window.buptHw.openLoginWindow();
    setStatus("请在登录窗口完成网页登录，再点击「保存登录并关闭」。");
  } catch (err) {
    setStatus(`无法打开登录窗口：${err.message}`, true);
  }
});

document.querySelectorAll('input[name="theme"]').forEach((el) => {
  el.addEventListener("change", async () => {
    try {
      await window.buptHw.setTheme(selectedTheme());
    } catch (_) {}
  });
});

window.buptHw.onLoginSessionSaved(() => {
  refreshLoginUi();
  setStatus("网页登录已保存 ✓");
});

btnDone.addEventListener("click", async () => {
  btnDone.disabled = true;
  setStatus("正在保存…");
  try {
    await window.buptHw.completeOnboarding({
      startupOpenMode: selectedStartupMode(),
      openAtLogin: chkBoot.checked,
      autoSyncOnLaunch: true,
      alertEnabled: alertMaster.checked,
      theme: selectedTheme(),
    });
  } catch (e) {
    setStatus(`保存失败：${e.message}`, true);
    btnDone.disabled = false;
  }
});

function startLoginPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    refreshLoginUi();
  }, 1200);
}

loadDefaults().then(() => {
  refreshLoginUi();
  startLoginPoll();
});

"""
CAS 自动登录模块：检测登录页面、填写账号密码、提交并验证。
由 homework_fetcher.fetch_homework() 在检测到未登录时调用。
"""
from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import Page


def _is_cas_login_page(page: Page) -> bool:
    """检测当前页面是否需要登录（不依赖可见性，只查 DOM）。"""
    url = page.url.lower()
    if "cas" in url and ("login" in url or "auth" in url):
        return True
    if "login" in url and ("passport" in url or "sso" in url or "auth" in url):
        return True
    # 页面内有密码输入框（不检查可见性，在 headless 下可能为 False）
    try:
        if page.locator("input[type='password']").count() > 0:
            return True
    except Exception:
        pass
    return False


def _js_fill_and_submit(page: Page, username: str, password: str) -> bool:
    """通过 JavaScript 直接填写表单并提交（绕过 headless 可见性检查）。"""
    # 使用参数化方式传值，避免特殊字符破坏 JS 语法
    result = page.evaluate(
        """([u, p]) => {
            // 先尝试主页面内的表单
            let userEl = document.querySelector("input[name='username']");
            let passEl = document.querySelector("input[name='password']");
            let submitEl = document.querySelector("input[name='submit'], button[type='submit'], .btn-login, input.btn-login, #loginForm input[type='submit']");

            // 再尝试 iframe 内的表单
            if (!userEl || !passEl) {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (doc) {
                            const u = doc.querySelector("input[name='username']");
                            const p = doc.querySelector("input[name='password']");
                            if (u && p) {
                                userEl = u;
                                passEl = p;
                                submitEl = doc.querySelector("input[name='submit'], button[type='submit'], .btn-login, input.btn-login");
                                break;
                            }
                        }
                    } catch(e) {}
                }
            }

            if (!userEl || !passEl) return 'no_inputs';

            // 原生 setter 触发 React/Vue 等框架的响应
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            );
            if (nativeSetter && nativeSetter.set) {
                nativeSetter.set.call(userEl, u);
                nativeSetter.set.call(passEl, p);
            } else {
                userEl.value = u;
                passEl.value = p;
            }

            userEl.dispatchEvent(new Event('input', {bubbles: true}));
            userEl.dispatchEvent(new Event('change', {bubbles: true}));
            passEl.dispatchEvent(new Event('input', {bubbles: true}));
            passEl.dispatchEvent(new Event('change', {bubbles: true}));

            // 提交
            if (submitEl) {
                submitEl.click();
                return 'clicked';
            }
            // 尝试 Enter 键
            passEl.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
            return 'entered';
        }""",
        [username, password],
    )
    return result != "no_inputs"


def perform_auto_login(page: Page, cfg: dict[str, Any]) -> bool:
    """在给定 page 上执行自动登录。成功返回 True，失败返回 False。"""
    username = str(cfg.get("username") or "").strip()
    password = str(cfg.get("password") or "").strip()

    if not username or not password:
        print("[自动登录] 未配置 username/password，跳过", flush=True)
        return False

    if not _is_cas_login_page(page):
        print("[自动登录] 当前不在 CAS 登录页，尝试导航触发重定向...", flush=True)
        login_url = str(cfg.get("login_start_url") or cfg.get("target_url") or "")
        if not login_url:
            print("[自动登录] 未配置 login_start_url，无法自动登录", flush=True)
            return False
        try:
            page.context.clear_cookies()
            page.goto(login_url, wait_until="networkidle", timeout=60_000)
            page.wait_for_timeout(5000)
            print(f"[自动登录] 导航后当前 URL: {page.url[:120]}", flush=True)
            try:
                page.wait_for_url(
                    lambda u: "cas" in u.lower() or "auth" in u.lower(),
                    timeout=20_000,
                )
            except Exception:
                print("[自动登录] 未检测到 CAS 跳转，尝试在当前页查找登录表单", flush=True)
        except Exception as e:
            print(f"[自动登录] 导航失败: {e}", flush=True)
            return False

        if not _is_cas_login_page(page):
            pw_count = page.locator("input[type='password']").count()
            print(f"[自动登录] 当前页面密码输入框数量: {pw_count}", flush=True)
            if pw_count == 0:
                print("[自动登录] 当前页面无可用的登录表单，放弃", flush=True)
                return False

    print("[自动登录] 检测到登录页面，尝试 JS 填写凭据...", flush=True)

    # 等待表单 DOM 就绪
    try:
        page.wait_for_selector("input[name='username'], input[type='password']", timeout=10_000)
    except Exception:
        # 不阻塞，继续尝试
        pass
    page.wait_for_timeout(1500)

    result = _js_fill_and_submit(page, username, password)
    print(f"[自动登录] JS 填写结果: {result}", flush=True)

    if result == "no_inputs":
        print("[自动登录] 未找到登录表单元素", flush=True)
        return False

    print("[自动登录] 已提交登录，等待页面跳转...", flush=True)

    # 等待页面跳转回 ucloud
    try:
        page.wait_for_url(
            re.compile(r"ucloud\.bupt\.edu\.cn"),
            timeout=30_000,
        )
        print("[自动登录] 已跳转回 ucloud", flush=True)
    except Exception:
        cur = page.url.lower()
        if "ucloud.bupt.edu.cn" in cur:
            print("[自动登录] 已在 ucloud 域名", flush=True)
        else:
            print(f"[自动登录] 未能跳转回 ucloud，当前: {page.url[:120]}", flush=True)

    page.wait_for_timeout(3000)

    if _is_cas_login_page(page):
        print("[自动登录] 登录失败：仍在登录页面，请检查账号密码", flush=True)
        return False

    # 登录成功后将 session 保存为 storage_state
    try:
        from pathlib import Path
        from homework_fetcher import STORAGE_STATE_PATH
        STORAGE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        page.context.storage_state(path=str(STORAGE_STATE_PATH))
        print("[自动登录] 已保存登录会话", flush=True)
    except Exception as e:
        print(f"[自动登录] 保存会话失败: {e}", flush=True)

    if "ucloud.bupt.edu.cn" in page.url.lower():
        print("[自动登录] 登录成功！", flush=True)
        return True

    return False

"""
从北邮云邮教学空间学生端抓取作业列表（需已登录）。
页面为 SPA，使用 Playwright 持久化 profile 保存登录态。
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import yaml
from playwright.sync_api import BrowserContext, Page, Response, sync_playwright

from paths import DATA_DIR, SCRIPT_DIR

CONFIG_PATH = DATA_DIR / "config.yaml"
CACHE_PATH = DATA_DIR / "homework_cache.json"
EXAMPLE_CONFIG = SCRIPT_DIR / "config.example.yaml"
# 由 Electron 内登录页导出，供 Playwright 复用 cookies（避免单独开 Chromium 登录）
STORAGE_STATE_PATH = DATA_DIR / "playwright_storage_state.json"

# homework_cache.json 版本，便于以后迁移字段
CACHE_SCHEMA_VERSION = 1


@dataclass
class HomeworkItem:
    title: str
    course: str
    due: str
    raw: str
    url: str = ""


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.is_file():
        if EXAMPLE_CONFIG.is_file():
            CONFIG_PATH.write_text(EXAMPLE_CONFIG.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            raise FileNotFoundError("缺少 config.yaml 与 config.example.yaml")
    with CONFIG_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def resolve_portal_url(cfg: dict[str, Any]) -> str:
    u = cfg.get("target_url") or cfg.get("login_start_url") or ""
    return str(u).strip() if u else ""


def resolve_alternate_urls(cfg: dict[str, Any]) -> list[str]:
    """额外尝试的页面 URL（待办不在首页时常用）。"""
    raw = cfg.get("alternate_target_urls") or cfg.get("extra_target_urls")
    if not raw:
        return []
    if isinstance(raw, str):
        lines = [x.strip() for x in raw.replace("\n", ",").split(",") if x.strip()]
        return lines
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    return []


def _network_capture_url_ok(url: str, cfg: dict[str, Any]) -> bool:
    subs = cfg.get("network_capture_url_substrings")
    if subs is None:
        subs = [
            "ucloud.bupt.edu.cn",
            "bupt.edu.cn",
            "uclass",
            "/api/",
            "homework",
            "task",
            "activity",
            "todo",
            "student",
        ]
    elif isinstance(subs, str):
        subs = [subs]
    else:
        subs = list(subs)
    u = url.lower()
    return any(s.lower() in u for s in subs if s)


def _normalize_due_for_dedup(due: str) -> str:
    """标准化截止时间用于去重比较：去除'截止'后缀、统一时分秒格式。"""
    d = (due or "").strip()
    d = re.sub(r"截止\s*$", "", d)
    d = re.sub(r"(\d{2}:\d{2}):\d{2}", r"\1", d)
    return d[:120]


def _dedupe_homework_items(items: list[HomeworkItem]) -> list[HomeworkItem]:
    seen: set[tuple[str, str]] = set()
    out: list[HomeworkItem] = []
    for it in items:
        key = (it.title[:240], _normalize_due_for_dedup(it.due))
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def _filter_junk_items(items: list[HomeworkItem]) -> list[HomeworkItem]:
    """过滤明显不是课业条目的垃圾结果（侧边栏统计数字、导航标签等）。"""
    out: list[HomeworkItem] = []
    for it in items:
        title = it.title.strip()
        raw = (it.raw or "").strip()
        due = (it.due or "").strip()

        # 标题为纯数字（如 "14"、"36"）
        if title.isdigit():
            continue
        # 标题过短且无中文，很可能是 badge/icon 文本
        if len(title) < 4 and not re.search(r"[一-鿿]", title):
            continue
        # 空壳条目：raw == title 且无截止日期/课程，大概率是页面标签/分类标题
        if raw.strip() == title and not due and not it.course:
            continue
        # 标题等于 raw 且只有几个字、无课业关键词
        if title == raw and len(title) <= 4:
            if not re.search(r"作业|任务|测验|考试|问卷|实验|报告|提交|截止", title):
                continue
        # raw 看起来像 "数字\n标签" 的统计 badge
        lines = [x.strip() for x in raw.split("\n") if x.strip()]
        if len(lines) == 2 and lines[0].isdigit():
            if re.match(r"^(课程|班级|学生|教师|待办|通知|消息|作业|任务)$", lines[1]):
                continue
        # 标题是纯数字+单位（如 "14门"、"36条"）
        if re.match(r"^\d+\s*(门|条|个|项|人|次|篇)$", title):
            continue
        # 标题看起来像导航菜单项而非课业
        nav_patterns = [
            "首页", "个人中心", "设置", "退出", "消息中心", "通知", "我的课程",
            "课程中心", "教师主页", "学生主页", "学情首页", "课程基本信息",
            "我的课堂", "我的课堂-学生", "我的问卷-学生",
            "教学云平台菜单", "查看成绩",
        ]
        if title in nav_patterns:
            continue
        # 看起来像菜单/权限条目（含 "-老师"/"-学生" 后缀且无截止时间）
        if re.search(r"-(老师|学生|教师)$", title) and not due:
            continue
        # 无截止时间且标题像通用页面名
        if not due and re.match(
            r"^(作业|主题|问卷|反馈|反思|公告|测验|讨论|成员|课件|考勤|签到).{0,10}(列表|详情|首页|中心|信息|数据)",
            title,
        ):
            continue
        # 看起来像新闻/通知而非课业（含"通报"、"公示"且无关作业截止）
        if re.search(r"(通报|公示|通知$)", title) and not re.search(r"作业|提交|截止|实验|考试|测验", title):
            continue

        out.append(it)
    return out


def extract_homework_from_json_tree(data: Any, source_url: str = "") -> list[HomeworkItem]:
    """从接口返回的 JSON 递归提取疑似课业条目（教学空间多为接口渲染 DOM）。"""
    title_key_pref = (
        "homeworkTitle",
        "activityTitle",
        "taskTitle",
        "activityName",
        "paperTitle",
        "lessonTitle",
        "taskName",
        "title",
        "subjectName",
        "courseHomeworkTitle",
        "name",
    )
    title_key_re = re.compile(
        r"(title|homework|activity|task|paper|lesson|subject|course|assignment|workName)",
        re.I,
    )
    time_key_re = re.compile(
        r"(deadline|endTime|dueDate|submitEnd|closeTime|expire|limitTime|endDate)",
        re.I,
    )
    out: list[HomeworkItem] = []
    seen: set[tuple[str, str]] = set()
    nodes = 0
    max_nodes = 35_000

    def maybe_emit_from_dict(d: dict[str, Any]) -> None:
        nonlocal out
        if len(json.dumps(d, ensure_ascii=False)) > 12_000:
            return
        blob = json.dumps(d, ensure_ascii=False)
        title = ""
        matched_pref = ""
        for pk in title_key_pref:
            for k, v in d.items():
                if str(k).lower() != pk.lower():
                    continue
                if isinstance(v, str) and len(v.strip()) > 3:
                    title = v.strip()[:500]
                    matched_pref = pk.lower()
                    break
            if title:
                break
        if not title:
            for k, v in d.items():
                if not isinstance(v, str):
                    continue
                if len(v.strip()) < 4:
                    continue
                if title_key_re.search(str(k)):
                    title = v.strip()[:500]
                    break
        if not title:
            return
        strong_pref = matched_pref and matched_pref not in ("title", "name")
        if not strong_pref and not re.search(
            r"作业|任务|测验|考试|问卷|预习|实验|报告|讨论|待办|homework|assignment|todo|course",
            blob,
            re.I,
        ):
            return
        due = ""
        course = ""
        for k, v in d.items():
            if not isinstance(v, str):
                continue
            vs = v.strip()
            if not vs:
                continue
            lk = str(k)
            if time_key_re.search(lk):
                due = vs[:220]
            if re.search(r"courseName|courseTitle|siteName|班级|课程名", lk, re.I):
                course = vs[:200]
        raw = blob[:500]
        key = (title[:240], due[:120])
        if key in seen:
            return
        seen.add(key)
        out.append(
            HomeworkItem(
                title=title,
                course=course,
                due=due,
                raw=raw,
                url=source_url[:300],
            )
        )

    def walk(obj: Any, depth: int) -> None:
        nonlocal nodes
        if depth > 14 or nodes > max_nodes:
            return
        nodes += 1
        if isinstance(obj, dict):
            maybe_emit_from_dict(obj)
            for v in obj.values():
                walk(v, depth + 1)
        elif isinstance(obj, list):
            for el in obj[:900]:
                walk(el, depth + 1)

    walk(data, 0)
    return out


def _attach_network_json_capture(
    page: Page,
    bucket: list[dict[str, Any]],
    cfg: dict[str, Any],
    *,
    debug_dump: bool = False,
    debug_all_bucket: list[dict[str, Any]] | None = None,
) -> None:
    """监听 HTTP 响应的 JSON/XHR/fetch 等（平台课业数据多在接口里）。

    非 debug 模式仅捕获疑似 API 的 JSON 响应写入 *bucket*；
    debug 模式下同时将所有 HTTP 响应写入 *debug_all_bucket*（用于诊断 API 端点）。
    """

    def on_response(response: Response) -> None:
        try:
            req = response.request
            rt = req.resource_type or ""
            url = response.url
            status = response.status

            # debug 模式：记录所有 bupt/ucloud 请求到诊断桶
            if debug_dump and debug_all_bucket is not None and ("ucloud" in url or "bupt" in url or "api" in url.lower()):
                ct = (response.headers.get("content-type") or "").lower()
                body_preview = ""
                try:
                    body = response.body()
                    if len(body) < 200_000:
                        body_preview = body.decode("utf-8", errors="replace")[:3000]
                except Exception:
                    pass
                debug_all_bucket.append({
                    "url": url[:500],
                    "status": status,
                    "resource_type": rt,
                    "content_type": ct[:200],
                    "method": req.method,
                    "body_preview": body_preview[:2000],
                })
                if "ucloud" in url or "bupt" in url:
                    print(f"[网络] {rt:12} {status} {url[:120]}", flush=True)

            # 仅关注可能含数据的请求类型（放宽条件，也捕获 preflight/doc 以外的所有类型）
            if rt in ("preflight", "ping", "csp_report", "media", "image", "font", "stylesheet"):
                return
            if not _network_capture_url_ok(url, cfg):
                return
            ct = (response.headers.get("content-type") or "").lower()
            cl = response.headers.get("content-length")
            if cl and int(cl) > 6_000_000:
                return
            body = response.body()
            if len(body) > 5_000_000:
                return
            text = body.decode("utf-8", errors="replace").strip()
            if not text or text[0] not in "{[":
                return
            looks_json = "json" in ct or url.split("?")[0].lower().endswith(".json")
            if not looks_json and len(text) > 2_000_000:
                return
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                return
            bucket.append({"url": url, "data": data, "status": status})
            print(f"[捕获接口] {status} {url[:130]}", flush=True)
        except Exception:
            return

    page.on("response", on_response)


def _detect_login_state(page: Page) -> dict[str, Any]:
    """检测当前页面登录状态。返回包含 is_logged_in 等字段的字典。"""
    result: dict[str, Any] = {"is_logged_in": False, "reason": "unknown", "page_url": page.url}
    try:
        title = page.title()
        result["page_title"] = title

        # 检查是否 SPA 显示 404（路由无效或未登录导致）
        try:
            not_found = page.locator(".not-found")
            if not_found.count() > 0 and not_found.first.is_visible():
                result["reason"] = "spa_showing_404_page"
                result["hint"] = "SPA 显示 404，可能是登录态已过期导致所有路由失效。请在应用内重新登录后重试。"
                return result
        except Exception:
            pass

        # 检查 URL 是否重定向到 CAS 登录
        current_url = page.url.lower()
        if "cas" in current_url and ("login" in current_url or "auth" in current_url):
            result["reason"] = "redirected_to_cas_login"
            return result
        if "login" in current_url and "passport" in current_url:
            result["reason"] = "redirected_to_passport_login"
            return result

        # 检查页面元素：是否有登录按钮/表单
        login_indicators = [
            "input[type='password']",
            "button:has-text('登录')",
            "a:has-text('登录')",
            ".login-btn",
            "#login",
            "[class*='login']",
        ]
        for sel in login_indicators:
            try:
                el = page.locator(sel)
                if el.count() > 0 and el.first.is_visible():
                    result["reason"] = f"found_login_element: {sel}"
                    return result
            except Exception:
                continue

        # 检查是否有用户信息元素（表示已登录）
        user_indicators = [
            "[class*='avatar']",
            "[class*='user']",
            "[class*='nickname']",
            ".el-avatar",
            "img[alt*='头像']",
        ]
        has_user_element = False
        for sel in user_indicators:
            try:
                el = page.locator(sel)
                if el.count() > 0 and el.first.is_visible():
                    has_user_element = True
                    break
            except Exception:
                continue

        if has_user_element:
            result["is_logged_in"] = True
            result["reason"] = "found_user_element"
        else:
            result["reason"] = "no_login_or_user_elements_found"
    except Exception as e:
        result["reason"] = f"detection_error: {e}"

    return result


def _items_from_network_bucket(bucket: list[dict[str, Any]]) -> list[HomeworkItem]:
    items: list[HomeworkItem] = []
    skip_url_substrings = [
        "/menu/role-grant",
        "/menu/",
        "/oauth/token",
        "/userroledomaindept/",
        "/base-term/",
        "/inform/news/",
        "/blade-portal/",
        "/news/",
    ]
    for row in bucket:
        url = row.get("url", "")
        if any(s in url for s in skip_url_substrings):
            continue
        items.extend(extract_homework_from_json_tree(row.get("data"), row.get("url", "")))
    return _dedupe_homework_items(items)


def _text(el) -> str:
    try:
        return (el.inner_text() or "").strip()
    except Exception:
        return ""


def _max_items_cap(cfg: dict[str, Any]) -> int | None:
    """max_todo_items <= 0 表示不限制条数。"""
    try:
        v = int(cfg.get("max_todo_items", 0))
    except (TypeError, ValueError):
        v = 0
    return None if v <= 0 else max(1, v)


def scroll_to_load_lazy_content(
    page: Page,
    *,
    rounds: int = 28,
    pause_ms: int = 400,
) -> None:
    """反复滚到底以触发虚拟列表/懒加载，尽量拉全待办 DOM。"""
    rounds = max(1, min(rounds, 80))
    pause_ms = max(100, min(pause_ms, 3000))
    last_height = -1
    stable = 0
    for _ in range(rounds):
        try:
            height = page.evaluate("() => document.documentElement.scrollHeight") or 0
        except Exception:
            break
        try:
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        except Exception:
            break
        page.wait_for_timeout(pause_ms)
        try:
            new_h = page.evaluate("() => document.documentElement.scrollHeight") or 0
        except Exception:
            break
        if new_h == last_height:
            stable += 1
            if stable >= 2:
                break
        else:
            stable = 0
        last_height = new_h
    try:
        page.evaluate("() => window.scrollTo(0, 0)")
    except Exception:
        pass
    page.wait_for_timeout(250)


def _heuristic_text_matches_todo(raw: str) -> bool:
    """尽量覆盖各类待办文案，避免只抓到「作业」等部分条目。"""
    if len(raw) < 4:
        return False
    if re.search(
        r"作业|任务|测验|考试|问卷|讨论|提交|待办|预习|通知|公告|实验|报告|截止|逾期|期限"
        r"|课件|直播|签到|成绩|课程名称|教学班|学习进度|章节",
        raw,
    ):
        return True
    # 仅有日期/时间而无上述关键词时，避免把导航栏当作业
    return False


def _raw_looks_like_assignment_row(raw: str) -> bool:
    """表格行等：含作业相关词，或「日期 + 课程/作业类词」。"""
    if len(raw) < 8 or len(raw) > 2500:
        return False
    if _heuristic_text_matches_todo(raw):
        return True
    if re.search(r"\d{4}\s*[-年./]\s*\d{1,2}", raw) and re.search(
        r"课程|作业|提交|截止|待办|测验|名称|状态|类型|操作|查看|学习|章节", raw
    ):
        return True
    return False


def _first_row_link(page: Page, row) -> str:
    """取条目内第一个可跳转链接（绝对或相对 URL）。"""
    try:
        links = row.locator("a[href]")
        if links.count() == 0:
            return ""
        href = (links.first.get_attribute("href") or "").strip()
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            return ""
        if href.startswith("http"):
            return href
        base = page.url or ""
        if base:
            return urljoin(base, href)
    except Exception:
        pass
    return ""


def extract_with_selector(
    page: Page,
    item_sel: str,
    title_rel: str,
    due_rel: str,
    max_items: int | None,
) -> list[HomeworkItem]:
    items: list[HomeworkItem] = []
    loc = page.locator(item_sel)
    n = loc.count()
    limit = n if max_items is None else min(n, max_items)
    for i in range(limit):
        row = loc.nth(i)
        raw = _text(row)
        if not raw or len(raw) > 2000:
            continue
        title = _text(row.locator(title_rel)) if title_rel else raw.split("\n")[0][:200]
        due = _text(row.locator(due_rel)) if due_rel else ""
        if not due:
            m = re.search(
                r"(截止|提交|逾期).*?(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?\s*\d{0,2}:?\d{0,2}:?\d{0,2}?|今天|明天|本周|下周|\d{1,2}:\d{2})",
                raw,
            )
            if m:
                due = m.group(0)[:120]
        course = ""
        lines = [x.strip() for x in raw.split("\n") if x.strip()]
        if len(lines) >= 2 and len(lines[1]) < 80:
            course = lines[1]
        link = _first_row_link(page, row)
        items.append(
            HomeworkItem(title=title or "（无标题）", course=course, due=due, raw=raw[:500], url=link)
        )
    return items


def _looks_like_due_line(s: str) -> bool:
    """识别「截止/提交期限」等行：兼容站点只用「提交时间」、相对日期、时分。"""
    if not s or len(s) > 400:
        return False

    # "无截止"/"未设置" 等否定表述不算截止行
    if re.search(r"无截止|未截止|没有截止|暂未", s):
        return False

    has_deadline_word = bool(
        re.search(
            r"截止|提交期限|提交截止|最迟|期限|逾期|剩余|提交时间|上交时间|到期时间|截止日期|结束时间|Due\s*date|Due\s*:",
            s,
            re.I,
        )
    )
    # 无「截止」类词，但整行像「2026-05-10 23:59」或「提交时间：明天」
    if not has_deadline_word:
        if re.search(r"(提交时间|上交时间|到期时间|截止日期)\s*[:：]?\s*", s) and (
            re.search(r"\d{4}\s*[-年./]\s*\d{1,2}", s)
            or re.search(r"(今天|明天|后天|今日)", s)
            or re.search(r"\d{1,2}\s*:\s*\d{2}", s)
        ):
            return True
        return False
    # 有 deadline 关键词，检查是否有日期/时间信息或相对表述
    if re.search(r"\d{4}\s*[-年./]\s*\d{1,2}\s*[-月./]\s*\d{1,2}", s):
        return True
    if re.search(r"\d{1,2}\s*:\s*\d{2}", s):
        return True
    if re.search(r"(今天|明天|后天|今日|明日|本周|下周|小时后|分钟内)", s):
        return True
    if re.search(r"\d+\s*天\s*(后|以内|内)", s):
        return True
    if re.search(r"剩余\s*\d+\s*(小时|分钟|天)", s):
        return True
    if re.search(r"\d{1,4}[-月./日\s:：]{2,24}\d{1,2}", s):
        return True
    # 有 deadline 关键词就认为可能是截止行（即使无明确日期格式）
    return True


def parse_todo_panel_blob(text: str) -> list[HomeworkItem]:
    lines = [ln.strip() for ln in text.replace("\r", "").split("\n")]
    lines = [ln for ln in lines if ln]
    header = re.compile(r"^(待办|待办事项|今日待办|我的待办|学习任务)$")
    counter = re.compile(r"^\d+\s*/\s*\d+$")
    out: list[HomeworkItem] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if header.match(ln) or counter.match(ln):
            i += 1
            continue
        if i + 1 < len(lines) and _looks_like_due_line(lines[i + 1]):
            title = ln
            due = lines[i + 1]
            if not header.match(title) and not counter.match(title):
                out.append(
                    HomeworkItem(
                        title=title[:500],
                        course="",
                        due=due[:200],
                        raw=f"{title}\n{due}"[:500],
                        url="",
                    )
                )
            i += 2
            continue
        if _looks_like_due_line(ln) and not out:
            out.append(HomeworkItem(title="（无标题）", course="", due=ln[:200], raw=ln[:500], url=""))
        i += 1
    return out


def expand_combined_todo_items(items: list[HomeworkItem]) -> list[HomeworkItem]:
    expanded: list[HomeworkItem] = []
    for it in items:
        raw = it.raw or ""
        n_deadline = raw.count("截止")
        if n_deadline > 1 or (len(raw) > 200 and "截止" in raw and "\n" in raw):
            parsed = parse_todo_panel_blob(raw)
            if len(parsed) >= 2:
                expanded.extend(parsed)
                continue
            parsed = parse_todo_panel_blob(it.title + "\n" + raw)
            if len(parsed) >= 2:
                expanded.extend(parsed)
                continue
        expanded.append(it)
    seen: set[str] = set()
    uniq: list[HomeworkItem] = []
    for it in expanded:
        key = (it.title, it.due)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(it)
    return uniq


def parse_loose_deadline_pairs(text: str) -> list[HomeworkItem]:
    """整页纯文本兜底：按行扫描，把「截止」行前一行当作标题。"""
    lines = [ln.strip() for ln in text.replace("\r", "").split("\n") if ln.strip()]
    out: list[HomeworkItem] = []
    for i, ln in enumerate(lines):
        if not _looks_like_due_line(ln):
            continue
        title = lines[i - 1] if i > 0 else "（无标题）"
        if _looks_like_due_line(title) or len(title) < 2:
            title = "（无标题）"
        out.append(
            HomeworkItem(
                title=title[:500],
                course="",
                due=ln[:200],
                raw=f"{title}\n{ln}"[:500],
                url="",
            )
        )
    return out


def extract_table_like_rows(page: Page, max_items: int | None) -> list[HomeworkItem]:
    """表格行 / 列表项：教学空间常用 Element、Ant Design 等表格结构。"""
    selectors = [
        "table tbody tr",
        ".el-table__body-wrapper tbody tr",
        ".el-table__body tr",
        "[class*='ant-table-tbody'] tr",
        "[class*='data-list'] > div",
        "[class*='task-item']",
        "[class*='homework-item']",
        "[class*='todo-item']",
    ]
    seen: set[str] = set()
    out: list[HomeworkItem] = []
    hard_cap = 100_000 if max_items is None else max_items
    for sel in selectors:
        try:
            loc = page.locator(sel)
            cnt = loc.count()
            if cnt == 0 or cnt > 5000:
                continue
            n_take = min(cnt, hard_cap)
            for i in range(n_take):
                row = loc.nth(i)
                raw = _text(row)
                if not raw or len(raw) < 8:
                    continue
                if not _raw_looks_like_assignment_row(raw):
                    continue
                key = raw[:160]
                if key in seen:
                    continue
                seen.add(key)
                lines = [x.strip() for x in raw.split("\n") if x.strip()]
                title = lines[0][:200] if lines else raw[:200]
                due = ""
                for line in lines:
                    if _looks_like_due_line(line):
                        due = line[:160]
                        break
                    if re.search(r"\d{4}\s*[-年./]\s*\d{1,2}\s*[-月./]\s*\d{1,2}", line):
                        due = line[:160]
                        break
                if not due:
                    m = re.search(
                        r"(截止|提交时间|提交期限|逾期|剩余)[^\n]{0,100}(\d{4}[-年./]\s*\d{1,2}[-月./]\s*\d{1,2}[^\n]*)",
                        raw,
                        re.DOTALL,
                    )
                    if m:
                        due = m.group(0).strip()[:160]
                course = lines[1][:80] if len(lines) >= 2 and len(lines[1]) < 100 else ""
                link = _first_row_link(page, row)
                out.append(
                    HomeworkItem(
                        title=title or "（无标题）",
                        course=course,
                        due=due or "",
                        raw=raw[:500],
                        url=link,
                    )
                )
                if max_items is not None and len(out) >= max_items:
                    return out
        except Exception:
            continue
    return out


def extract_from_full_body(page: Page, parse_body_chars: int) -> list[HomeworkItem]:
    """启发式未命中时，用整页 innerText 再解析一轮。"""
    try:
        body = _text(page.locator("body"))
        if not body:
            return []
        blob = body[:parse_body_chars]
        items = parse_todo_panel_blob(blob)
        if not items:
            items = parse_loose_deadline_pairs(blob)
        return expand_combined_todo_items(items)
    except Exception:
        return []


def _post_goto_networkidle(page: Page, cfg: dict[str, Any]) -> None:
    """SPA 常见：接口晚于 domcontentloaded，等待网络空闲再解析。"""
    if not cfg.get("after_goto_wait_networkidle", True):
        return
    try:
        to = int(cfg.get("networkidle_timeout_ms", 22_000))
        to = max(5_000, min(to, 120_000))
        page.wait_for_load_state("networkidle", timeout=to)
    except Exception:
        pass


def extract_via_dom_walk(page: Page, max_items: int | None) -> list[HomeworkItem]:
    """在浏览器内枚举列表/卡片/tr 等节点 innerText（应对 Vue/React 动态渲染、class 不固定）。"""
    block_max = 450 if max_items is None else min(450, max(80, max_items + 80))
    text_max = 2600
    try:
        chunks = page.evaluate(
            """({ blockMax, textMax }) => {
            const kw = /[\\u4e00-\\u9fff]{1,40}(作业|任务|测验|考试|问卷|预习|实验|报告|讨论)|待办|未完成|已截止|未提交|课程作业|课堂测验|线上作业/;
            const seen = new Set();
            const out = [];
            const push = (t) => {
              const s = (t || '').trim();
              if (!kw.test(s) || s.length < 14 || s.length > textMax) return;
              const k = s.slice(0, 130);
              if (seen.has(k)) return;
              seen.add(k);
              out.push(s);
            };
            const narrowSel =
              'main article, main section, table tbody tr, .el-table__body tr, [class*="table"] tbody tr, [class*="list-item"], [class*="List"] > div, [class*="card"], [class*="Card"], [role="listitem"], li';
            document.querySelectorAll(narrowSel).forEach((el) => {
              if (out.length >= blockMax) return;
              try { push(el.innerText); } catch (e) {}
            });
            if (out.length < 8) {
              document.querySelectorAll('div').forEach((el) => {
                if (out.length >= blockMax) return;
                try {
                  if (el.children.length > 18) return;
                  push(el.innerText);
                } catch (e) {}
              });
            }
            return out;
          }""",
            {"blockMax": block_max, "textMax": text_max},
        )
    except Exception:
        return []
    if not isinstance(chunks, list):
        return []
    seen: set[str] = set()
    out: list[HomeworkItem] = []
    for raw in chunks:
        if not isinstance(raw, str):
            continue
        raw = raw.strip()
        if len(raw) < 12:
            continue
        key = raw[:140]
        if key in seen:
            continue
        seen.add(key)
        lines = [x.strip() for x in raw.split("\n") if x.strip()]
        title = lines[0][:200] if lines else raw[:200]
        due = ""
        for line in lines:
            if _looks_like_due_line(line):
                due = line[:160]
                break
            if re.search(r"\d{4}\s*[-年./]\s*\d{1,2}\s*[-月./]\s*\d{1,2}", line):
                due = line[:160]
                break
        if not due:
            m = re.search(
                r"(截止|提交时间|提交期限|逾期|剩余)[^\n]{0,140}",
                raw,
                re.DOTALL,
            )
            if m:
                due = m.group(0).strip()[:160]
        course = lines[1][:80] if len(lines) > 1 else ""
        out.append(
            HomeworkItem(
                title=title or "（无标题）",
                course=course,
                due=due or "",
                raw=raw[:500],
                url="",
            )
        )
        if max_items is not None and len(out) >= max_items:
            break
    return out


def _run_extraction_strategies(
    page: Page,
    cfg: dict[str, Any],
    *,
    item_sel: str,
    title_rel: str,
    due_rel: str,
    max_items: int | None,
    parse_body_chars: int,
) -> list[HomeworkItem]:
    """按顺序尝试多种解析方式，合并前先做展开。"""
    items: list[HomeworkItem] = []
    if item_sel:
        items = extract_with_selector(page, item_sel, title_rel, due_rel, max_items)
    if not items:
        items = extract_heuristic(page, max_items)
    if not items:
        items = extract_table_like_rows(page, max_items)
    items = expand_combined_todo_items(items)

    if len(items) == 1 and items[0].raw.count("截止") > 1:
        try:
            body = _text(page.locator("body"))
            blob = body[:parse_body_chars] if body else ""
            more = parse_todo_panel_blob(blob)
            if len(more) > len(items):
                items = more
        except Exception:
            pass

    if not items:
        items = extract_from_full_body(page, parse_body_chars)

    if not items:
        try:
            for frame in page.frames:
                if frame == page.main_frame:
                    continue
                try:
                    fb = _text(frame.locator("body"))
                    if fb and len(fb) > 200:
                        items = expand_combined_todo_items(
                            parse_todo_panel_blob(fb[:parse_body_chars])
                        )
                        if not items:
                            items = expand_combined_todo_items(
                                parse_loose_deadline_pairs(fb[:parse_body_chars])
                            )
                        if items:
                            break
                except Exception:
                    continue
        except Exception:
            pass

    if not items:
        items = extract_via_dom_walk(page, max_items)

    items = expand_combined_todo_items(items)
    items = _filter_junk_items(items)
    return items


def extract_heuristic(page: Page, max_items: int | None) -> list[HomeworkItem]:
    candidates = [
        "[class*='homework']",
        "[class*='Homework']",
        "[class*='task']",
        "[class*='assignment']",
        "[class*='work-item']",
        "[class*='todo']",
        "[class*='Todo']",
        ".el-card",
        "[class*='card']",
        "li[class*='item']",
        "div[class*='list'] > div",
    ]
    seen: set[str] = set()
    out: list[HomeworkItem] = []
    hard_cap = 100_000 if max_items is None else max_items
    for sel in candidates:
        try:
            loc = page.locator(sel)
            cnt = loc.count()
            # 过大往往命中整页容器，跳过该 selector；阈值调高以免列表较长时被整条丢弃
            if cnt == 0 or cnt > 12_000:
                continue
            n_take = min(cnt, hard_cap)
            for i in range(n_take):
                raw = _text(loc.nth(i))
                if not raw or len(raw) < 4:
                    continue
                if not _heuristic_text_matches_todo(raw):
                    continue
                key = raw[:120]
                if key in seen:
                    continue
                seen.add(key)
                lines = [x.strip() for x in raw.split("\n") if x.strip()]
                title = lines[0][:200] if lines else raw[:200]
                due = ""
                for line in lines:
                    if _looks_like_due_line(line):
                        due = line[:120]
                        break
                    if re.search(r"截止|提交期限|提交时间|逾期|due", line, re.I):
                        due = line[:120]
                        break
                course = lines[1] if len(lines) > 1 and len(lines[1]) < 60 else ""
                row_el = loc.nth(i)
                link = _first_row_link(page, row_el)
                out.append(HomeworkItem(title=title, course=course, due=due, raw=raw[:500], url=link))
                if max_items is not None and len(out) >= max_items:
                    return out
        except Exception:
            continue
    return out


def _resolve_user_data(cfg: dict[str, Any]) -> Path:
    raw = cfg.get("user_data_dir") or "browser_profile"
    p = Path(raw)
    if p.is_absolute():
        return p
    return DATA_DIR / p


def _use_playwright_storage_state(cfg: dict[str, Any]) -> bool:
    if not cfg.get("use_playwright_storage_state", True):
        return False
    return STORAGE_STATE_PATH.is_file()


def _resolve_student_page_urls(cfg: dict[str, Any]) -> list[str]:
    """收集所有可能需要尝试的学生页面 hash 路由。"""
    base = "https://ucloud.bupt.edu.cn/uclass/index.html"
    # 从配置读取
    target = resolve_portal_url(cfg)
    urls: list[str] = [target] if target else []

    # 追加备选
    for u in resolve_alternate_urls(cfg):
        if u and u not in urls:
            urls.append(u)

    # 追加常见的课业相关 hash 路由
    candidate_hashes = [
        "#/student/homePage",
        "#/student/homework",
        "#/student/task",
        "#/student/taskList",
        "#/student/course",
        "#/student/courseList",
        "#/student/activity",
        "#/student/myHomework",
        "#/student/assignment",
        "#/student/todo",
        "#/student/index",
    ]
    for h in candidate_hashes:
        u = f"{base}{h}"
        if u not in urls:
            urls.append(u)

    # 也尝试从首页自动导航（由下面的导航逻辑处理）
    home_url = f"{base}#/"
    if home_url not in urls:
        urls.append(home_url)

    return urls


def _fetch_api_from_page(page: Page, url: str) -> dict | None:
    """从已登录的 page 上下文发起 fetch 请求（自动携带 cookie）。"""
    try:
        result = page.evaluate(
            """
            async (url) => {
                try {
                    const resp = await fetch(url, { credentials: 'include' });
                    if (!resp.ok) return null;
                    return await resp.json();
                } catch(e) { return null; }
            }
            """,
            url,
        )
        if isinstance(result, dict):
            return result
        return None
    except Exception:
        return None


def _paginate_api(
    page: Page,
    base_url: str,
    list_key: str = "records",
    total_key: str = "total",
    page_size: int = 100,
) -> list[dict[str, Any]]:
    """分页获取 API 全部数据。

    支持两种分页结构：
    - 标准分页: {records, total, size, current, pages}
    - undone 接口: {undoneList, undoneNum}

    先尝试带分页参数；若第 1 页失败则退回到原 URL（可能不分页，一次性返回全部）。
    """
    all_items: list[dict[str, Any]] = []
    current = 1

    while True:
        sep = "&" if "?" in base_url else "?"
        url = f"{base_url}{sep}current={current}&size={page_size}"
        result = _fetch_api_from_page(page, url)
        if (not result or result.get("code") != 200) and current == 1:
            # 分页参数可能不支持，退回到原 URL 一次性获取
            result = _fetch_api_from_page(page, base_url)

        if not result or result.get("code") != 200:
            break

        data = result.get("data", {})
        items = data.get(list_key, [])
        if not items:
            break

        if isinstance(items, list):
            all_items.extend(items)
        else:
            break

        total = data.get(total_key, 0)

        if total > 0 and len(all_items) >= total:
            break
        if len(items) < page_size:
            break

        # 安全阀：若 API 忽略分页参数、每次返回相同条目，避免重复累积
        if current == 1:
            _first_page_ids = {
                str(it.get("activityId") or it.get("id") or hash(json.dumps(it, sort_keys=True)))
                for it in items[:3]
            }
        else:
            _this_page_ids = {
                str(it.get("activityId") or it.get("id") or hash(json.dumps(it, sort_keys=True)))
                for it in items[:3]
            }
            if _this_page_ids == _first_page_ids:
                break

        current += 1
        if current > 100:
            break

    return all_items


def _get_course_count(page: Page, net_bucket: list[dict[str, Any]]) -> int:
    """从网络捕获或直接 API 调用获取当前学期课程门数。"""
    # Step 1: 尝试从 net_bucket 中找课程列表 API 的响应
    for row in net_bucket:
        url = row.get("url", "")
        if "/site/list/student/current" in url:
            data = row.get("data", {})
            inner = (data.get("data") if isinstance(data, dict) else None) or {}
            records = inner.get("records", [])
            if records:
                print(f"[课程计数] 从网络捕获获取到 {len(records)} 门课程", flush=True)
                return len(records)

    # Step 2: 直接调用课程列表 API
    api_base = "https://apiucloud.bupt.edu.cn"
    for row in net_bucket:
        url = row.get("url", "")
        m = re.match(r"(https?://[^/]+)", url)
        if m and ("api" in url.lower() or "ucloud" in url.lower()):
            api_base = m.group(1)
            break

    user_id = page.evaluate(
        """() => {
        try {
            const store = JSON.parse(localStorage.getItem('store') || '{}');
            return store.user_id || store.userId || null;
        } catch(e) { return null; }
    }"""
    )
    if not user_id:
        print("[课程计数] 无法获取 userId", flush=True)
        return 0

    result = _fetch_api_from_page(
        page,
        f"{api_base}/ykt-site/site/list/student/current"
        f"?userId={user_id}&siteRoleCode=2&size=999&current=1",
    )
    if result and isinstance(result, dict) and result.get("code") == 200:
        inner = (result.get("data") if isinstance(result, dict) else None) or {}
        records = inner.get("records", [])
        if records:
            print(f"[课程计数] 从 API 获取到 {len(records)} 门课程", flush=True)
            return len(records)

    print("[课程计数] 未能获取课程数", flush=True)
    return 0


def fetch_homework(
    headless: bool = True,
    debug_dump: bool = False,
    cfg: dict[str, Any] | None = None,
) -> list[HomeworkItem]:
    cfg = load_config() if cfg is None else cfg
    target = resolve_portal_url(cfg)
    if not target:
        raise ValueError("请在 config.yaml 中设置 target_url 或 login_start_url")

    wait_ms = int(cfg.get("post_load_wait_ms", 8000))
    nav_timeout_ms = int(cfg.get("navigation_timeout_ms", 120_000))
    user_data = _resolve_user_data(cfg)
    user_data.mkdir(parents=True, exist_ok=True)
    item_sel = (cfg.get("homework_item_selector") or "").strip()
    title_rel = (cfg.get("title_relative") or "").strip()
    due_rel = (cfg.get("due_relative") or "").strip()
    max_items = _max_items_cap(cfg)
    parse_body_chars = int(cfg.get("parse_body_max_chars", 500_000))
    parse_body_chars = max(5_000, min(parse_body_chars, 2_000_000))

    items: list[HomeworkItem] = []
    course_count = 0
    use_storage = _use_playwright_storage_state(cfg)

    urls_to_try = _resolve_student_page_urls(cfg)

    nav_errors: list[str] = []
    login_state: dict[str, Any] = {}
    debug_all_bucket: list[dict[str, Any]] = []

    try:
        with sync_playwright() as p:
            browser = None
            if use_storage:
                browser = p.chromium.launch(
                    headless=headless,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                context = browser.new_context(
                    storage_state=str(STORAGE_STATE_PATH),
                    locale="zh-CN",
                    viewport={"width": 1400, "height": 900},
                )
            else:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(user_data),
                    headless=headless,
                    locale="zh-CN",
                    viewport={"width": 1400, "height": 900},
                    args=["--disable-blink-features=AutomationControlled"],
                )
            try:
                page = context.new_page() if use_storage else (
                    context.pages[0] if context.pages else context.new_page()
                )
                net_bucket: list[dict[str, Any]] = []
                _attach_network_json_capture(
                    page, net_bucket, cfg,
                    debug_dump=debug_dump,
                    debug_all_bucket=debug_all_bucket,
                )

                wait_until = (cfg.get("page_goto_wait_until") or "domcontentloaded").strip()
                if wait_until not in ("commit", "domcontentloaded", "load", "networkidle"):
                    wait_until = "domcontentloaded"

                tried_hashes: set[str] = set()
                auto_login_attempted = False

                for nav_url in urls_to_try:
                    # 跳过已尝试过的相同 hash
                    nav_hash = nav_url.split("#")[-1] if "#" in nav_url else ""
                    if nav_hash in tried_hashes:
                        continue
                    tried_hashes.add(nav_hash)

                    try:
                        page.goto(nav_url, wait_until=wait_until, timeout=nav_timeout_ms)
                    except Exception as e:
                        nav_errors.append(f"{nav_url}: {e}")
                        continue

                    _post_goto_networkidle(page, cfg)
                    page.wait_for_timeout(wait_ms)

                    # 检测当前是否被重定向到首页
                    current_hash = page.evaluate("() => window.location.hash") or ""
                    if current_hash in ("", "#/", "#") and nav_hash not in ("", "/", ""):
                        print(f"[导航] 当前在首页({current_hash})，尝试跳转到学生页...", flush=True)
                        page.goto(
                            f"https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage",
                            wait_until="domcontentloaded",
                            timeout=nav_timeout_ms,
                        )
                        _post_goto_networkidle(page, cfg)
                        page.wait_for_timeout(wait_ms)

                    # 滚动以触发懒加载
                    if cfg.get("scroll_before_extract", True):
                        scroll_to_load_lazy_content(
                            page,
                            rounds=int(cfg.get("scroll_rounds", 28)),
                            pause_ms=int(cfg.get("scroll_pause_ms", 400)),
                        )
                        extra = int(cfg.get("post_scroll_wait_ms", 1200))
                        if extra > 0:
                            page.wait_for_timeout(extra)

                    # 检测登录状态
                    login_state = _detect_login_state(page)
                    if debug_dump:
                        print(f"[登录检测] {login_state.get('reason')} (is_logged_in={login_state.get('is_logged_in')})", flush=True)

                    # 如果未登录且开启了自动登录，尝试自动填写凭据
                    if (
                        not login_state.get("is_logged_in")
                        and cfg.get("auto_login")
                        and not auto_login_attempted
                    ):
                        auto_login_attempted = True
                        from auto_login import perform_auto_login

                        if perform_auto_login(page, cfg):
                            print("[自动登录] 登录成功，重新导航到目标页...", flush=True)
                            net_bucket.clear()
                            try:
                                page.goto(
                                    nav_url, wait_until=wait_until, timeout=nav_timeout_ms
                                )
                            except Exception as e:
                                print(f"[自动登录] 重新导航失败: {e}", flush=True)
                            _post_goto_networkidle(page, cfg)
                            page.wait_for_timeout(wait_ms)
                            if cfg.get("scroll_before_extract", True):
                                scroll_to_load_lazy_content(
                                    page,
                                    rounds=int(cfg.get("scroll_rounds", 28)),
                                    pause_ms=int(cfg.get("scroll_pause_ms", 400)),
                                )
                                extra = int(cfg.get("post_scroll_wait_ms", 1200))
                                if extra > 0:
                                    page.wait_for_timeout(extra)
                            login_state = _detect_login_state(page)
                            if debug_dump:
                                print(
                                    f"[登录检测] 自动登录后: {login_state.get('reason')} "
                                    f"(is_logged_in={login_state.get('is_logged_in')})",
                                    flush=True,
                                )
                        else:
                            print(
                                "[自动登录] 登录失败，请检查 config.yaml 中的账号密码",
                                flush=True,
                            )
                            break

                    # 若 SPA 显示 404 且无任何 API 请求，提前终止（登录态过期）
                    if login_state.get("reason") == "spa_showing_404_page" and len(net_bucket) == 0:
                        print("[诊断] 页面显示 404，且无 API 请求。登录态很可能已过期，请重新登录。", flush=True)
                        break

                    if debug_dump:
                        # 写入页面 DOM 和截图
                        DATA_DIR.mkdir(parents=True, exist_ok=True)
                        (DATA_DIR / "debug_page.html").write_text(
                            page.content(), encoding="utf-8"
                        )
                        page.screenshot(path=str(DATA_DIR / "debug_page.png"), full_page=True)

                        # 写入全面的网络诊断文件
                        net_debug = DATA_DIR / "debug_network.json"
                        net_debug.write_text(
                            json.dumps({
                                "page_url": page.url,
                                "page_title": page.title(),
                                "target_url": nav_url,
                                "captured_api_count": len(net_bucket),
                                "captured_all_count": len(debug_all_bucket),
                                "login_state": login_state,
                                "api_requests": [
                                    {"url": r.get("url"), "status": r.get("status"),
                                     "data_type": type(r.get("data")).__name__,
                                     "data_preview": str(r.get("data"))[:500]}
                                    for r in net_bucket[:50]
                                ],
                                "all_requests": debug_all_bucket[:200],
                            }, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                        print(f"[调试] 页面URL: {page.url}", flush=True)
                        print(f"[调试] 页面标题: {page.title()}", flush=True)
                        print(f"[调试] 捕获到 {len(net_bucket)} 个接口请求 / {len(debug_all_bucket)} 个总请求", flush=True)

                    # ---- DOM 提取 ----
                    dom_items = _run_extraction_strategies(
                        page,
                        cfg,
                        item_sel=item_sel,
                        title_rel=title_rel,
                        due_rel=due_rel,
                        max_items=None,  # DOM 不限条数，最后统一截断
                        parse_body_chars=parse_body_chars,
                    )

                    # ---- API 提取（含分页） ----
                    api_items: list[HomeworkItem] = []
                    if net_bucket:
                        api_items = _items_from_network_bucket(net_bucket)

                    # 对 undone API 尝试分页获取全部条目
                    for row in net_bucket:
                        url = row.get("url", "")
                        if "/site/student/undone" not in url:
                            continue
                        data = row.get("data", {})
                        inner = (data.get("data") if isinstance(data, dict) else None) or {}
                        undone_list = inner.get("undoneList", [])
                        undone_num = inner.get("undoneNum", 0)
                        if undone_num > len(undone_list):
                            print(
                                f"[分页] undone API 返回 {len(undone_list)}/{undone_num} 条，尝试分页获取剩余条目...",
                                flush=True,
                            )
                            all_api_items = _paginate_api(
                                page, url,
                                list_key="undoneList",
                                total_key="undoneNum",
                                page_size=100,
                            )
                            if len(all_api_items) > len(undone_list):
                                print(
                                    f"[分页] 分页获取到 {len(all_api_items)} 条 undone 条目",
                                    flush=True,
                                )
                                # 将分页数据注入回 net_bucket 以便统一提取
                                from copy import deepcopy
                                enriched = deepcopy(row)
                                enriched["data"] = {
                                    "code": 200,
                                    "data": {
                                        "undoneNum": undone_num,
                                        "undoneList": all_api_items,
                                    },
                                }
                                api_items = _items_from_network_bucket([enriched] + net_bucket)
                            else:
                                print(
                                    "[分页] 分页无更多数据（API 可能按类型分桶，"
                                    "undoneNum 为跨类型合计）",
                                    flush=True,
                                )
                        break

                    api_items = _filter_junk_items(api_items)

                    # ---- 合并 & 去重 ----
                    merged = dom_items + api_items
                    items = _dedupe_homework_items(merged)
                    if items:
                        print(
                            f"[合并] DOM {len(dom_items)} 条 + API {len(api_items)} 条 → "
                            f"去重后 {len(items)} 条",
                            flush=True,
                        )
                    else:
                        items = dom_items if dom_items else api_items

                    if not items and cfg.get("debug_dump_on_empty", True):
                        try:
                            (DATA_DIR / "debug_page_empty.html").write_text(
                                page.content(), encoding="utf-8"
                            )
                        except Exception:
                            pass
                    if items:
                        break

                # 所有 URL 遍历完仍未找到数据，写入诊断摘要
                if not items and debug_dump:
                    summary = {
                        "error": "未找到课业数据",
                        "login_state": login_state,
                        "urls_tried": list(tried_hashes),
                        "nav_errors": nav_errors,
                        "total_api_requests": len(net_bucket),
                        "total_all_requests": len(debug_all_bucket),
                        "suggestion": (
                            "可能原因：1) 登录态已过期，请重新登录；"
                            "2) 课业数据在未尝试的页面路由；"
                            "3) API 端点不在捕获范围内。"
                            "请查看 debug_network.json 中 all_requests 字段，"
                            "找到含课业数据的请求 URL 并更新 config.yaml 的 target_url 和 network_capture_url_substrings。"
                        ),
                    }
                    (DATA_DIR / "debug_network.json").write_text(
                        json.dumps(summary, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    print(f"[诊断] {summary['suggestion']}", flush=True)

                # 在所有 URL 遍历完后提取课程数
                course_count = _get_course_count(page, net_bucket)

            finally:
                context.close()
                if browser is not None:
                    browser.close()
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"抓取过程出错: {e}") from e

    if not items and nav_errors and len(nav_errors) >= len(urls_to_try):
        raise RuntimeError(
            "所有目标地址均无法打开（请检查网络、登录态与 URL）: " + " | ".join(nav_errors[:5])
        )

    if max_items is not None and len(items) > max_items:
        items = items[:max_items]

    return items, course_count


def save_cache(
    items: list[HomeworkItem],
    *,
    portal_url: str = "",
    warning: str | None = None,
    course_count: int = 0,
) -> None:
    payload = {
        "schema_version": CACHE_SCHEMA_VERSION,
        "portal_url": portal_url,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "items": [asdict(x) for x in items],
        "course_count": course_count,
    }
    if warning:
        payload["_warning"] = warning
    CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_cache() -> dict[str, Any]:
    if not CACHE_PATH.is_file():
        return {"updated_at": "", "items": []}
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))

"""
命令行入口（请在仓库根目录执行，例如: python python/app.py login）：
  python python/app.py login   — 另开 Chromium 交互登录（可选；推荐在 Electron 客户端内「登录」）
  python python/app.py fetch   — 抓取作业
  python python/app.py fetch --debug
  python python/app.py widget  — tkinter 小窗
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


def cmd_login():
    from playwright.sync_api import sync_playwright
    import yaml

    from paths import DATA_DIR, SCRIPT_DIR

    example = SCRIPT_DIR / "config.example.yaml"
    cfg_path = DATA_DIR / "config.yaml"
    if not cfg_path.is_file() and example.is_file():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cfg_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    start = cfg.get("login_start_url") or cfg.get("target_url")
    user_data = Path(cfg.get("user_data_dir") or "browser_profile")
    if not user_data.is_absolute():
        user_data = DATA_DIR / user_data
    user_data.mkdir(parents=True, exist_ok=True)

    print("正在打开浏览器…")
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(user_data),
            headless=False,
            locale="zh-CN",
            viewport={"width": 1400, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(start, wait_until="domcontentloaded", timeout=120_000)
        print("在浏览器中完成登录后，回到此窗口按回车以保存登录态…")
        input()
        context.close()
    print("登录态已保存到:", user_data)


def cmd_fetch(debug: bool):
    from homework_fetcher import CACHE_PATH, fetch_homework, load_config, resolve_portal_url, save_cache

    try:
        cfg = load_config()
        result = fetch_homework(headless=True, debug_dump=debug, cfg=cfg)
        if isinstance(result, tuple):
            items, course_count = result[0], result[1]
            courses = result[2] if len(result) > 2 else []
        else:
            items, course_count, courses = result, 0, []
        warn = None
        if len(items) == 0:
            warn = (
                "本次未解析到待办条目。大概率是登录态已过期（session cookie 失效），"
                "请在应用内点击「登录」重新登录教学空间、保存登录态后再「立即同步」。"
                "若登录后仍为空，执行 python python/app.py fetch --debug 查看 debug 文件排查。"
            )
        save_cache(items, portal_url=resolve_portal_url(cfg), warning=warn, course_count=course_count, courses=courses)
    except (ValueError, RuntimeError) as e:
        print(f"错误: {e}", file=sys.stderr)
        raise SystemExit(1) from e
    print(f"已写入 {CACHE_PATH} ，共 {len(items)} 条")
    preview_n = 80
    for i, x in enumerate(items[:preview_n], 1):
        line = f"{i}. {x.title} | {x.due or '-'}"
        try:
            print(line)
        except UnicodeEncodeError:
            enc = getattr(sys.stdout, "encoding", None) or "utf-8"
            print(line.encode(enc, errors="replace").decode(enc, errors="replace"))
    if len(items) > preview_n:
        print(f"... 其余 {len(items) - preview_n} 条见 homework_cache.json")


def cmd_set_credentials(username: str):
    """将账号密码写入 config.yaml 并开启 auto_login。密码通过交互输入避免泄露到 shell 历史。"""
    import getpass

    import yaml

    from homework_fetcher import CONFIG_PATH

    if not CONFIG_PATH.is_file():
        print("错误: 未找到 config.yaml，请先确保配置文件存在")
        raise SystemExit(1)

    if not username:
        username = input("请输入学号/工号: ").strip()
        if not username:
            print("错误: 用户名不能为空")
            raise SystemExit(1)

    password = getpass.getpass("请输入密码: ").strip()
    if not password:
        print("错误: 密码不能为空")
        raise SystemExit(1)

    # 使用 yaml 安全序列化，避免正则编辑破坏 YAML 结构
    from crypto_utils import encrypt_password
    cfg = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}
    cfg["auto_login"] = True
    cfg["username"] = username
    cfg["password"] = encrypt_password(password)
    CONFIG_PATH.write_text(
        yaml.dump(cfg, allow_unicode=True, default_flow_style=False, indent=2),
        encoding="utf-8",
    )
    print(f"已保存账号到 {CONFIG_PATH}（密码已加密），auto_login 已开启")


def cmd_check():
    """检查运行环境是否就绪。"""
    import importlib
    issues = []

    # Python 版本
    v = sys.version_info
    if v < (3, 10):
        issues.append(f"Python 版本过低: {v.major}.{v.minor}，需要 3.10+")

    # playwright
    try:
        importlib.import_module("playwright")
    except ImportError:
        issues.append("缺少 playwright，请执行: pip install playwright && python -m playwright install chromium")

    # yaml
    try:
        importlib.import_module("yaml")
    except ImportError:
        issues.append("缺少 PyYAML，请执行: pip install PyYAML")

    # config
    from homework_fetcher import CONFIG_PATH
    if not CONFIG_PATH.is_file():
        issues.append(f"缺少 config.yaml: {CONFIG_PATH}")

    # login state
    from homework_fetcher import STORAGE_STATE_PATH
    has_login = STORAGE_STATE_PATH.is_file()

    if issues:
        print("[环境问题]")
        for i in issues:
            print(f"  ✗ {i}")
        raise SystemExit(1)
    print("[环境] Python 与依赖就绪")
    print(f"[配置] {CONFIG_PATH} 存在" if CONFIG_PATH.is_file() else "[配置] 缺少 config.yaml")
    print(f"[登录] {'已保存登录态' if has_login else '未登录（请在应用内登录教学空间）'}")
    print("[环境检查通过]")


def cmd_widget():
    import widget as w

    w.main()


def main():
    ap = argparse.ArgumentParser(description="北邮云邮教学空间作业抓取")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login", help="交互登录")
    p_f = sub.add_parser("fetch", help="抓取作业")
    p_f.add_argument("--debug", action="store_true")
    sub.add_parser("widget", help="tkinter 小组件")
    sub.add_parser("check", help="检查运行环境")
    p_cred = sub.add_parser("set-credentials", help="保存自动登录凭据（密码交互输入）")
    p_cred.add_argument("--username", default="", help="学号/工号（留空则交互输入）")

    args = ap.parse_args()
    if args.cmd == "login":
        cmd_login()
    elif args.cmd == "fetch":
        cmd_fetch(args.debug)
    elif args.cmd == "widget":
        cmd_widget()
    elif args.cmd == "check":
        cmd_check()
    elif args.cmd == "set-credentials":
        cmd_set_credentials(args.username)


if __name__ == "__main__":
    main()

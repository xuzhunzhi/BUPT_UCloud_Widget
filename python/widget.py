"""
tkinter 小组件：从 DATA_DIR 下 homework_cache.json 读取（与 Electron 共用数据目录）。
"""
from __future__ import annotations

import json
import threading
import tkinter as tk
from tkinter import ttk

from paths import DATA_DIR, WIDGET_REFRESH_MINUTES_DEFAULT

CACHE_PATH = DATA_DIR / "homework_cache.json"


def read_cache():
    if not CACHE_PATH.is_file():
        return None, []
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        return data.get("updated_at", ""), data.get("items", [])
    except Exception:
        return None, []


def run_fetch_in_thread(log_fn):
    def job():
        try:
            from homework_fetcher import fetch_homework, load_config, resolve_portal_url, save_cache

            cfg = load_config()
            items, course_count = fetch_homework(headless=True, cfg=cfg)
            save_cache(items, portal_url=resolve_portal_url(cfg), course_count=course_count)
            log_fn(f"已更新，共 {len(items)} 条")
        except Exception as e:
            log_fn(f"更新失败: {e}")

    threading.Thread(target=job, daemon=True).start()


def main():
    try:
        import yaml

        cfg_path = DATA_DIR / "config.yaml"
        refresh_min = WIDGET_REFRESH_MINUTES_DEFAULT
        if cfg_path.is_file():
            with cfg_path.open(encoding="utf-8") as f:
                c = yaml.safe_load(f) or {}
            refresh_min = int(c.get("widget_refresh_minutes", WIDGET_REFRESH_MINUTES_DEFAULT))
    except Exception:
        refresh_min = WIDGET_REFRESH_MINUTES_DEFAULT

    root = tk.Tk()
    root.title("云邮作业待办")
    root.geometry("360x420+40+40")
    root.attributes("-topmost", True)
    root.minsize(300, 280)

    style = ttk.Style()
    if "vista" in style.theme_names():
        style.theme_use("vista")

    header = ttk.Frame(root, padding=6)
    header.pack(fill=tk.X)
    ttk.Label(header, text="北邮教学空间 · 作业", font=("Segoe UI", 11, "bold")).pack(side=tk.LEFT)

    status_var = tk.StringVar(value="就绪")
    ttk.Label(header, textvariable=status_var, font=("Segoe UI", 9)).pack(side=tk.RIGHT)

    body = ttk.Frame(root, padding=(8, 0, 8, 8))
    body.pack(fill=tk.BOTH, expand=True)

    canvas = tk.Canvas(body, highlightthickness=0)
    scroll = ttk.Scrollbar(body, orient=tk.VERTICAL, command=canvas.yview)
    inner = ttk.Frame(canvas)
    inner.bind(
        "<Configure>",
        lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
    )
    canvas.create_window((0, 0), window=inner, anchor="nw")
    canvas.configure(yscrollcommand=scroll.set)
    canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    scroll.pack(side=tk.RIGHT, fill=tk.Y)

    def on_mousewheel(event):
        canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    canvas.bind_all("<MouseWheel>", on_mousewheel)

    rows: list[ttk.Label] = []

    def redraw():
        for w in inner.winfo_children():
            w.destroy()
        rows.clear()
        updated, items = read_cache()
        meta = ttk.Label(
            inner,
            text=(
                f"缓存时间: {updated or '无'}\n"
                f"每 {refresh_min} 分钟自动同步 · 若列表为空请执行: python python/app.py fetch"
            ),
            font=("Segoe UI", 9),
            wraplength=320,
        )
        meta.pack(anchor=tk.W, pady=(0, 8))
        if not items:
            ttk.Label(inner, text="（暂无作业条目）", foreground="#666").pack(anchor=tk.W)
            return
        for i, it in enumerate(items):
            fr = ttk.Frame(inner, padding=(0, 6))
            fr.pack(fill=tk.X)
            title = it.get("title", "")
            course = it.get("course", "")
            due = it.get("due", "")
            ttk.Label(fr, text=f"{i + 1}. {title}", font=("Segoe UI", 10, "bold"), wraplength=320).pack(anchor=tk.W)
            if course:
                ttk.Label(fr, text=course, font=("Segoe UI", 9), foreground="#444", wraplength=320).pack(anchor=tk.W)
            if due:
                ttk.Label(fr, text=due, font=("Segoe UI", 9), foreground="#a50").pack(anchor=tk.W)
            ttk.Separator(fr, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=(6, 0))

    def do_refresh():
        status_var.set("正在拉取…")
        run_fetch_in_thread(lambda msg: root.after(0, lambda: _after_fetch(msg)))

    def _after_fetch(msg):
        status_var.set(msg)
        redraw()

    bar = ttk.Frame(root, padding=8)
    bar.pack(fill=tk.X)
    ttk.Button(bar, text="立即刷新", command=do_refresh).pack(side=tk.LEFT)
    ttk.Button(bar, text="重新载入缓存", command=lambda: (status_var.set("已载入"), redraw())).pack(
        side=tk.LEFT, padx=(8, 0)
    )

    interval_ms = max(1, refresh_min) * 60_000

    def periodic():
        do_refresh()
        root.after(interval_ms, periodic)

    redraw()
    # 与 Electron 一致：每隔 refresh_min 分钟自动爬取（默认 30 分钟即每半小时一次）
    root.after(interval_ms, periodic)

    root.mainloop()


if __name__ == "__main__":
    main()

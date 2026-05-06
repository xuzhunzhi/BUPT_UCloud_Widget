# 作业小组件 - Claude Code 交接文档

## 问题概述

**核心问题**：Electron 作业小组件抓取不到课业数据，始终返回 0 条。

**用户目标**：从「云邮教学空间」(ucloud.bupt.edu.cn) 自动抓取课业/待办列表。

---

## 当前状态

### 已完成的工作

1. **网络 JSON 捕获机制**：已实现 Playwright 监听 XHR/fetch 响应并解析 JSON
   - 文件：`python/homework_fetcher.py`
   - 关键函数：`_attach_network_json_capture()`, `_items_from_network_bucket()`

2. **自动导航逻辑**：当检测到首页 (`#/`) 时，自动跳转到学生页 (`#/student/homePage`)
   - 见 `fetch_homework()` 函数中的导航逻辑

3. **登录态保存**：`playwright_storage_state.json` 存在且包含 CAS 票据

4. **调试输出**：添加了详细的请求日志和调试文件生成
   - `debug_page.html` - 页面 DOM
   - `debug_page.png` - 页面截图
   - `debug_network.json` - 捕获的网络请求
   - `homework_cache.json` - 抓取结果缓存

### 诊断结果

**关键发现**：

```
[调试] 页面URL: https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage
[调试] 页面标题: 云邮教学空间
[调试] 捕获到 0 个接口请求
```

- 页面成功导航到 `#/student/homePage`
- 但 **Playwright 没有捕获到任何 XHR/fetch 请求**
- 只有静态资源请求（document, script, stylesheet, image）
- Vue SPA 似乎没有发起 API 请求，或请求被过滤掉了

---

## 可能的原因

### 1. 课业数据不在当前页面
`#/student/homePage` 可能不是课业列表页。课业可能在：
- 其他 hash 路由（如 `#/student/homework`, `#/student/tasks`）
- 需要通过点击导航菜单才能看到的页面
- 教师端而非学生端

### 2. API 端点域名不同
课业数据 API 可能在其他域名：
- `api.bupt.edu.cn`
- `uclass-api.bupt.edu.cn`
- 其他子域名

当前 `network_capture_url_substrings` 只包含：
```python
["ucloud.bupt.edu.cn", "bupt.edu.cn", "uclass", "/api/", "homework", "task", "activity", "todo", "student"]
```

### 3. 请求类型被过滤
当前只监听 `xhr`, `fetch`, `other` 类型，但课业数据可能通过：
- `script` 类型的 JSONP 请求
- WebSocket
- 其他方式

### 4. Vue 未正确初始化
Playwright headless 模式可能导致 Vue 未正确执行，没有触发数据加载。

### 5. 登录态问题
虽然保存了 storage_state，但：
- CAS 票据可能已过期
- 需要特定 cookie 才能访问课业接口
- 需要点击某个按钮触发数据加载

---

## 下一步任务（优先级排序）

### 高优先级

1. **确认正确的课业列表页**
   - 让用户在真实浏览器中登录 ucloud.bupt.edu.cn
   - 找到课业/待办所在的页面
   - 把该页面的**完整 URL** 更新到 `config.yaml` 的 `target_url`

2. **分析真实 API 请求**
   - 让用户在浏览器开发者工具 (F12) 中查看 Network 标签
   - 刷新课业页面，找到包含课业数据的请求
   - 记录请求的 URL 和响应格式
   - 更新 `network_capture_url_substrings` 以包含这些 URL

3. **修复网络捕获逻辑**
   - 可能需要放宽请求类型限制（不只监听 xhr/fetch）
   - 可能需要移除 URL 过滤，捕获所有请求再筛选
   - 可能需要处理 WebSocket 或其他传输方式

### 中优先级

4. **添加页面交互**
   - 如果课业数据需要点击某个按钮才加载，添加自动点击逻辑
   - 如果页面是虚拟列表，确保滚动逻辑正确触发数据加载

5. **处理登录态过期**
   - 检测登录态是否有效
   - 如过期，提示用户重新登录

### 低优先级

6. **优化解析逻辑**
   - 根据实际 API 响应格式，调整 `_items_from_network_bucket()`
   - 可能需要添加特定字段的解析

---

## 关键文件

| 文件 | 作用 |
|------|------|
| `python/homework_fetcher.py` | 核心抓取逻辑，含网络捕获和解析 |
| `python/config.yaml` | 用户配置（URL、超时、过滤规则等） |
| `python/config.example.yaml` | 配置示例 |
| `playwright_storage_state.json` | 浏览器登录态 |
| `homework_cache.json` | 抓取结果缓存 |
| `debug_page.html` | 调试：页面 DOM 快照 |
| `debug_network.json` | 调试：捕获的网络请求 |
| `electron/main.js` | Electron 主进程 |

---

## 调试命令

```bash
# 带调试输出运行抓取
python python/app.py fetch --debug

# 重新登录（更新登录态）
python python/app.py login

# 启动 Electron 应用
npm start

# 查看调试文件
cat debug_network.json
cat homework_cache.json
```

---

## 需要用户提供的信息

为继续修复，需要用户提供：

1. **课业列表的真实 URL**：浏览器地址栏里，显示课业列表时的完整 URL
2. **API 请求样本**：F12 Network 中，返回课业数据的请求 URL（可打码敏感信息）
3. **API 响应样本**：课业接口返回的 JSON 结构（可打码敏感信息）

---

## 最后诊断日志

```
[响应] document https://ucloud.bupt.edu.cn/uclass/index.html
[响应] script   .../app.d7481dc984b8dbe8ddcb.js
[响应] script   .../vendor.c53c75b48a681e232b4c.js
[导航] 当前在首页(#/)，尝试跳转到学生页...
[调试] 页面URL: https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage
[调试] 页面标题: 云邮教学空间
[调试] 捕获到 0 个接口请求
已写入 homework_cache.json ，共 0 条
```

**问题核心**：Vue 应用已加载，但没有触发 API 请求或请求未被捕获。

---

*交接时间：2026-05-05*
*交接人：前 Claude Code 会话*
*状态：待诊断正确的课业页面 URL 和 API 端点*

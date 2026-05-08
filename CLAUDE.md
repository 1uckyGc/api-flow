# FollowmeeeAIGC

面向电商内容创作者的 AI 图片 / 视频生产平台。上传一张产品图、写一句简要需求，批量产出 N 个营销级图片与视频变体。

## 项目速览

| | |
|---|---|
| **后端** | Python 3.10 · FastAPI · SQLAlchemy 2 · Alembic · Celery 5 |
| **前端** | React 18 · Vite 5 · Zustand · TailwindCSS · React Router 6 |
| **存储** | PostgreSQL 15（关系数据） · Redis 7（broker + result backend） |
| **AI 网关** | **三家并存按模型名分发**：HOLO（`api.dealonhorizon.us`，异步轮询）、Flow2API（`followmeee.co`，OpenAI 兼容 SSE）、Grok2API（`grok-imagine-*`，多端点）。`AI_PROVIDER` 仅作未命中模型时的兜底；DeepSeek 做提示词扩写 |
| **实时通信** | WebSocket（按用户分发，见 `backend/app/routers/ws.py`） |
| **容器** | docker-compose，5 个服务（db / redis / backend / worker / frontend） |

产品功能、部署步骤、用户指南详见 `README.md`。

## 顶层目录

```
backend/                    FastAPI 应用 + Celery worker
  app/
    main.py                 FastAPI 入口，挂载 /outputs 与 /uploads
    config.py               pydantic-settings；含 HOLO_/FLOW2API_/GROK_ 三套独立凭据
    database.py             SQLAlchemy engine + Base
    models/                 ORM — user / task / workflow / settings / api_call_log
    routers/                HTTP + WebSocket 端点（auth, tasks, ws, settings, director, workflows, config, logs）
    schemas/                Pydantic 请求/响应结构
    services/
      ai_service.py         HOLO + Flow2API 客户端 (AIClient) — submit/poll/download + SSE
      grok_client.py        Grok2API 客户端 (T2I/I2I/T2V/I2V)
      model_registry.py     **路由权威源** — resolve_provider(model) 按前缀/关键字定 provider；strip_provider_prefix() 去掉 flow2api/holo/grok 显式前缀
      dispatcher.py         **worker 唯一入口** — dispatch_generate()，按 provider 分发 + 调用日志埋点
      call_logger.py        record_api_call / complete_api_call (短事务，不依赖外部 db)
      followmeee_auth.py    集中身份代理：verify_via_followmeee() 调 followmeee.co/api/login + extract_is_admin/display_name
    workers/                Celery 任务
      tasks.py              process_generation 主入口
      director_worker.py    导演模式（锚点 → 并行帧）
      workflow_worker.py    创意工坊运行实例
      cleanup_tasks.py      celery beat 两个清理任务：
                              03:30 purge_old_logs (30 天 ApiCallLog 行)
                              04:00 purge_old_artifacts (3 天 task_groups + 文件 + 前端记录)
      celery_app.py         Celery 工厂 + beat schedule
    prompts.py              提示词模板中心（LLM + 图像）
    utils/                  scheduler（限流）/ file_cleanup / logger
  alembic/                  数据库迁移（head: b7c91e2f4d10_add_api_call_log）
  uploads/                  用户上传（挂载在 /uploads）
  outputs/                  AI 生成结果（挂载在 /outputs）
frontend/                   Vite + React 单页应用
  src/
    App.jsx                 路由表；除 /login 外全部 token 鉴权
    api/                    axios 实例 + 各业务 endpoint 客户端（client.js / logs.js / ...）
    pages/                  顶层工作区 — fission / director / workshop / FissionWorkspace / Logs（调用日志页）
    components/             Layout / Inbox / Gallery / Settings / Studio / TaskCreate / Toolbox / Utility
    constants/models.js     前端模型注册表（与后端 model_registry.py 对齐 + providerOf() 前缀检测）
    stores/                 Zustand store — auth / settings / task / theme / workshop
docker-compose.yml          5 服务编排（worker 命令: --beat 启用 celery beat、--pool=threads 启用线程池、-c ${MAX_CONCURRENT_TASKS:-50}）
```

## 模式地图

产品分三大创作模式 + 四个工具箱模式：

| 模式 | 路由 | 用途 |
|---|---|---|
| **裂变（Fission）** | `/fission` | 一图一句话 → DeepSeek 扩写 N 条 → 并行渲染 → 可选批量出视频 |
| **导演模式（Director）** | `/director` | 剧本 → DeepSeek 拆 N 个分镜 → 锚点帧 → 并行剩余帧 → 可选批量出视频 |
| **创意工坊（Workshop）** | `/workshop`、`/workshop/build`、`/workshop/run` | 用户自建多步工作流（模板 + 运行实例） |
| **工具箱（Toolbox）** | `/t2i`、`/i2i`、`/t2v`、`/i2v` | 一次性的 文生图 / 图生图 / 文生视频 / 图生视频；下拉按 HOLO / Flow2API / Grok 三组分隔 |
| **资产库** | `/assets` | 全部生成结果的瀑布流画廊 |
| **调用日志** | `/logs` | 双 Tab：本地 ApiCallLog（含扣费/HOLO_id/状态过滤） + 代理 HOLO `/me/transactions` 官方账单 |

`backend/app/models/task.py::TaskSource` 是 8 种任务来源的唯一定义点（`TOOLBOX`、`GALLERY`、`PIPELINE`、`GALLERY_EXTEND`、`FISSION`、`DIRECTOR`、`DIRECTOR_VIDEO`、`STORYBOARD_FISSION`）。

## 开发指令

```bash
# 整套（Docker，5 服务）
docker-compose up -d --build
docker-compose logs -f backend     # API 日志
docker-compose logs -f worker      # Celery 日志

# 推荐：仅 db+redis 在 Docker，前后端本地跑（更易调试 & 改了立即生效）
docker compose up -d db redis

cd backend
python -m venv .venv               # 项目根目录的 venv 是历史遗留（指向缺失的 Python 3.13），用 .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
# Worker（Windows 必须用 --pool=solo 或 threads，prefork 不工作）
.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo

# 前端
cd frontend
npm install
npm run dev                        # Vite :5173

# 数据库迁移
alembic revision --autogenerate -m "..."
alembic upgrade head
```

**本地启动注意事项**：
- `backend/.env` 的 `DATABASE_URL` 用 `127.0.0.1:5432`，`CELERY_BROKER_URL` 用 `127.0.0.1:6379`，`WEB_API_URL=http://127.0.0.1:8000`（worker 推 WS 通知用），不能用 Docker 服务名。
- 首次启库 Alembic 会因 enum 顺序失败（`type "tasksource" does not exist`），先跑 `Base.metadata.create_all` 再 `alembic stamp head`。
- 系统装了多个 Python 时，残留的子进程容易抢端口；`uvicorn --reload` 偶尔会卡住不重启 worker。看到诡异旧代码生效，先 `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "python.exe" }` 查清所有 python 进程并清理再重启。

## 必须知道的非显式约定

- **两张任务表，不是一张。** `task_groups` 是用户视角的"任务"（一次裂变/一次导演/一次工具箱调用 = 一个 group）；`tasks` 是它的子单元。前端按 group 列表，详情页展开子任务。
- **`config_json` 是扩展点。** 任何按模式区分的元数据（锚点文件、分镜 index、模型名、画幅比、裂变阶段等）都进 `TaskGroup.config_json` 或 `Task.config_json`，不要新增列。
- **导演模式是锚点优先。** 第 0 帧串行先生成，后续所有帧都拿第 0 帧当参考图，靠这种方式锁人物 / 场景一致性。见 `backend/app/workers/director_worker.py`。
- **导演模式有人工复核闸。** 剧本解析完后，group 状态翻成 `NEEDS_REVIEW`，worker 主动退出。前端收集用户编辑后调 `/api/director/confirm-scenes`，worker 从 Phase 2 续跑。
- **httpx client 每 task 自管，AIClient 不再缓存共享池**。`_generate_holo` / `_generate_flow2api` 入口 `client = httpx.AsyncClient(...)` + 末尾 `finally aclose`。**绝对不要再加 `self._http_pool`**：celery threads 池下 100 thread 各有自己的 loop，共享池被多 thread 检测 loop drift 互相 aclose → "Cannot send a request, as the client has been closed"。每 task 多一次 TLS handshake (~100ms) 换零 race，对 30-60s 视频任务忽略不计。grok_client 一直是 async with 模式，不受影响。
- **所有视频/图片下载必须流式，绝不用 `dl.content`**。`ai_service.py::stream_download_to_file(client, url, ext, ...)` 是共享助手 — `client.stream("GET", url)` + `aiter_bytes(64KB)` 逐块写到 `outputs/<uuid>.<ext>`，峰值内存 64KB / task。**绝对不要再用 `dl = await client.get(url); raw = dl.content`** —— 50MB mp4 整段进内存，100 并发 = 5GB 瞬时内存 = OOM 杀 worker（实测踩过）。所有三 provider 都用这个助手：HOLO `_generate_holo` 第 3 步、Grok `generate_video` / `generate_image` / `generate_image_edit`、Flow2API `_generate_flow2api` URL 下载段。失败时 helper 自己清 partial 文件，re-raise 给 caller。
- **GenerationResult.output_file_path > result.data**。流式落盘后 `result.output_file_path` 是 outputs/ 下的相对路径，`result.data` 留空。`workers/tasks.py` save 逻辑优先 `output_file_path`（HOLO/Grok/Flow2API URL 下载都走这个），fallback `result.data`（Flow2API 内嵌 base64 图片走这个，少量 5-10MB 可接受）。新代码必须遵守这个约定，避免 50MB+ bytes 在 worker 内存里堆。
- **API 限流就一个入口**：`utils/scheduler.py::wait_for_api_slot`。所有图像、视频上游调用都过这里。
- **视频延展走尾帧接力**：`extract_last_frame_base64_sync` 用 `ffmpeg -sseof -0.1` 抓视频最后一帧，base64 喂回模型作为下一段的种子。
- **三 provider 按模型名分发，不再有"全局开关"**。`services/model_registry.py::resolve_provider(model)` 是路由权威：
  - `grok-` 前缀 → grok；含 `_ultra` 关键字 → flow2api；`GPT-Images` / `gemini-3.` / `imagen-` / `veo_3_` 前缀 → holo；其他 → fallback (`AI_PROVIDER`)
  - **显式前缀消歧**（最高优先级）：`flow2api/<model>` / `holo/<model>` / `grok/<model>` 用于 HOLO 与 Flow2API 同名模型（如 `gemini-3.1-flash-image-portrait`）。`_generate_*` 入口先 `strip_provider_prefix()` 再发给上游。
- **dispatcher.py 是 worker 唯一入口**。`tasks.py` 和 `director_worker.py` 都调 `dispatch_generate(...)`，内部按 provider 分发到 `ai_client.generate_with_retry`（HOLO/Flow2API）或 `_run_grok`（含 grok 自带重试 + 视频延展尾帧抽取）。也是写 ApiCallLog 的唯一埋点位置。
- **凭据全部 .env 系统级**（内部使用，不暴露 UI）。三套独立配置：`HOLO_API_URL/KEY` (`api.dealonhorizon.us`)、`FLOW2API_URL/KEY` (`https://followmeee.co`)、`GROK_API_URL/KEY` (`38.64.57.216:8001`)。`AI_API_URL/KEY` 是兼容兜底字段。`system_settings.veo_api_key/gemini_api_key` 是 dead column，不再读。
- **模型名别名**：HOLO 不认 `*_ultra` / `*_ultra_relaxed` / `*_ultra_fl` 这些 Flow2API 时代命名。`ai_service.py::LEGACY_MODEL_ALIASES` 是兜底翻译表（旧名 → HOLO 实名，e.g. `_ultra_relaxed` → `lite`、`_ultra` → `fast`）。
- **HOLO 失败语义**：HOLO 自动退款 `failed`/`cancelled` 任务，`_generate_holo` 在 `result` 上挂 `_terminal=True` + `_refunded`，`generate_with_retry` 看到 `_terminal` 立即早退（不走 3 次重试，避免内容策略失败烧配额）。同时 `_holo_task_id` / `_cost` 也通过 result 回传给 dispatcher 写入日志。
- **ApiCallLog 是审计而非账单**。本地表只记"谁/什么时候/为什么调用了什么"，HOLO 的钱以 `/me/transactions` 官方接口为准。
  - `/api/logs` 路由按 `username == "admin"` 判管理员，能筛全用户；普通用户强制 `user_id=self`。
  - `/api/logs/balance` + `/api/logs/transactions` 是**账户级共享数据（同一把 HOLO key 的余额/账单），仅 admin 可访问**，普通用户 403；前端 `Logs.jsx` 检查 `is_admin` 后再渲染 KPI 条和 HOLO 账单 Tab。
- **前端 submit 按 `providerOf(model)` 分发，不依赖全局 provider**。`ToolPanel.jsx` / `Toolbox.jsx` 的 `finalModel` 拼装路径：
  - `flow2api/` 显式前缀 → 直接传（dispatcher 后端 strip 前缀）
  - `providerOf(model) === 'flow2api'` → 走 `mapModelForFlow2API()`（含 `_ultra` 别名）
  - `gemini-*` 短别名 → 用 `ORIENT_SUFFIX_RE` 检查是否已带方向后缀，避免 `gemini-3.1-flash-image-portrait-portrait` 双后缀
  - HOLO 视频实名 → r2v 模式时把 `_i2v_*_` 前缀替换为 `_r2v_*_`
- **登录代理 followmeee.co + 离线 admin 兜底**。`/api/auth/login` 不再用本地 bcrypt 验密，而是调 `FOLLOWMEEE_AUTH_URL/api/login`（默认 `https://followmeee.co`）：
  - 上游 200 → `_lazy_upsert_user()` 在本地 users 表懒建一行（hashed_password=`!followmeee-managed`，永远 verify=False，外键 tasks.user_id 等仍可用）→ 签 api-flow 自己的 JWT。前端零改动。
  - 上游 5xx / 网络错 → 标记 `upstream_unreachable`，进兜底
  - **离线 admin 兜底**：当 username == `EMERGENCY_ADMIN_USERNAME` 且 `verify_password(pwd, EMERGENCY_ADMIN_PASSWORD_HASH)` 通过时放行（hash 在 `.env`，留空则关闭兜底通道）。
  - **本地注册已禁用**：`POST /api/auth/register` 返回 410 Gone，账户统一在 https://followmeee.co/manage 管理。
  - **`is_admin` 判定**：`extract_is_admin(upstream)` 兼容多种 shape (`user.is_admin` / `user.role==admin` / 顶层 `is_admin`)；followmeee.co 实际响应字段如有变化，改这一个函数即可。
- **docker-compose `env_file` 会对 `$` 做变量插值**。bcrypt hash 里的 `$2b$12$...` 必须在 `.env` 写成 `$$2b$$12$$...`（双写转义），否则 `$abc` 会被当作未设变量替换为空，hash 被破坏。同样适用任何含 `$` 的密码/token。
- **Celery worker 用 `--pool=threads` 不是 prefork**。HOLO/Flow2API 调用是纯 IO-bound（HTTP 等待），prefork 模式每个 worker 是独立 Python 进程，~80MB baseline，c=100 直接吃 8GB → OOM；threads 池 1 进程 + N 线程，c=100 仅 ~80MB 总占用。现状已切 threads + `MAX_CONCURRENT_TASKS=100`（远程 154.53.75.37 实测稳定）。
  - 配套：`backend/app/database.py` `create_engine(... pool_size=30, max_overflow=20, pool_pre_ping=True, pool_recycle=300)` — 默认 5+10 不够 100 threads 同时拉连接，会 QueuePool overflow
  - threads 池不支持 `--max-memory-per-child`，用 `--max-tasks-per-child=200` 替代（每 worker 处理 200 任务后自动回收）
  - threads 共享内存的 race 实战教训：曾经 `AIClient._http_pool` "per-loop 隔离" 在 prefork 模式下没事（每进程一个 loop），切 threads 后 100 个 loop 同时活互相 aclose 导致大面积失败；现状已改成 per-task client（见上一条）。`grok_client` 用 `async with`、scheduler `_redis_client` 是 per-loop 单例（每 loop 各自的，不共享同一对象）→ 安全。**未来加 module-level mutable state 必须考虑线程竞态**
- **速率锁按 provider 拆桶，HOLO 不再有本地锁**。`ai_service.py::generate()` 现状：
  - HOLO：跳过 `wait_for_api_slot`（HOLO `/v1/generate` 上游 85 generators 自管排队）
  - Flow2API：`wait_for_api_slot(api_type="flow2api", interval_base=5)` — 自托管易触验证码，5s 一个 slot 严格串行
  - Grok：`wait_for_api_slot(api_type="grok", interval_base=1)` — 在 `grok_client.py` 内调
  - 之前共享 `gemini_veo` slot + 10s 间隔，把 HOLO 锁成 1 task/10s（每小时上限 360）；现在 HOLO 真并发 = `MAX_CONCURRENT_TASKS`
- **服务器内存上限定 worker 并发**。154.53.75.37 是 4GB 机器、无 swap，threads pool c=100 实测 ~80MB worker 内存；prefork c=100 实测必然 OOM（8GB 需求）。**别动 prefork 的 concurrency 高于 20**，要更高用 threads。x-ui / xray VLESS 也跑在同一台机器上，OOM 会让 VLESS 转发挂掉（曾踩过）。
- **静态挂载 30 天 immutable 缓存**。`/outputs` 和 `/uploads` 路径走 `add_cache_headers` 中间件，文件名是 UUID 所以这样安全。
- **3 天滚动清理 task_groups + 文件 + 前端记录**。`workers/cleanup_tasks.py::purge_old_artifacts` 每天 04:00 跑：
  - 删 `created_at < now - 3d` 的 task_groups（cascade 级联删 sub tasks）
  - 物理删 `task.output_file` / `output_thumbnail` / `input_files` / `task_group.config_json["anchor_file"]`
  - **保护规则（A1）**：任何 sub task `status == RUNNING` 的 group 永远不删；`QUEUED / RETRY` 超 3 天视为僵尸一并删
  - **导演 NEEDS_REVIEW（B2）**：跟成功任务一样 3 天清（不给宽限）
  - **fission 父子链（C1）**：整链一起删，自引用 `fission_parent_id` 反向引用先置 NULL 解 FK
  - **ApiCallLog 保留**：`task_id` / `group_id` FK 置 NULL，账单审计行不删（30 天那条规则单独管）
  - 服务器稳态磁盘 ≈ 3 天产出量（~5GB），永不爆。前端任务列表 3 天后自动消失（DB 行被删）。
  - 手动触发：`docker exec followmeeeaigc_worker python -c "from app.workers.cleanup_tasks import purge_old_artifacts; print(purge_old_artifacts())"`
- **Toolbox 下拉的真正实现是 `Utility/ToolPanel.jsx`**（不是 `Toolbox/Toolbox.jsx`）。`/t2i /i2i /t2v /i2v` 全部走 ToolPanel 的硬编码 option 列表 + 三 provider optgroup 分组渲染。改下拉**只改 ToolPanel.jsx**。
- **Windows + Docker Desktop rebuild 前端时的两个坑**：
  - rebuild 后只 recreate frontend 才能生效：`docker compose up -d --force-recreate --no-deps frontend`
  - BuildKit 多阶段缓存有时复用旧 dist。改源码 vite hash 不变 = build context 没拿到新文件，先 `docker buildx prune -af` 或临时 `DOCKER_BUILDKIT=0 docker compose build --no-cache frontend` 用经典 builder
- **本备份特有的状态**：
  - `backend/uploads/` 还存着 283 MB 历史用户上传
  - `backend/logs/` 最后一行是 2026-04-29
  - `alembic/versions/` 里有三份同名 `add_director_storyboard_sources`，是历史合并冲突的残留，只有一份在主链上
  - `backend/venv/` 被一起打进备份了（不要当源码看）
  - `main.py` 启动时同时跑 `Base.metadata.create_all()` 和 `alembic upgrade head`，双轨并存，遇 enum 改动可能打架

## Agent skills

### Issue tracker

Issue 与 PRD 以 markdown 文件形式存放在 `.scratch/<feature-slug>/` 下。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个固定 triage 角色，1:1 映射到默认标签字符串（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。详见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文布局：根目录 `CONTEXT-MAP.md` 指向 `backend/` 与 `frontend/` 各自的 `CONTEXT.md`。详见 `docs/agents/domain.md`。

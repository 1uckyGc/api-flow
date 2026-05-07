# FollowmeeeAIGC

面向电商内容创作者的 AI 图片 / 视频生产平台。上传一张产品图、写一句简要需求，批量产出 N 个营销级图片与视频变体。

## 项目速览

| | |
|---|---|
| **后端** | Python 3.10 · FastAPI · SQLAlchemy 2 · Alembic · Celery 5 |
| **前端** | React 18 · Vite 5 · Zustand · TailwindCSS · React Router 6 |
| **存储** | PostgreSQL 15（关系数据） · Redis 7（broker + result backend） |
| **AI 网关** | **双协议并存**：HOLO API（`api.dealonhorizon.us`，异步提交-轮询-下载）或 Flow2API（OpenAI 兼容 SSE 流式）。`.env` 的 `AI_PROVIDER=holo\|flow2api` 切换；DeepSeek 做提示词扩写 |
| **实时通信** | WebSocket（按用户分发，见 `backend/app/routers/ws.py`） |
| **容器** | docker-compose，5 个服务（db / redis / backend / worker / frontend） |

产品功能、部署步骤、用户指南详见 `README.md`。

## 顶层目录

```
backend/                    FastAPI 应用 + Celery worker
  app/
    main.py                 FastAPI 入口，挂载 /outputs 与 /uploads
    config.py               pydantic-settings，读取 .env
    database.py             SQLAlchemy engine + Base
    models/                 ORM 模型 — user / task / workflow / settings
    routers/                HTTP + WebSocket 端点
    schemas/                Pydantic 请求/响应结构
    services/ai_service.py  AI 网关客户端（httpx 流式 SSE + 重试）
    workers/                Celery 任务 — 通用生成 + director + workflow
    workers/celery_app.py   Celery 工厂
    prompts.py              提示词模板中心（LLM + 图像）
    utils/                  scheduler（限流）/ file_cleanup / logger
  alembic/                  数据库迁移
  uploads/                  用户上传（挂载在 /uploads）
  outputs/                  AI 生成结果（挂载在 /outputs）
frontend/                   Vite + React 单页应用
  src/
    App.jsx                 路由表；除 /login 外全部 token 鉴权
    api/client.js           axios 实例 + 鉴权拦截器
    pages/                  顶层工作区 — fission / director / workshop / FissionWorkspace
    components/             Layout / Inbox / Gallery / Settings / Studio / TaskCreate / Toolbox / Utility
    stores/                 Zustand store — auth / settings / task / theme / workshop
docker-compose.yml          5 服务编排
```

## 模式地图

产品分三大创作模式 + 四个工具箱模式：

| 模式 | 路由 | 用途 |
|---|---|---|
| **裂变（Fission）** | `/fission` | 一图一句话 → DeepSeek 扩写 N 条 → 并行渲染 → 可选批量出视频 |
| **导演模式（Director）** | `/director` | 剧本 → DeepSeek 拆 N 个分镜 → 锚点帧 → 并行剩余帧 → 可选批量出视频 |
| **创意工坊（Workshop）** | `/workshop`、`/workshop/build`、`/workshop/run` | 用户自建多步工作流（模板 + 运行实例） |
| **工具箱（Toolbox）** | `/t2i`、`/i2i`、`/t2v`、`/i2v` | 一次性的 文生图 / 图生图 / 文生视频 / 图生视频 |
| **资产库** | `/assets` | 全部生成结果的瀑布流画廊 |

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
- **httpx 连接池绑事件循环。** `services/ai_service.py::AIClient._get_client` 在检测到 loop 漂移时会重建连接池（修 Celery + asyncio 经典踩坑）。**别把 `AIClient` 状态在多个 loop 之间裸共享**。
- **API 限流就一个入口**：`utils/scheduler.py::wait_for_api_slot`。所有图像、视频上游调用都过这里。
- **视频延展走尾帧接力**：`extract_last_frame_base64_sync` 用 `ffmpeg -sseof -0.1` 抓视频最后一帧，base64 喂回模型作为下一段的种子。
- **Key 分两级**：Gemini / Veo key 是按用户存在 `system_settings` 里的；DeepSeek key 是系统级的（`.env`）。`_get_user_api_key` 按模型名关键字选用户那把。HOLO 模式下两栏可填同一把 HOLO key，留空则回退 `.env` 的 `AI_API_KEY`。
- **AI provider 切换**：`backend/.env` 的 `AI_PROVIDER` 决定走 HOLO 异步轮询还是 Flow2API SSE 流式。`AIClient.generate()` 是分发器，下沉到 `_generate_holo` 或 `_generate_flow2api`。两个分支的对外契约（`GenerationResult` shape）一致，worker 不感知差异。
- **模型名别名**：HOLO 不认 `*_ultra` / `*_ultra_relaxed` / `*_ultra_fl` 这些 Flow2API 时代命名。`ai_service.py::LEGACY_MODEL_ALIASES` 是兜底翻译表（旧名 → HOLO 实名，e.g. `_ultra_relaxed` → `lite`、`_ultra` → `fast`）。前端 dropdown 由 `useProvider()` + `constants/models.js` 决定按当前 provider 展示哪一套。
- **HOLO 失败语义**：HOLO 自动退款 `failed`/`cancelled` 任务，`_generate_holo` 在 `result` 上挂 `_terminal=True`，`generate_with_retry` 看到该标志立即早退，不走 3 次重试（避免在内容策略失败上重复烧配额）。
- **静态挂载 30 天 immutable 缓存**。`/outputs` 和 `/uploads` 路径走 `add_cache_headers` 中间件，文件名是 UUID 所以这样安全。
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

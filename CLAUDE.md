# FollowmeeeAIGC

面向电商内容创作者的 AI 图片 / 视频生产平台。上传一张产品图、写一句简要需求，批量产出 N 个营销级图片与视频变体。

## 项目速览

| | |
|---|---|
| **后端** | Python 3.10 · FastAPI · SQLAlchemy 2 · Alembic · Celery 5 |
| **前端** | React 18 · Vite 5 · Zustand · TailwindCSS · React Router 6 |
| **存储** | PostgreSQL 15（关系数据） · Redis 7（broker + result backend） |
| **AI 网关** | **多家并存按模型名分发**：HOLO（`api.dealonhorizon.us`，异步轮询）、Flow2API（`followmeee.co`，OpenAI 兼容 SSE）、Grok2API（`grok-imagine-*`，多端点）、**PackyAPI**（`packyapi.com`，Gemini OpenAI 形态，仅复刻视频 LLM 用）、**Dreamina CLI**（即梦 v1.4.x，subprocess，复刻视频产线 B 用）。`AI_PROVIDER` 仅作未命中模型时的兜底；DeepSeek 做提示词扩写 |
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
      packy_gemini.py       PackyAPI Gemini OpenAI-shape 客户端 — 复刻视频 LLM 自动模式（视频靠 image_url + data:video/mp4 inline 喂）
      dreamina_client.py    即梦 CLI subprocess 包装 — image2video submit + 轮询 + --download_dir → outputs/<uuid>.mp4
      storyboard/           复刻视频引擎（vendor 自 storyboard_engine_v3）
        pipeline.py         render_master_prompt / parse_llm_output (含 (B9) + ===CLI_PAYLOAD=== 解析) / save_gus_to_dir
        prompts/01_master_prompt.md  6 阶段 LLM 主提示词（{{BRAND_CONFIG_BLOCK}} 注入点 + (B9) JSON + CLI_PAYLOAD 汇总）
    routers/
      replicate.py          /api/replicate/* 7 端点：jobs CRUD + llm-output + gus + generate-image / generate-video
    workers/                Celery 任务
      tasks.py              process_generation 主入口
      director_worker.py    导演模式（锚点 → 并行帧）
      workflow_worker.py    创意工坊运行实例
      replicate_tasks.py    复刻视频两个 Celery 任务：
                              run_storyboard_llm (PackyAPI Gemini 跑 6 阶段 LLM)
                              run_video_via_dreamina (即梦 CLI 出 seedance2.0fast 视频)
      cleanup_tasks.py      celery beat 两个清理任务：
                              03:30 purge_old_logs (30 天 ApiCallLog 行)
                              04:00 purge_old_artifacts (3 天 task_groups + 文件 + 前端记录 + replicate workdir rmtree)
      celery_app.py         Celery 工厂 + beat schedule
    prompts.py              提示词模板中心（LLM + 图像）
    utils/                  scheduler（限流）/ file_cleanup / logger
  alembic/                  数据库迁移（head: c8d4e9f2a1b3_add_storyboard_replicate_enums）
  uploads/                  用户上传（挂载在 /uploads）
  outputs/                  AI 生成结果（挂载在 /outputs）
frontend/                   Vite + React 单页应用
  src/
    App.jsx                 路由表；除 /login 外全部 token 鉴权
    api/                    axios 实例 + 各业务 endpoint 客户端（client.js / logs.js / ...）
    pages/                  顶层工作区 — fission / director / workshop / FissionWorkspace / Logs / replicate（复刻视频）
    pages/replicate/        ReplicatePage（壳）/ InputForm / AwaitingLLMOutput / GUList（双产线卡片+JSON 复制按钮）
    components/             Layout / Inbox / Gallery / Settings / Studio / TaskCreate / Toolbox / Utility
    constants/models.js     前端模型注册表（与后端 model_registry.py 对齐 + providerOf() 前缀检测）
    stores/                 Zustand store — auth / settings / task / theme / workshop
docker-compose.yml          5 服务编排：worker 命令 `--beat --pool=threads --max-tasks-per-child=200 -c ${MAX_CONCURRENT_TASKS:-50}`；
                              worker 挂三个数据卷：outputs_data（共享出图）、dreamina_session（/root/.dreamina_cli — tasks.db / 日志）、
                              dreamina_token（/root/.local/share/dreamina — OAuth token，关键）。
                              **backend 容器也挂 dreamina_token 同一卷**（/api/logs/providers 在 backend 进程里跑
                              dreamina user_credit 查余额，必须看到 worker 写入的登录态）。
```

## 模式地图

产品分三大创作模式 + 四个工具箱模式：

| 模式 | 路由 | 用途 |
|---|---|---|
| **裂变（Fission）** | `/fission` | 一图一句话 → DeepSeek 扩写 N 条 → 并行渲染 → 可选批量出视频 |
| **导演模式（Director）** | `/director` | 剧本 → DeepSeek 拆 N 个分镜 → 锚点帧 → 并行剩余帧 → 可选批量出视频 |
| **创意工坊（Workshop）** | `/workshop`、`/workshop/build`、`/workshop/run` | 用户自建多步工作流（模板 + 运行实例） |
| **工具箱（Toolbox）** | `/t2i`、`/i2i`、`/t2v`、`/i2v` | 一次性的 文生图 / 图生图 / 文生视频 / 图生视频；下拉按 HOLO / Flow2API / Grok 三组分隔 |
| **复刻视频（Replicate）** | `/replicate` | 上传样片 + 商品图 + 品牌表单 → Gemini 跑 6 阶段产 N 个 GU → 每 GU 双产线（A: HOLO `GPT-images2 1:1` 9 宫格；B: 即梦 `seedance2.0fast` 15s 视频）|
| **资产库** | `/assets` | 全部生成结果的瀑布流画廊 |
| **调用日志** | `/logs` | 顶部多 provider 信息卡（HOLO 余额 / PackyAPI 累计 USD / 即梦 credits + VIP 等级，30s 自动轮询）+ 双 Tab：本地 ApiCallLog 过滤分页 + 代理 HOLO `/me/transactions` 官方账单 |

`backend/app/models/task.py::TaskSource` 是 9 种任务来源的唯一定义点（`TOOLBOX`、`GALLERY`、`PIPELINE`、`GALLERY_EXTEND`、`FISSION`、`DIRECTOR`、`DIRECTOR_VIDEO`、`STORYBOARD_FISSION`、`STORYBOARD`）。
`GroupStatus` 加了 `AWAITING_LLM_INPUT`（手动模式等用户粘 LLM 输出）。

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
- **三 provider 按模型名分发，不再有"全局开关"**。`services/model_registry.py::resolve_provider(model)` 是路由权威（**case-insensitive** 比较，HOLO 模型名大小写不稳）：
  - `grok-` 前缀 → grok；含 `_ultra` 关键字 → flow2api；`gpt-images` / `gemini-3.` / `imagen-` / `veo_3_` / `sora-` 前缀 → holo；其他 → fallback (`AI_PROVIDER`)
  - **显式前缀消歧**（最高优先级）：`flow2api/<model>` / `holo/<model>` / `grok/<model>` 用于 HOLO 与 Flow2API 同名模型（如 `gemini-3.1-flash-image-portrait`）。`_generate_*` 入口先 `strip_provider_prefix()` 再发给上游。
- **HOLO 改名警告**：HOLO 把老的 `GPT-Images 2.0`（带空格、点、零）改成 `GPT-images2 X:Y[-2K|-4K]` 系列（小写 i、无空格、按比例分变体，如 `GPT-images2 1:1`、`GPT-images2 9:16-4K`）。任何硬编码模型名都要查 HOLO `/v1/models`。Storyboard 9 宫格图默认走 `GPT-images2 1:1`（方形）。`model_registry.py` 走 lowercase 前缀比较所以兼容老名，但 HOLO 上游会拒老名。
- **dispatcher.py 是 worker 唯一入口**。`tasks.py` 和 `director_worker.py` 都调 `dispatch_generate(...)`，内部按 provider 分发到 `ai_client.generate_with_retry`（HOLO/Flow2API）或 `_run_grok`（含 grok 自带重试 + 视频延展尾帧抽取）。也是写 ApiCallLog 的唯一埋点位置。
- **凭据全部 .env 系统级**（内部使用，不暴露 UI）。三套独立配置：`HOLO_API_URL/KEY` (`api.dealonhorizon.us`)、`FLOW2API_URL/KEY` (`https://followmeee.co`)、`GROK_API_URL/KEY` (`38.64.57.216:8001`)。`AI_API_URL/KEY` 是兼容兜底字段。`system_settings.veo_api_key/gemini_api_key` 是 dead column，不再读。
- **模型名别名**：HOLO 不认 `*_ultra` / `*_ultra_relaxed` / `*_ultra_fl` 这些 Flow2API 时代命名。`ai_service.py::LEGACY_MODEL_ALIASES` 是兜底翻译表（旧名 → HOLO 实名，e.g. `_ultra_relaxed` → `lite`、`_ultra` → `fast`）。
- **HOLO 失败语义**：HOLO 自动退款 `failed`/`cancelled` 任务，`_generate_holo` 在 `result` 上挂 `_terminal=True` + `_refunded`，`generate_with_retry` 看到 `_terminal` 立即早退（不走 3 次重试，避免内容策略失败烧配额）。同时 `_holo_task_id` / `_cost` 也通过 result 回传给 dispatcher 写入日志。
- **ApiCallLog 是审计而非账单**。本地表只记"谁/什么时候/为什么调用了什么"，HOLO 的钱以 `/me/transactions` 官方接口为准。
  - `/api/logs` 路由按 `username == "admin"` 判管理员，能筛全用户；普通用户强制 `user_id=self`。
  - `/api/logs/balance` + `/api/logs/transactions` 是**账户级共享数据（同一把 HOLO key 的余额/账单），仅 admin 可访问**，普通用户 403；前端 `Logs.jsx` 检查 `is_admin` 后再渲染 provider 卡片网格和 HOLO 账单 Tab。
  - **`/api/logs/providers` 多 provider 余额聚合（admin only）**：asyncio.gather 并发拉 HOLO `/me`、PackyAPI `/v1/dashboard/billing/usage` + subscription、Dreamina `dreamina user_credit` 子进程。统一返 `{provider, label, online, primary: {label, value, unit}, metrics: {...}, error?}` 形态，单个 provider 失败不影响其他。
  - **PackyAPI sk-key 拿不到余额**：`/api/user/*` 端点要"access token"（dashboard 登录会话），sk-key 只能拿 `/v1/dashboard/billing/usage`（累计 USD）+ `/v1/dashboard/billing/subscription`（hard_limit 1e8 实际无意义）。账户余额需要去 packyapi.com 控制台手查。
  - **Flow2API / Grok 没暴露余额端点**（Flow2API 全 404；Grok 在 worker 容器内不可达 / 多数部署没配 GROK_API_KEY），不出现在 providers 卡片里。
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
- **复刻视频（/replicate）三段式流程**：
  - **阶段 1 — LLM**：上传样片视频 + N 张商品图 + 品牌表单 → 渲染 `01_master_prompt.md`（注入 `{{BRAND_CONFIG_BLOCK}}`）。
    - **自动模式（默认勾选）**：派 `run_storyboard_llm` Celery 任务调 PackyAPI Gemini → group.status 从 PROCESSING → COMPLETED；视频靠 `{type:image_url, image_url:{url:"data:video/mp4;base64,..."}}` 单条 POST 喂给 gemini-3-flash-preview，gateway 按 mime 路由到 Gemini 视频解码器（**OpenAI 形态 `/v1/chat/completions`，不是 Gemini `/v1beta/`，PackyAPI Gemini 分组 key 走这条**）
    - **手动模式（不勾）**：group.status=`AWAITING_LLM_INPUT`，前端展示主提示词 + 复制按钮 + 粘贴框，用户拿到 ChatGPT/Gemini 网页跑完后粘回来，调 `/api/replicate/jobs/{id}/llm-output` 解析
  - **阶段 2 — 解析**：`storyboard/pipeline.py::parse_llm_output(text)` 拆 N 个 GU。每个 GU 抽 `pipeline_a_image` / `pipeline_b_video`（合并文本）+ `pipeline_b_zh` / `pipeline_b_json_text`（v3.2 分段）+ `cli_payload`（机读 JSON）。**模板版本兼容矩阵**（parser 三版本都跑得通）：
    - **v3.0**：`[产线 A]` / `[产线 B]` —— 无 cli_payload，dreamina 用 pipeline_b_video 当 prompt
    - **v3.1**：扩展模板，`[产线 B]` 内有 `(B9) DREAMINA_CLI_JSON ```json``` ` + 末尾 `===CLI_PAYLOAD=== ... ===CLI_PAYLOAD_END===` 汇总。汇总 trumps inline
    - **v3.2 (当前)**：`[产线 A]` / `[产线 B-zh]`（中文口语版给 Seedance/Veo 直喂）/ `[产线 B-json]`（富 JSON：duration_sec / shot_continuity / camera_motion 27 条术语库 / motion_timeline / hard_constraints / negative_prompt）。**parser 优先抽 [B-json] block**，回退 v3.1 (B9)，再回退 v3.1 末尾汇总。dreamina prompt 优先级：req.override > pipeline_b_zh > payload.prompt > pipeline_b_video
  - **阶段 3 — 双产线触发**：每个 GU 卡片两个按钮，前端顶部还有**全局工具栏**让用户选 seedance 模型 + 分辨率，覆盖到所有"一键出视频"调用：
    - **产线 A · 9 宫格图** → `POST /api/replicate/jobs/{id}/gus/{gu_id}/generate-image`，新建 `Task(group_id=storyboard, kind=image, model=GPT-images2 1:1)` → `process_generation` → HOLO 出图。LLM 产的 prompt 自带"3×3 grid of 9 panels with timestamps"描述，所以方图就是 9 宫格。
    - **产线 B · 15s 视频** → `POST /api/replicate/jobs/{id}/gus/{gu_id}/generate-video` 接 `model_version` + `video_resolution` + `duration` + `prompt_override`（前端工具栏选的覆盖 cli_payload）→ `run_video_via_dreamina` Celery 任务 → subprocess `dreamina image2video` → 轮询 `query_result` → `--download_dir` 下载 mp4 → `move_to_outputs()` 重命名到 `outputs/<uuid>.mp4`
    - **1080p 兼容性 guard**：seedance2.0fast / seedance2.0 标准版仅支持 720p，**只有 `seedance2.0_vip` / `seedance2.0fast_vip` 才能跑 1080p**。`replicate.py::generate_video` 服务端 guard：`"vip" not in model_version` 时强制 `video_resolution=720p`，避免 LLM 产 cli_payload.resolution=1080p 后被 dreamina 上游 reject。前端联动：模型不含 vip 时 1080p 选项 disabled
  - **GenerateVideoRequest** 不走 `dispatch_generate`（HOLO/Flow2API/Grok 路由），是独立的 Dreamina subprocess 路径。
- **execute_generation_task task.config_json 优先 group.config_json**。Storyboard 一组里图+视频混跑（产线 A 用 HOLO `GPT-images2 1:1`，产线 B 用 即梦 `seedance2.0fast`），需要"一组多 model"。`backend/app/workers/tasks.py` 已改为：`task_cfg = task.config_json or {}; merged_cfg = {**(group.config_json or {}), **task_cfg}; model = task_cfg.get("model") or group.config_json.get("model", default)`。向后兼容（老 group.config_json.model 仍生效），同时让 storyboard 子任务能各自带模型。
- **PackyAPI Gemini auto mode 关键事实**：
  - key（`PACKYAPI_GEMINI_KEY` in `.env`）必须绑 PackyAPI 的 **gemini 分组**（非 codex / sora 分组）；否则模型列表只看到 codex / sora-2 等。前端 InputForm 已放 5 个 Gemini 模型选项（`gemini-3-flash-preview` 默认启用，其他 4 个 disabled 占位等通道开通）
  - **走 `/v1/chat/completions`，不走 `/v1beta/.../generateContent`**。该 key 只开 OpenAI 形态，Gemini 原生形态网关返 503 / connection reset
  - 视频输入：把 mp4 base64 inline 进 `{type:image_url, image_url:{url:"data:video/mp4;base64,..."}}`。**只有这种 type 被 gateway 接受**；`input_video` / `video_url` / `input_image` 都被静默丢弃（prompt_tokens 暴跌即可判断 dropping）
  - 模型自带 thinking，`reasoning_tokens` 占完成 tokens 50-80%。`max_tokens` 至少 8000，6 阶段任务建议 32000
  - Token 估算：3s 128×128 视频 ≈ 218 prompt tokens；60s 720p 估算 ≈ 5k tokens；含主提示词整次调用约 10-15k tokens
- **Dreamina CLI（即梦 v1.4.x）部署关键事实**：
  - 二进制 baked into Dockerfile（backend + worker 共享同一个 image）：`RUN curl -sL https://jimeng.jianying.com/cli | bash` 装到 `/root/.local/bin/dreamina` + `ENV PATH`
  - **登录态分两个目录，必须**两个**volume 都挂（worker + backend 都挂）**：
    - `/root/.local/share/dreamina/byted_cli_user_token.json`（**OAuth token，关键**） → 卷 `dreamina_token`
    - `/root/.dreamina_cli/`（tasks.db / 日志 / SKILL.md，辅助） → 卷 `dreamina_session`（仅 worker，backend 不需要）
  - **backend 也挂 dreamina_token**：因为 `/api/logs/providers` 端点在 backend 进程里 spawn `dreamina user_credit` 子进程查余额，需要看到 worker 写入的 token；漏挂的话 backend 永远显示"未登录"但 worker 实际是好的
  - **首次部署后必须 SSH 进 worker 一次性扫码登录**：`docker exec -it followmeeeaigc_worker /root/.local/bin/dreamina login`，CLI 打印 verification_uri + user_code，抖音 App 扫码授权（device_code 5-10 min 内必须扫，过期会"数据不存在"，用 `dreamina relogin` 重来）
  - **OAuth Device Flow，不是 QR 扫码** —— 标题虽然说扫码，实际是抖音 App 输入 user_code 确认，授权完 token 自动写盘
  - 模型走 `multimodal2video`（支持 seedance2.0 全家族）或 `image2video`（取一图当首帧；storyboard 用这个）。模型名 `seedance2.0` / `seedance2.0fast` / `seedance2.0_vip` / `seedance2.0fast_vip`（无空格无连字符）。**1080p 仅 vip 支持**，replicate.py 服务端 guard 强制非 vip 模型降到 720p
  - **队列等待是常态**：seedance2.0fast 高峰 queue_idx 200+，等 5-10 分钟很正常。dreamina_client 默认 `max_wait_sec=1800`（20 min）+ `poll_interval=15s` + 自动 log queue_idx 变化
  - 异步：`image2video --poll=0` 立即返 submit_id 不阻塞；后续 `query_result --submit_id=<id>` 轮 status，success 后再 `query_result --submit_id=<id> --download_dir=<dir>` 才下载本地 mp4
  - 单次成本：4s 720p ≈ 8 credits、15s 720p 估算 ≈ 30 credits（Maestro VIP 账户 14k+ credits）。VIP 模型队列优先级更高，credits 消耗也更高
  - **错误信息排查**：dreamina submit 失败时 `submit_id=""` + `gen_status=fail` + `fail_reason=<具体原因>`。`dreamina_client.image2video` 会优先看 gen_status，把 fail_reason 直接报上去（不要被 "could not parse submit_id" 带歪 — 那只是没真错原因时的兜底信息）
- **静态挂载 30 天 immutable 缓存**。`/outputs` 和 `/uploads` 路径走 `add_cache_headers` 中间件，文件名是 UUID 所以这样安全。
- **3 天滚动清理 task_groups + 文件 + 前端记录**。`workers/cleanup_tasks.py::purge_old_artifacts` 每天 04:00 跑：
  - 删 `created_at < now - 3d` 的 task_groups（cascade 级联删 sub tasks）
  - 物理删 `task.output_file` / `output_thumbnail` / `input_files` / `task_group.config_json["anchor_file"]`
  - **复刻视频整目录清**：`source == STORYBOARD` 的 group 还会 `shutil.rmtree("uploads/replicate/<id>")`（双 resolve 防 .. 越界），把 master_prompt / sample 视频 / GU 文本 / 下载 mp4 一并清掉
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

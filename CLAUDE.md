# FollowmeeeAIGC

面向电商内容创作者的 AI 图片 / 视频生产平台。上传一张产品图、写一句简要需求，批量产出 N 个营销级图片与视频变体。

## 项目速览

| | |
|---|---|
| **后端** | Python 3.10 · FastAPI · SQLAlchemy 2 · Alembic · Celery 5 |
| **前端** | React 18 · Vite 5 · Zustand · TailwindCSS · React Router 6 |
| **存储** | PostgreSQL 15（关系数据） · Redis 7（broker + result backend） |
| **AI 网关** | **多家并存按模型名分发**：HOLO（`api.dealonhorizon.us`，异步轮询，含 **HOLO Sora-2-12/16** OpenAI Sora 形态 i2v / t2v）、Flow2API（`followmeee.co`，OpenAI 兼容 SSE）、Grok2API（`grok-imagine-*`，多端点）、**PackyAPI**（`packyapi.com`，Gemini OpenAI 形态，复刻视频 LLM 用）、**Dreamina CLI**（即梦 v1.4.x，subprocess，4 个子命令对应 t2i/i2i/t2v/i2v）、**cc123.ai relay**（NewAPI fork，sd-2/sd-2-vip/sora-2 视频，OpenAI Sora compat /v1/video/generations）。`AI_PROVIDER` 仅作未命中模型时的兜底 |
| **提示词 LLM** | **可切换 LLM provider**（`LLM_PROVIDER=deepseek\|doubao`，默认 deepseek）：DeepSeek-Chat（`api.deepseek.com`）/ **Doubao-Seed-2.0-lite**（火山引擎 ARK，`ark.cn-beijing.volces.com`，VLM 可读图）。fission / director / workflow 三处都过统一 `_llm_endpoint()` helper。Doubao 不支持 `response_format: json_object`，靠 system prompt 强制 JSON + `_extract_json_text()` 去 markdown 围栏兜底 |
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
      dreamina_client.py    即梦 CLI subprocess 包装 — text2image/image2image/text2video/image2video 4 子命令 + 共享 _submit_poll_download
      cc123_video_client.py cc123.ai relay 视频生成客户端 — POST /v1/video/generations（model/orientation/size/prompt/duration/watermark JSON）+ /v1/videos/{id} 轮询 + /content 流式下载
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
                              run_video_via_dreamina (即梦 CLI 出 seedance2.0fast 视频，/replicate 专属)
                              run_video_via_cc123 (cc123.ai relay 出 sd-2/sora-2 视频，/replicate 专属)
      cleanup_tasks.py      celery beat 三个清理任务：
                              03:30 purge_old_logs (30 天 ApiCallLog 行)
                              04:00 purge_old_artifacts (3 天 task_groups + 文件 + 前端记录 + replicate workdir rmtree)
                              hourly :15 mark_zombie_running_failed (running/queued >2h 自动打 failed，刷新所属 group)
      dreamina_batch.py     run_dreamina_serial_batch — 裂变阶段 2 / 工具箱 dreamina/seedance 任务的串行批处理
                              （单账户并发上限，必须排队跑）；progress_callback 60s 节流推 WS
      _ws_sync.py           notify_ws_sync — sync Celery 调用内部 WS notify 端点的 httpx.Client 封装
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
    pages/fission/          FissionWorkspace（左 Sidebar + 右 DetailPanel） / CreateFissionModal（含自动下载 toggle）
                            / FissionDetailsModal（STEP 01 原始 / STEP 02 Doubao 洗稿双栏 diff / STEP 03 最终 prompt）/ DetailPanel（含 Seedance 实时日志条 + 自动下载 useEffect）
    pages/replicate/        ReplicatePage（壳）/ InputForm / AwaitingLLMOutput / GUList（双产线卡片+JSON 复制按钮）
    components/             Layout / Inbox / Gallery / Settings / Studio / TaskCreate / Toolbox / Utility
                            + ErrorBoundary（全局错误兜底，DashboardLayout 内包路由）
                            + FolderPickerBar（File System Access API 顶部条，scope=fission/automation/gallery）
    hooks/useAutoSaveFolder.js  统一文件夹 handle 管理 + saveFromUrl（fetch → getFileHandle({create:true}) → writable.write）
    utils/idb.js            IndexedDB store `api_flow_idb.folders` 持久化 directory handle
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
| **裂变（Fission）** | `/fission` | **新形态（video-first）**：上传产品图 + 完整提示词模板 + 视频引擎 → LLM (DeepSeek/Doubao) **洗稿** N 条变体（保留模板核心结构，只随机替换可变要素）→ 直接 i2v 出 N 个视频；老形态 (text_to_image 起点) 数据仍兼容显示 |
| **导演模式（Director）** | `/director` | 剧本 → DeepSeek 拆 N 个分镜 → 锚点帧 → 并行剩余帧 → 可选批量出视频 |
| **创意工坊（Workshop）** | `/workshop`、`/workshop/build`、`/workshop/run` | 用户自建多步工作流（模板 + 运行实例） |
| **工具箱（Toolbox）** | `/t2i`、`/i2i`、`/t2v`、`/i2v` | 一次性的 文生图 / 图生图 / 文生视频 / 图生视频；下拉按 HOLO / Flow2API / Dreamina（即梦）/ cc123 / Grok 多组分隔。所有模型走 `dispatcher.dispatch_generate` 统一路由 |
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
- **多 provider 按模型名分发，不再有"全局开关"**。`services/model_registry.py::resolve_provider(model)` 是路由权威（**case-insensitive** 比较，HOLO 模型名大小写不稳）：
  - `grok-` 前缀 → grok；含 `_ultra` 关键字 → flow2api；`gpt-images` / `gemini-3.` / `imagen-` / `veo_3_` / `sora-` 前缀 → holo；其他 → fallback (`AI_PROVIDER`)
  - **显式前缀消歧**（最高优先级，`EXPLICIT_PROVIDER_PREFIXES` 元组）：`flow2api/` / `holo/` / `grok/` / `cc123/` / `dreamina/` —— 用于消同名模型 + 接第三方/即梦。例如 `dreamina/seedance2.0fast` → dreamina；`cc123/sd-2` → cc123。`_generate_*` / `_run_*` 入口先 `strip_provider_prefix()` 再发上游
- **HOLO 改名警告**：HOLO 把老的 `GPT-Images 2.0`（带空格、点、零）改成 `GPT-images2 X:Y[-2K|-4K]` 系列（小写 i、无空格、按比例分变体，如 `GPT-images2 1:1`、`GPT-images2 9:16-4K`）。任何硬编码模型名都要查 HOLO `/v1/models`。Storyboard 9 宫格图默认走 `GPT-images2 1:1`（方形）。`model_registry.py` 走 lowercase 前缀比较所以兼容老名，但 HOLO 上游会拒老名。
- **dispatcher.py 是 worker 唯一入口**。`tasks.py` 和 `director_worker.py` 都调 `dispatch_generate(...)`，内部按 provider 分发到：
  - `ai_client.generate_with_retry` —— HOLO / Flow2API
  - `_run_grok` —— Grok2API（含自带重试 + 视频延展尾帧抽取）
  - `_run_cc123` —— cc123.ai relay（OpenAI Sora compat /v1/video/generations，sd-2/sora-2 模型）
  - `_run_dreamina` —— 即梦 Dreamina CLI subprocess，按 `dreamina/<sub-spec>` 二级前缀分发到 4 个 CLI 子命令：`t2i-X.Y` → text2image / `i2i-default` → image2image / `t2v-default` → text2video / `seedance2.0[fast][_vip]` → image2video。用 `asyncio.to_thread()` 把 subprocess 包成非阻塞
  - 也是写 ApiCallLog 的唯一埋点位置
- **凭据全部 .env 系统级**（内部使用，不暴露 UI）。所有 provider 配置：
  - `HOLO_API_URL/KEY` (`api.dealonhorizon.us`) + 老兼容字段 `AI_API_URL/KEY`
  - `FLOW2API_URL/KEY` (`https://followmeee.co`)
  - `GROK_API_URL/KEY` (`38.64.57.216:8001`)
  - `PACKYAPI_BASE_URL` (`https://www.packyapi.com`) + `PACKYAPI_GEMINI_KEY` —— 复刻视频 LLM 自动模式专用
  - `CC123_BASE_URL` (`https://cc123.ai`) + `CC123_API_KEY` —— 第三方视频生成（sd-2/sd-2-vip/sora-2）
  - **`DEEPSEEK_API_URL/KEY/MODEL`** + **`DOUBAO_API_URL/KEY/MODEL`**（火山 ARK）+ **`LLM_PROVIDER=deepseek\|doubao`** —— fission / director / workflow 用的提示词 LLM；切 provider 只改 .env 这一处
  - Dreamina 不需要 API key（OAuth Device Flow 扫码登录，token 在 docker volume `dreamina_token`）
  - `system_settings.veo_api_key/gemini_api_key` 是 dead column，不再读
- **模型名别名**：HOLO 不认 `*_ultra` / `*_ultra_relaxed` / `*_ultra_fl` 这些 Flow2API 时代命名。`ai_service.py::LEGACY_MODEL_ALIASES` 是兜底翻译表（旧名 → HOLO 实名，e.g. `_ultra_relaxed` → `lite`、`_ultra` → `fast`）。
- **HOLO 失败语义**：HOLO 自动退款 `failed`/`cancelled` 任务，`_generate_holo` 在 `result` 上挂 `_terminal=True` + `_refunded`，`generate_with_retry` 看到 `_terminal` 立即早退（不走 3 次重试，避免内容策略失败烧配额）。同时 `_holo_task_id` / `_cost` 也通过 result 回传给 dispatcher 写入日志。
- **HOLO Sora-2 必传 `size` 字段**：`Sora-2-12` / `Sora-2-16`（**严格大小写**，首字母大写 S；`normalize_holo_model` 不动 case）submit payload 必须显式带 `size: "1280x720"` 或 `"720x1280"`，否则上游 400 `size 必填`。`_generate_holo` 检测到 `model.lower().startswith("sora-")` 时自动注入：i2v 场景用 PIL 读 `image_paths[0]` 宽高决定横/竖；无图（纯 t2v）回落 720x1280 竖屏。其他比例（如 9:14、16:11）不支持，**只接受这两个固定值**。/i2v 工具箱下拉已挂 Sora-2-12 / Sora-2-16 两档。
- **LLM provider 切换通过 `_llm_endpoint()` helper**。`ai_service.py` 三个 helper：
  - `_llm_endpoint() -> (url, key, model)`：按 `settings.LLM_PROVIDER` 选 deepseek / doubao；**doubao key 空时自动回落 deepseek**，避免误操作切炸
  - `_llm_supports_json_format(model)`：doubao 系列 + deepseek-reasoner 都不支持 `response_format: {"type": "json_object"}`，payload 构造前判断要不要带这字段
  - `_extract_json_text(content)`：剥 LLM 输出周围的 markdown ```json``` 围栏，让 doubao 输出兼容现有 `json.loads()` 解析
  - **三处复用**：`generate_fission_prompts` / `generate_director_scene_prompts` / `workflow_worker.call_workflow_llm` 全部走 helper，加新 provider 只需扩 `_llm_endpoint` 一处
  - vision_keywords 加 `doubao` —— Doubao-Seed-2.0-lite 是 VLM，自动启用多模态 image_url + base64 协议（fission 一图一句话、director 产品图风格参考都能读图）
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
- **`docker compose restart` 不重读 `.env`**。`restart` 只重启进程不重建容器，env_file 改了不会生效。改 `.env` 后必须 `docker compose up -d <service>` 强制 recreate；用 `docker exec <container> printenv KEY` 验证 env 真的进容器了。曾经接 Doubao 时设了 DOUBAO_API_KEY 但用 restart 死活读不到，debug 半天就是这个坑。
- **frontend nginx 缓存 upstream DNS，backend 重启换 IP 必须连前端一起重启**。frontend 容器的 nginx `proxy_pass http://backend:8000/api/` 在**启动时**把 `backend` 解析成具体 IP（如 `172.18.0.3`）并写死，docker bridge 网络给 backend 重启时可能分新 IP（如 `172.18.0.6`）→ 前端往老 IP 打全 502 `connect() failed`。表现：用户点提交按钮**完全没反应**。修：`docker compose restart backend worker` 之后**一定要再 `docker restart followmeeeaigc_frontend`** 让 nginx 重新 DNS resolve；或者一次性 `docker compose up -d backend worker frontend` 让 compose 处理依赖。长期方案 nginx 加 `resolver 127.0.0.11 valid=5s;` + variable proxy_pass 可动态解析，但当前不动也行（注意运维 SOP）。
- **Celery worker 用 `--pool=threads` 不是 prefork**。HOLO/Flow2API 调用是纯 IO-bound（HTTP 等待），prefork 模式每个 worker 是独立 Python 进程，~80MB baseline，c=100 直接吃 8GB → OOM；threads 池 1 进程 + N 线程，c=100 仅 ~80MB 总占用。现状已切 threads + `MAX_CONCURRENT_TASKS=100`（远程 154.51.41.140 实测稳定）。
  - 配套：`backend/app/database.py` `create_engine(... pool_size=30, max_overflow=20, pool_pre_ping=True, pool_recycle=300)` — 默认 5+10 不够 100 threads 同时拉连接，会 QueuePool overflow
  - threads 池不支持 `--max-memory-per-child`，用 `--max-tasks-per-child=200` 替代（每 worker 处理 200 任务后自动回收）
  - threads 共享内存的 race 实战教训：曾经 `AIClient._http_pool` "per-loop 隔离" 在 prefork 模式下没事（每进程一个 loop），切 threads 后 100 个 loop 同时活互相 aclose 导致大面积失败；现状已改成 per-task client（见上一条）。`grok_client` 用 `async with`、scheduler `_redis_client` 是 per-loop 单例（每 loop 各自的，不共享同一对象）→ 安全。**未来加 module-level mutable state 必须考虑线程竞态**
- **速率锁按 provider 拆桶，HOLO 不再有本地锁**。`ai_service.py::generate()` 现状：
  - HOLO：跳过 `wait_for_api_slot`（HOLO `/v1/generate` 上游 85 generators 自管排队）
  - Flow2API：`wait_for_api_slot(api_type="flow2api", interval_base=5)` — 自托管易触验证码，5s 一个 slot 严格串行
  - Grok：`wait_for_api_slot(api_type="grok", interval_base=1)` — 在 `grok_client.py` 内调
  - 之前共享 `gemini_veo` slot + 10s 间隔，把 HOLO 锁成 1 task/10s（每小时上限 360）；现在 HOLO 真并发 = `MAX_CONCURRENT_TASKS`
- **服务器内存上限定 worker 并发**。生产 VPS（VMRack 洛杉矶 L3.VPS.4C4G.Plus，4 核 4GB 无 swap，IP `154.51.41.140`）threads pool c=100 实测 ~80MB worker 内存；prefork c=100 实测必然 OOM（8GB 需求）。**别动 prefork 的 concurrency 高于 20**，要更高用 threads。
  - **x-ui / xray 已停用**：之前同机器跑 VLESS 转发，但 2026-05-09 实测 inbound 滥用流量（138GB Yahoo Mail 出站 / xray fd 飙到 2400+ / SYN-SENT 1156）会把整个 sshd / docker accept queue 挤爆，导致 api-flow 也卡。已 `systemctl disable --now x-ui` 永久关闭，开机不再自启。`/etc/x-ui/x-ui.db` 完整保留，含 21 inbound + 多个高流量可疑 client（`zbstunbx`/`mtt4eyz3`/`0yben2ny` 等），如要恢复必须先 audit 删掉滥用 client 否则立刻又被 abuse 上游投诉。**这台 VPS 现在 api-flow 独占**。
  - **历史 IP 迁移**：旧 IP `154.53.75.37` 已废弃（2026-05-09 上午 VMRack 北美上游链路抖动期间换为 `154.51.41.140`，所有 docker volumes / dreamina_token / postgres_data 跟着新 IP 完整迁移）。SSH `~/.ssh/config` 里 `Host apiflow` 已切到新 IP。**任何对外分发的 URL（前端、API、Caddy 反代）都要用新 IP 或者域名 → A 记录，避免下次换 IP 全员重发**。
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
  - **GenerateVideoRequest 双路径**：按 `model_version` 前缀分发到不同 Celery 任务 —— `cc123/*` → `run_video_via_cc123`（cc123_video_client）；其他（`seedance2.0fast` 等裸名）→ `run_video_via_dreamina`（dreamina_client）。**都不走 dispatcher.dispatch_generate**（那是工具箱用的统一路由）。/replicate 顶栏选项 value 保持裸 seedance / cc123/ 两种形态共存
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
  - **dreamina_client 支持 4 个 CLI 子命令**：`text2image` / `image2image` / `text2video` / `image2video`，全部走共享的 `_submit_poll_download()` —— submit (`--poll=0` 不阻塞) → 轮 `query_result --submit_id` → success 后 `query_result --submit_id --download_dir` 下载产物。`download_kind` 参数决定找 `.mp4` 还是 `.png/.jpg/.jpeg/.webp`。模型名 `seedance2.0` / `seedance2.0fast` / `seedance2.0_vip` / `seedance2.0fast_vip`（无空格无连字符）。**1080p 仅 vip 支持**，`_run_dreamina` + `replicate.py` 服务端 guard 强制非 vip 模型降到 720p
  - **dispatcher.py::_run_dreamina** 是工具箱（/t2i /i2i /t2v /i2v）走 dreamina 的入口。按 `dreamina/<sub-spec>` 二级前缀分发：`t2i-5.0` → text2image / `i2i-default` → image2image / `t2v-default` → text2video / `seedance2.0...` → image2video。subprocess 用 `asyncio.to_thread()` 包装非阻塞。**对比 /replicate**：复刻视频走 `run_video_via_dreamina` Celery 专属任务（routers/replicate.py 直接派，不进 dispatcher）；两套并存不冲突 —— /replicate 顶栏选项用裸 `seedance2.0fast` (无前缀)，工具箱用 `dreamina/seedance2.0fast` (带前缀)
  - **队列等待是常态**：seedance2.0fast 高峰 queue_idx 200+，等 5-10 分钟很正常。dreamina_client 默认 `max_wait_sec=1800`（20 min）+ `poll_interval=15s` + 自动 log queue_idx 变化
  - 单次成本：4s 720p ≈ 8 credits、15s 720p 估算 ≈ 30 credits（Maestro VIP 账户 14k+ credits）。VIP 模型队列优先级更高，credits 消耗也更高
  - **错误信息排查**：dreamina submit 失败时 `submit_id=""` + `gen_status=fail` + `fail_reason=<具体原因>`。`dreamina_client` 会优先看 gen_status，把 fail_reason 直接报上去（不要被 "could not parse submit_id" 带歪 — 那只是没真错原因时的兜底信息）
- **cc123.ai relay 关键事实**：NewAPI fork relay，专门接 ByteDance Seedance 2.0 + OpenAI Sora 2。
  - 端点是 **`POST /v1/video/generations`**（OpenAI 兼容形态，JSON body：`{model, orientation, size, prompt, duration, watermark}`，**不是** `/v1/videos` multipart）。早期我错猜 `/v1/videos` + width/height/n 字段全错，实测后 commit 6dd198e/beb407c 修正
  - 实际模型名 `sd-2` / `sd-2-vip` / `sora-2`（不是 seedance2.0fast 这种 dreamina 命名）。从 `GET /v1/models` 查实际可用模型，避免硬编码
  - 轮询走 `GET /v1/videos/{task_id}` 返 `{status: queued/in_progress/completed/failed, progress, metadata.url}`；下载走 `GET /v1/videos/{task_id}/content` 流式 mp4（cc123 代理上游 img688.com）
  - **i2v 暂不支持**：当前 schema 文档没明示输入图字段，只走 t2v。如果以后开了 image 输入字段在 cc123_video_client 加
  - **错误模式**：余额不足 `code: insufficient_user_quota`（HTTP 403，含 `预扣费额度失败, 用户剩余额度: $X, 需要预扣费额度: $Y` 中文 message）；通道未配 `invalid_api_platform: <id>`。**预扣费机制** —— submit 时先冻结估算金额，跑完按实际多退少补
  - 单次成本（实测）：sd-2 portrait large 5s ≈ $1.4；sora-2 8s 估算 $7+。账户额度需在 cc123.ai 控制台充值
  - 前端错误格式化：`frontend/src/pages/replicate/GUList.jsx::formatTaskError` 识别 3 类典型上游错误（cc123 quota / dreamina 未登录 / 1080p 不兼容）+ 拆 title/detail/hint 三行展示，不再灌 raw HTTP 响应进 GU 红条
- **clipboard 兼容**：`frontend/src/utils/clipboard.js::copyToClipboard(text)` 双路径 —— 优先 `navigator.clipboard.writeText`（仅 HTTPS / localhost 可用），失败回退 `document.execCommand('copy')` + 隐藏 textarea。**因为生产是裸 HTTP** `http://154.51.41.140:8090/`，`navigator.clipboard` 整片不可用。所有"复制提示词 / 复制 JSON"按钮统一走这个 helper。
- **静态挂载 30 天 immutable 缓存**。`/outputs` 和 `/uploads` 路径走 `add_cache_headers` 中间件，文件名是 UUID 所以这样安全。
- **僵尸任务每小时自动清 + 按钮也清**。worker 崩溃/重启/网络断会留下 `status=running` 或 `queued` 永远不更新的"卡住"任务（UI 一直显示"生成中..."）。两层兜底：
  - `cleanup_tasks.py::mark_zombie_running_failed` celery beat 每小时 `:15` 跑，把 `status in (running, queued) AND updated_at < now - 2h` 的 task 全部打 `failed` + `error_message="worker 长时间无响应（>2h），系统自动标记失败。可点重试。"` + 用 `update_group_status()` 刷新所属 group 状态
  - `DELETE /api/tasks/failed/clear/all` 用户按钮**同时清 failed + 僵尸**（>2h running/queued），返回 `{failed: N, zombies: M, message}`。前端 `EndlessGallery.jsx::clearFailedTasks` 调用，自动清空组 cascade
  - 历史教训：2026-05-10 worker 因 `ImportError: stream_download_to_file` 持续崩溃留下 128 个 running zombie，用户看着卡片不动也清不掉；那次手工 SQL 批量打 failed 后才发现需要这两层兜底
- **EndlessGallery 高密度模式（≥10 列自动紧凑）**。`/t2i /i2i /t2v /i2v` 共用画廊组件，列数控制器从 `[3,4,5,6,7,8]` 扩到 `[4,6,8,10,12,14]`。`isCompact = columnCount >= 10` 推导值控制：
  - cell 圆角 `rounded-xl` → `rounded-md`、阴影 `shadow-md` → `shadow-sm`、hover 阴影 `_12px_40px` → `_4px_16px`
  - aspectRatio 压扁：9:16 → 9/14（高度 -12.5%）、16:9 → 16/11（-22%）；1:1 不变
  - 底部信息条 `p-2.5` → `p-1.5`、隐藏第二行模型名、prompt 字号 `text-[11px]` → `text-[10px]`、延展徽章 `text-[9px]` → `text-[8px]`
  - pending/failed 状态的 Sparkles/Clock(24px) 和 AlertTriangle(28px) 紧凑模式下分别压到 16/18px
  - 外层 padding + grid gap 三档动态：≥10 列 `p-2 + gap-1.5`；≥8 列 `p-3 + gap-2.5`；其它 `p-4 + gap-4`
  - **不动**：列数 state / `localStorage.endless_gallery_cols` 持久化逻辑 / 其它页面 / 后端。老用户存的 3/5/7 仍能渲染但下次点按钮就映射到新档
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
- **Toolbox 下拉的真正实现是 `Utility/ToolPanel.jsx`**（不是 `Toolbox/Toolbox.jsx`）。`/t2i /i2i /t2v /i2v` 全部走 ToolPanel 的硬编码 option 列表 + 多 provider optgroup 分组渲染（HOLO / HOLO·Sora 2 / Flow2API / Dreamina（即梦）/ cc123 / Grok）。改下拉**只改 ToolPanel.jsx**。
- **裂变 video-first 流（2026-05-11 重构）**。CreateFissionModal 提交的是 `task_type=image_to_video + source=FISSION + model=dreamina/seedance2.0fast` 等视频引擎 —— **跳过老的 stage-1 i2i**。router 拦截 `source==FISSION && task_type in (TEXT_TO_IMAGE, IMAGE_TO_VIDEO)` 两种走 `expand_fission_task_group`：
  - `is_video_first` 分支：Doubao 洗稿出的 prompt **不包 IMAGE_PROMPT_FINAL_TEMPLATE**，直接当 i2v prompt；N 个 task 都用同一张产品图为 input_files
  - 老 text_to_image 路径仍保留兼容（DB 里旧 group 仍能 i2i 跑通）
  - 后续派发：`model.startswith("dreamina/seedance")` → 投 `run_dreamina_serial_batch` 单 Celery 任务串行跑（不批量 delay）；否则并行 `process_generation.delay`
  - `LLM_SYSTEM_PROMPT`（`prompts.py`）已重写为**洗稿编辑**人设：保留模板核心结构（产品名/视觉风格/相机参数），只自动识别可变要素（具体时间/色温/光线方向/场景小物等）做随机替换，输出 N 条相似但变量不同的提示词；**禁止主动添加模板没有的场景/光线/景别**。FissionDetailsModal STEP 02 用 `diff` npm 包 + `diffWords` 渲染**双栏 PR-style 差异**（左 STEP01 原始红色删除线，右 STEP02 改后绿色高亮），让用户一眼看到 Doubao 改了哪些可变要素
  - DetailPanel 用 `isVideoFirstFission = rootGroup.task_type === 'image_to_video' && source === 'FISSION'` 检测；新形态**隐藏 stage-1 图像层**，把 rootGroup 直接当 videos 容器渲染；老形态保持 3 段（image / video / extend）
  - CreateFissionModal 顶部加 **"视频完成后自动下载到默认下载夹"checkbox**（持久化 `localStorage.fission_auto_download`）；DetailPanel useEffect 监听 success 视频，用 `<a download>` 触发浏览器原生下载（**裸 HTTP 也支持**，不需要 secure context）；`localStorage.fission_downloaded` 集合（cap 1000）防刷新重复触发
- **React Hooks 必须在 early return 之前 + 全局 ErrorBoundary**（2026-05-12 黑屏教训）。`pages/fission/DetailPanel.jsx` 曾把 `useEffect(...)` 放在 `if (!rootGroup) return` / `if (rootGroup.status === 'pending') return` 两个早返回之后 → 当 rootGroup.status 从 pending 翻 completed 时本次 render 比上次多调一个 hook → React 18 抛 "Rendered more hooks than during the previous render" → 整棵树 unmount → `/fission` 整页黑屏（连 sidebar/logo 都没）。**约定**：所有 hooks（useState/useEffect/useMemo/useRef/自定义 hook）必须在函数顶部、early return 之前声明完毕；派生数据用 null-safe 兜底让 effect 在数据未就绪时也能跑。新增 `components/ErrorBoundary.jsx`，`DashboardLayout.jsx` 用 `<ErrorBoundary key={pathname}>{renderContent()}</ErrorBoundary>` 包住每个路由 —— 单页 throw 不再连累整 app，错误卡片显示 message + componentStack + 重试按钮。
- **本地文件夹自动保存（File System Access API，HTTPS only）**。`hooks/useAutoSaveFolder.js` + `utils/idb.js` + `components/FolderPickerBar.jsx` 三件套，IndexedDB（store `api_flow_idb.folders`）持久化 directory handle。三处独立 scope：
  - `scope='fission'` → DetailPanel 顶部 sticky 条，监听 videos + extends_ 的 success → `saveFromUrl(/${output_file}, basename)`
  - `scope='automation'` → AutomationPage header 右侧，监听所有 task.runtime.thumbnails[status=success]
  - `scope='gallery'` → EndlessGallery header，监听 allCards filter(isVideo && success)
  - `savedToFolderRef`（useRef Set）防重复写；mount 时 `idbGetHandle(scope)` + `queryPermission('readwrite')==='granted'` 才自动启用，permission 是 'prompt' 时只显示文件夹名（标"需重新授权"），等用户手势再 requestPermission（API 限制：requestPermission 必须 user gesture 触发）
  - 老的 fission `<a download>` checkbox 路径作为 fallback 保留（裸 HTTP 时唯一可用方案）
- **Dreamina Seedance 串行 batch**（`workers/dreamina_batch.py`）。OAuth 单账户并行多任务会撞并发上限 + 失败一条整批前功尽弃，所以 router 检测到 group `model.startswith("dreamina/seedance")` 单次投 `run_dreamina_serial_batch.delay(group_id)`，内部 for-loop 逐条调 `dreamina_client.image2video`：
  - 每 60s 通过 `progress_callback` 节流回传 `{queue_idx, gen_status, fail_reason, elapsed_sec, submit_id}`；batch 把它翻译成进度文本写到 `task.progress_message` + `group.progress_message` + WS push（`TASK_PROGRESS` / `GROUP_PROGRESS`）
  - phase 判定**优先看 queue_idx**（实测 dreamina query_result 返 `gen_status="querying" + queue_info.queue_idx=2150`，要把 2150 这个排队位置秀出来；旧逻辑只在 `gen_status=="queuing"` 才显示位置，导致 querying 状态丢掉真实位置）
  - 完成后调 `extract_video_poster()` 写 `task.output_thumbnail`（**绕过 process_generation 主流程，必须手动调一次**，否则缩略图 NULL → 前端 `<video poster>` 回退 `#t=0.001` 不一定 work → 白底）
  - 失败时 `result.fail_reason` 直接落到 `task.error_message`，前端 GUList `formatTaskError` 识别"dreamina 未登录"等典型错误
- **dreamina poll 30min 用完不算失败 — `still_queuing` 续 poll**（2026-05-12 修 false-negative）。dreamina 队列深度可达 3000+，单任务排队 1-3h 是常态。老代码 poll 到 `max_wait_sec=1800` 硬切判 FAILED → 上游其实还在跑，UI 报"失败"是误判。新流程：
  - `dreamina_client.image2video / multimodal2video` poll 预算到点时返回 `DreaminaResult(success=False, gen_status="still_queuing", submit_id=sid, ...)` —— 不再是 `gen_status="timeout"` + FAILED 语义
  - `dreamina_batch` 见 `still_queuing` 不打 FAILED，task 保持 `RUNNING` + sid，clear `error_message`，发 `run_dreamina_serial_batch.apply_async(args=[gid, [tid]], countdown=60)` —— 60s 后自动重新进 batch 续 poll
  - group 状态机：still_running > 0 时 `group.status = PROCESSING` + progress "续 poll 中 N"，不再误标 COMPLETED
  - submit retry 拉长：`SUBMIT_MAX_TRIES 4→8`、`SUBMIT_RETRY_BACKOFF 30s→45s`，总扛 ~5min 账户级 ExceedConcurrencyLimit 抖动
- **dreamina_sid 必持久化 + sweeper 跳过**（2026-05-12）。worker 崩在首次 60s callback 前会让 sid 永久丢失（task.config_json={}），worker_ready 续 poll 无从下手，2h sweeper 一刀切 FAILED → 上游任务被孤立。新策略：
  - `dreamina_client` 新增 `sid_persist_callback: Optional[Callable[[str], None]]` 参数；`_extract_submit_id(out)` 拿到 sid 紧跟一行立即调 callback；`dreamina_batch::make_sid_persist(task)` 立刻 `task.config_json["dreamina_sid"] = sid; db.commit()`，不再等 60s 节流。窗口期归零
  - `cleanup_tasks.py::mark_zombie_running_failed` 在 Python 层过滤 `config_json.dreamina_sid` 存在的任务，返回新字段 `skipped_dreamina_sid`。有 sid 的 RUNNING task 交给 `dreamina_batch` 的 still_queuing 续 poll + `worker_ready` 信号兜底，sweeper 不管
- **同步 WS 推送 helper**（`workers/_ws_sync.py::notify_ws_sync`）。sync Celery 任务（dreamina_batch）无法用 async `notify_ws`，封一个 `httpx.Client` 同步版调 `/ws/internal/notify` 端点。**不要在 sync 上下文调原 async notify_ws**，会炸。
- **删除 Task 必须先解绑 ApiCallLog FK**。`ApiCallLog.task_id` / `group_id` 都是 `ForeignKey(... nullable=True)` 但**没设 `ondelete='SET NULL'`**（默认 RESTRICT）。直接 `db.delete(task)` 会 `psycopg2.errors.ForeignKeyViolation`。修：`routers/tasks.py::_unbind_api_call_logs(db, task_ids, group_ids)` 在 4 个删除端点（`delete_task_group` / `clear_failed_tasks` / `delete_single_task` / `batch_delete_tasks`）的 `db.delete` **之前**先 UPDATE SET NULL；cleanup_tasks 早就用了同款 pattern，router 之前漏。
- **`/api/logs/providers` Dreamina metrics 加 running_local**。dreamina CLI 不暴露账户级并发上限，但能算"本系统正在占用多少 dreamina 槽"——查 DB `Task.status=RUNNING` 且 model/model_version 属于 dreamina/seedance 的任务数。admin 看 /logs 顶部 Dreamina 卡片可见。
- **LLM provider 切换 helper**（`services/ai_service.py`）。三个 helper：
  - `_llm_endpoint() -> (url, key, model)`：按 `settings.LLM_PROVIDER`（deepseek/doubao）选；doubao key 空时自动回落 deepseek
  - `_llm_supports_json_format(model)`：Doubao 系列 + deepseek-reasoner 不支持 `response_format: json_object`，payload 构造前判断
  - `_extract_json_text(content)`：剥 LLM 输出周围的 markdown ```json``` 围栏
  - **三处复用**：`generate_fission_prompts` / `generate_director_scene_prompts` / `workflow_worker.call_workflow_llm`，加新 provider 只改 `_llm_endpoint`
  - `vision_keywords` 含 `doubao` → Doubao-Seed-2.0-lite 是 VLM 自动启用多模态 image_url + base64 协议
- **HOLO Sora-2 必传 size 字段**。`Sora-2-12` / `Sora-2-16`（严格大小写）submit payload 必须显式带 `size: "1280x720"` 或 `"720x1280"`，否则上游 400。`_generate_holo` 检测 `model.lower().startswith("sora-")` 时自动注入：i2v 场景用 PIL 读 image_paths[0] 宽高决定横/竖；纯 t2v 回落 720x1280 竖屏。其他比例（9:14 等）不支持。
- **cc123 sd-2 系列固定 15s**。`dispatcher._run_cc123` + `replicate_tasks.run_video_via_cc123` 都检测 `cc123_model.startswith("sd-2")` 强制 duration=15（其他时长 cc123 上游未开通通道，会报 model_not_found）。前端下拉文案对应改 `(Seedance 2.0 · 15s 标准)`。
- **僵尸任务每小时自动清 + 按钮也清**。worker 崩溃/重启/网络断会留下 `status=running` 或 `queued` 永远不更新的"卡住"任务（UI 一直显示"生成中..."）。两层兜底：
  - `cleanup_tasks.py::mark_zombie_running_failed` celery beat 每小时 `:15` 跑：`status in (running, queued) AND updated_at < now-2h` → 全部打 `failed` + `error_message` + `update_group_status` 刷新组状态。**例外**（2026-05-12 起）：带 `config_json.dreamina_sid` 的 RUNNING task **跳过**，交给 `dreamina_batch` still_queuing 续 poll + worker_ready 续命；返回值多 `skipped_dreamina_sid` 字段
  - `DELETE /api/tasks/failed/clear/all` 用户按钮**同时清 failed + 僵尸**（>2h running/queued），返回 `{failed: N, zombies: M, message}`；前端 EndlessGallery alert 弹具体数字反馈
- **EndlessGallery 多选浮条删除按钮**（`L1110`）已存在但不显眼。多选模式激活 + `selectedTasks.size > 0` 时底部浮动操作栏右侧出 `<Trash2/> 删除` 红按钮（handleBatchDelete 调 `POST /api/tasks/batch-delete`）。alert 反馈成功/失败具体错误（不再只 console.error）。
- **Caddy :80 反代 → frontend :8090**（2026-05-11 起）。`/etc/caddy/Caddyfile` 配 `:80 { reverse_proxy localhost:8090 { header_up ... } }`，让 `http://154.51.41.140/`（裸 IP，无端口）直接进入 frontend。WebSocket 升级 Caddy v2 reverse_proxy 自动处理。**两路径都可用**：`http://154.51.41.140/`（经 Caddy 反代）和 `http://154.51.41.140:8090/`（端口直连）。Caddyfile 备份 `Caddyfile.bak.20260511`。后续接域名 + HTTPS 只需把 Caddyfile 顶部 `:80` 改成 `your-domain.com`，Caddy 自动 Let's Encrypt。
- **python `"..."` 字符串内嵌引号必须转义或换字符**。`prompts.py` 改 LLM_SYSTEM_PROMPT 时直接写 `"傍晚硬光"`（中文上下文里 ASCII 双引号）→ Python 解析器把字符串截断 → SyntaxError → uvicorn 启动失败但容器仍 Up。**症状**：所有 /api 请求 502，frontend 静态资源 200。后端 docker logs 才能看到 stack trace。**对策**：嵌套引号用 `『日式书名号』`，或单引号外壳 `'...'`，或 `\"...\"` 转义。
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

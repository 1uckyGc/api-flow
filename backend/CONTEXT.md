# 后端 CONTEXT

FastAPI + Celery 服务的领域术语表。**任何在前端 CONTEXT 里也出现的术语，以这份为准**。

## 术语表

### 任务模型

- **TaskGroup（任务组）** — 用户视角的"一个任务"，每点一次创建弹窗 = 一个 TaskGroup。承载全局提示词、来源、状态、总量/完成/失败计数器、`config_json`。定义在 `models/task.py`。
- **Task（子任务）** — 任务组里的单个生成单元。有自己的 prompt、输入文件、产出文件、重试计数、状态。在 group 创建时**预先**以 `QUEUED` 状态写入，让前端立刻渲染骨架卡片。
- **TaskType（任务类型）** — `text_to_image` / `image_to_image` / `text_to_video` / `image_to_video`，描述**操作类型**，不是触发模式。
- **TaskSource（任务来源）** — 任务**从哪里发起**。8 种取值：`TOOLBOX`、`GALLERY`、`PIPELINE`、`GALLERY_EXTEND`、`FISSION`、`DIRECTOR`、`DIRECTOR_VIDEO`、`STORYBOARD_FISSION`。统一叫"来源（source）"，不要用"种类"或"出处"。
- **GroupStatus（组状态）** — `pending` → `processing` →（`needs_review` →）`processing` → `completed` / `failed`。`needs_review` 仅出现在导演模式（见下文"导演流水线"）。
- **TaskStatus（子任务状态）** — `queued` → `running` → `success` / `failed` / `retry`。

### 血缘 / 关联

- **Fission 血缘（裂变血缘）** — 当裂变流程衍生新组（图→视频、视频→延展），新组的 `fission_parent_id` 指向源头，`fission_stage` ∈ `{"images", "videos", "extended"}`。**裂变流里所有 group-to-group 的父子关系都用这套词**，不要自创。
- **Workflow 关联** — `task_groups.workflow_run_id` 与 `workflow_step_index` 把 group 反向关联到工坊里某个步骤。引用工作流位置时统一叫"step（步骤）"，不要用"node（节点）"或"stage（阶段）"——`node` 是前端构建器的术语。

### 模式

- **裂变（Fission）** — 输入：一张产品图 + 一句模糊全局提示词；DeepSeek 扩写成 N 条差异化的渲染指令；Gemini 并发渲染 N 张。可选后续：图生视频、视频延展。
- **导演模式（Director）** — 输入：产品图 + 剧本；DeepSeek 拆成 N 个分镜；先**串行**生成锚点帧（第 0 帧），其余帧拿锚点当参考并行渲染。
- **创意工坊（Workshop）** — 用户自定义多步流水线。**Workflow** 是模板；**WorkflowRun** 是一次执行。步骤类型：`llm_expand` / `llm_transform` / `t2i` / `i2i` / `t2v` / `i2v` / `extend` / `review` / 静态 `input`。
- **工具箱（Toolbox）** — 一次性的 t2i / i2i / t2v / i2v，无扩写、无编排。

### 导演流水线（专用术语）

- **锚点帧（Anchor frame / 锚点基准图）** — 导演故事板的第一帧。**串行**先生成。文件路径写在 `task_groups.config_json["anchor_file"]`。后续所有帧都把它当作参考图，用来锁人物 / 场景一致性。
- **分镜（Scenes，`director_scenes`）** — LLM 解析出来的字典列表，结构 `{index, shot_type, action, description, title}`。存在 `config_json["director_scenes"]`。**解析后必须按 `index` 显式排序** —— `director_worker.py` 里有注释说明 created_at 撞车的原因。
- **复核闸（Review gate）** — 在分镜解析（Phase 1）和锚点生成（Phase 2）之间。group 状态翻成 `needs_review`，worker 退出，前端打开分镜编辑器。用户改完调 `POST /api/director/confirm-scenes`，状态翻回 `processing`，worker 重新被召唤。**这是产品特性，不是 quirk**，不要把它合并进单阶段。

### AI 网关

- **Flow2API** — FollowmeeeAIGC 调用图像（Gemini）和视频（Veo）的 OpenAI 兼容上游。所有请求走 SSE 流式 `/v1/chat/completions`。`services/ai_service.py::AIClient` 是**唯一**与之对话的对象。
- **DeepSeek** — 提示词扩写（裂变）和剧本拆分（导演）用的 LLM。系统级配置：`DEEPSEEK_API_KEY` / `DEEPSEEK_API_URL` / `DEEPSEEK_MODEL`。请求带 `response_format: json_object`。
- **视觉模型识别** — `is_vision_model = any(k in DEEPSEEK_MODEL.lower() for k in ["vision","vl","gemini","gpt-4o","claude"])`。决定图片附件用多模态 `image_url` 协议还是直接丢掉。
- **生成结果** — `GenerationResult` 是内存结构：`{success, media_type, data: bytes, mime_type, error, file_ext}`。`data` 从 SSE 响应的三处之一解出：markdown 图像语法里的 base64 data-URL、文本中的可下载 URL、原始流内容。**文件类型靠 magic bytes 嗅探，不用 Content-Type**。
- **Loop-bound httpx 连接池** — `AIClient._http_pool` 在当前 asyncio loop ID 与池绑定的 loop ID 不一致时**自动重建**。这是"Celery worker 在多次执行间复用 AIClient"问题的标准解。**别把池子提到模块作用域**。

### 限流与重试

- **API slot** — `utils/scheduler.py::wait_for_api_slot(api_type)` 是所有上游 AI 调用的**单一瓶颈点**。`api_type` 参数把并发配额分组，目前只有 `"gemini_veo"` 一种。新接上游时，新增 type 即可。
- **重试分两层** — `generate_with_retry` 做**生成层**重试，指数退避（`2^attempt`）。`generate` 内部的**下载阶段**有自己独立的 3 次重试（针对 `RemoteProtocolError / ReadError / ConnectError`）。**别混为一谈**。
- **用户 key vs 系统 key** — Gemini / Veo key 是按用户存的（在 `system_settings` 表）；DeepSeek key 是系统级的（在 `.env`）。`_get_user_api_key(db, user_id, model)` 按模型名关键字判断要哪一把。

### 提示词分类（`prompts.py`）

这个文件是**所有系统提示词的唯一归宿**，不要在别处内联 prompt 字符串。

- **`LLM_SYSTEM_PROMPT` / `LLM_USER_PROMPT_*`** — 裂变扩写（DeepSeek 角色：创意先锋 / 提示词架构师）。
- **`DIRECTOR_LLM_SYSTEM_PROMPT`** — 剧本→分镜解析。
- **`DIRECTOR_ANCHOR_VISION_PROMPT`** — 拿产品图渲染锚点帧时用。
- **`DIRECTOR_LOOP_ANCHOR_PROMPT` / `DIRECTOR_LOOP_PRODUCT_PROMPT`** — 渲染非锚点帧时用，会拼到该帧的分镜描述前。
- **`IMAGE_PROMPT_FINAL_TEMPLATE` / `IMAGE_PROMPT_BASE_INSTRUCTION` / `DEFAULT_SYSTEM_CONSTRAINT`** — 裂变渲染的"绝对不许改产品"系统级约束，每条变体提示词都会前置这套。
- **`LLM_REASONER_FORMAT_PROMPT`** — JSON 解析失败时的回退指令，强制对方按合法 JSON 返回。

### 实时

- **`notify_ws(user_id, payload)`** — 推消息到前端的**唯一通道**。两种 payload：`{"type": "TASK_UPDATE"}` 表示"列表变了，重拉"；`{"type": "GROUP_PROGRESS", "group_id", "message"}` 表示更新某 group 的实时状态条文案。
- **`progress_message`** — group 处理中显示在状态条上的中文文案。导演 worker 里通过 `push_progress(msg)` 写；其他 worker 直接给 `TaskGroup.progress_message` 赋值。

## 编码约定

- **`config_json` 优先，新增列其次。** 加新模式元数据时，扩 `task_groups.config_json` 或 `tasks.config_json`（都是 SQLAlchemy `JSON` 类型）。**只在需要 SQL 查询或建索引时才加列**。
- **错误信息双语。** 用户可见的异常用中文抛；日志用英文打。例：`raise RuntimeError("DeepSeek 引擎响应超时")` 配合 `logger.error("DeepSeek timeout")`。
- **Worker 入口同步，内部全异步。** Celery task → `asyncio.run(execute_*_session(...))` → 全异步函数体。**不要把同步数据库调用混进异步路径**；并行分支里各自 `SessionLocal()` 一份，`finally` 关掉。
- **优先 magic bytes，少信 Content-Type。** 上游偶尔会贴错标签；信文件头（`\x89PNG`、`\xff\xd8`、`RIFF...WEBP`、mp4 的 `ftyp`）。
- **启动时建表两遍。** `main.py` 同时调 `Base.metadata.create_all()` 和 `alembic upgrade head`。新加列必须**同时**改模型 + 写迁移，否则本地新库和生产会悄悄不一致。

## 看着像 bug 实则不是

- **`alembic/versions/` 里有三份 `add_director_storyboard_sources`。** 两份是历史冲突遗留的死分支，只有一份在主链上。改之前先 `alembic history` 查一下。
- **`CELERY_TASK_ALWAYS_EAGER` 默认是 `True`。** 看着吓人，但 `docker-compose.yml` 把它强制覆盖成 `False`（backend 和 worker 都覆盖）。这个默认值是为了无 Redis 的本地裸跑能用。
- **`scenes.sort(key=lambda x: (x.get("index") or 0, x.created_at, x.id))`。** 看着是过度排序，其实不是：同事务批量插入会撞 `created_at`，LLM 也未必按顺序返回 `index`。

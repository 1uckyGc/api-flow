# 前端 CONTEXT

React + Vite SPA 的领域术语表。**两边都出现的术语，以 `backend/CONTEXT.md` 为准** —— 这份只描述 UI 怎么呈现这些概念。

## 术语表

### 工作区布局

- **DashboardLayout** — 除 `/login` 外所有路由共享的外壳。它按 `pathname` 自己路由到 FissionWorkspace / DirectorPage / WorkshopPage / WorkflowBuilder / WorkflowRunner / UtilityLayout（工具箱兜底）。位置 `components/Layout/DashboardLayout.jsx`。
- **GlobalNav** — 左侧竖直图标导航。**顺序固定**：裂变 / 导演模式 / 创意工坊 / 分隔 / 文生图 / 图生图 / 文生视频 / 图生视频 / 分隔 / 资产库。**没产品同意不要重排** —— 用户已经形成肌肉记忆。
- **Workspace（工作区）** — 一个顶层模式。每个 workspace 有自己的 `pages/<mode>/` 目录。当前三个：`pages/fission` / `pages/director` / `pages/workshop`。
- **UtilityLayout** — 四个工具箱模式（`/t2i`、`/i2i`、`/t2v`、`/i2v`）共用的外壳。一份布局，靠路由参数化。

### Store（Zustand）

`src/stores/` 下五个顶层 store。每个 store 拥有一片状态切片，**跨 store 耦合走 action，不直接读对方 state**。

- **`useAuthStore`** — JWT token、当前用户、登录登出。持久化到 localStorage。`apiClient` 的每个出站请求都从这里读 `token`；遇 401 自动 `logout()` + `replace('/login')`。
- **`useTaskStore`** — 任务组列表、`activeGroupId`、WebSocket 句柄、`taskProgressMap`、筛选/搜索状态、二次编辑用的 `draftData`。**Inbox 的唯一数据源**。
- **`useSettingsStore`** — 设置弹窗开关 + 用户配置（Gemini key、Veo key、DeepSeek 模型、视频裁尾帧数）。
- **`useThemeStore`** — `theme` ∈ `{"dark", "light"}`，持久化。靠右上角太阳/月亮按钮切换。
- **`useWorkshopStore`** — 工坊编辑器状态：节点列表、选中节点 id、流水线元信息（标题、描述）。**与 `useTaskStore` 各管一边** —— 即使工作流跑出来的结果是 task group，**run 的状态走 `useTaskStore`，build 阶段才用这个**。

`hooks/` 下还有一个全局 hook：

- **`useProvider`** — 启动时一次性 fetch `/api/config/ai-provider` 拿当前 AI 协议（`"holo"` 或 `"flow2api"`），用 zustand 缓存。所有视频模型下拉用它决定显示哪一套。fetch 在 `loaded` 标记触发后只跑一次（多个组件并发调用会复用同一个 `inFlight` Promise）。

### 实时契约

- **WebSocket** — 每用户一条连接，由 `useTaskStore` 在登录后开。token 走路径段：`/ws/{token}`。
- **消息类型** —— 当前只有两种：
  - `{type: "TASK_UPDATE"}` → 重拉任务组列表。
  - `{type: "GROUP_PROGRESS", group_id, message}` → 把 `message` 写进 `taskProgressMap[group_id]`，驱动状态条文案。
- **去抖** — `_wsDebounceTimer` 把 `TASK_UPDATE` 的爆发期合并掉。**没量过别拿掉** —— 导演并行帧阶段会狂打。

### Inbox 与详情

- **Inbox** — 右侧任务组列表（`components/Inbox/Inbox.jsx`）。一个 `TaskGroup` 一行。筛选项：`all / review / running / done / failed`。
- **TaskItem** — Inbox 单行。有 `progress_message` 时显示文案，否则回退到状态。
- **DetailPanel**（裂变）/ **StoryboardResultGrid**（导演）— 选中 group 后的中央画面。把子任务渲染成图/视频卡片。
- **`review` 筛选项** — 专门给 `GroupStatus === "needs_review"` 用，目前**只有导演模式会进这个状态**。

### 各模式 UI

- **裂变（Fission）**：`Sidebar`（左侧裂变组列表）+ `DetailPanel`（中央网格）+ `CreateFissionModal`（新建）+ `FissionDetailsModal`（全屏预览）。
- **导演模式（Director）**：`DirectorPage`（根）+ `DirectorCreateModal`（新建）+ `DirectorInputPanel`（配置）+ `DirectorScenesEditor`（**复核闸**的 UI）+ `StoryboardResultGrid`（9:16 竖卡片堆叠）+ `VideoMotionModal`（一键 i2v）。
- **创意工坊（Workshop）**：`WorkshopPage`（模板列表）+ `WorkflowBuilder`（拖拽节点编辑器）+ `WorkflowRunner`（运行实例视图）。
- **工具箱（Toolbox）**：`ToolPanel`（左侧输入）+ `EndlessGallery`（右侧瀑布流）+ `TaskSidebar`（右侧详情）。**四种工具箱模式共用同一套组件**。

### 资产库

- **Gallery / `GalleryView`** — `/assets`，瀑布流展示所有模式的成功产出。点击打开 `InspectorPanel`（右侧抽屉，元数据 + 操作按钮）。

### 配置载体

- **`config_json`（前端使用）** — 创建裂变 / 导演 / 工作流组时，前端把按模式区分的字段塞进请求的 `config_json`。**字段定义权在后端**（见 `backend/CONTEXT.md`），新加键之前**必须先在某个 worker 里加读取逻辑**。
- **`constants/models.js`** — 视频模型目录单一来源。结构 `VIDEO_MODELS[provider][kind][orientation] -> [{value, label}]`，覆盖 `flow2api` 与 `holo` 两套命名空间；`DEFAULT_MODELS[provider][context]` 给各场景（`director_video` / `fission_video` / `toolbox_t2v_portrait` 等）兜底默认值；`mapModelForFlow2API(alias, aspectRatio)` 把 Flow2API 短别名（`veo_t2v_ultra_relaxed`...）拼成最终 API 模型名（`veo_3_1_t2v_fast_portrait_ultra_relaxed`...），HOLO 分支的 dropdown value 已经是 API 实名，不走这个函数。**所有视频模型选项的真相在这里**，单点修改、多处生效。

### 主题

- **走 CSS 变量，不走 Tailwind 主题 token**。看 JSX 里的 `var(--surface-N)` / `var(--text-primary)` 这类。主题切换是给 `<html>` 切 class，变量从那里解析。布局类的 Tailwind utility（`flex`、`gap`、`rounded-lg` 等）该用照用。

## 编码约定

- **API 根路径是 `/api`** —— **永远不要硬编码 `http://localhost:8000`**。`axios` 已经配 `baseURL: '/api'`，dev 期 Vite 反代，prod 期 Nginx 反代。
- **axios 单实例**。统一从 `api/client.js` 引；**不要在组件里 `import axios from 'axios'`**，会绕过鉴权拦截器。
- **鉴权门挡在路由层**。`App.jsx` 的 `ProtectedRoute` 没 token 就跳 `/login`。**不要在组件里散落 token 检查**。
- **UI 用中文标签，代码用英文标识符**。导航项写法是 `{ path: '/director', label: '导演模式' }` —— 不要反过来。
- **模式名称对齐后端 `TaskSource`**（仅大小写差异）：后端 `FISSION` ↔ 路由 `/fission` ↔ store key `fission`。

## 看着像 bug 实则不是

- **`useTaskStore` 把 `wsConnection` 放在 store state 里**。看着不纯，故意的 —— 连接是绑在登录生命周期上的单例，登录登出本来就在这个 store 里。
- **`DashboardLayout` 每次 URL 变化都重渲染但不卸载 workspace**。它用 `pathname` switch 而不是嵌套 `<Routes>`，**故意为之** —— 模式切换时保留 Inbox 与 GlobalNav 状态，避免重连 WS。

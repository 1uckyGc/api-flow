# 上下文索引（CONTEXT MAP）

本仓库分两个上下文。开始探索代码前，按当前话题读对应的那份。

| 上下文 | 路径 | 负责的范围 |
|---|---|---|
| **后端** | `backend/CONTEXT.md` | 领域模型、任务生命周期、AI 网关协议、worker 流水线、提示词分类 |
| **前端** | `frontend/CONTEXT.md` | 各模式 workspace、store 边界、实时 / WS 契约、画廊模型 |

## 跨上下文契约

有些术语两边都用 —— 这些**一律以后端定义为准**，前端的条目只描述 UI 怎么呈现：

- **TaskGroup / Task** — 关系结构、状态枚举、8 种 `TaskSource` 取值
- **WebSocket 消息封装** — `{type: "TASK_UPDATE" | "GROUP_PROGRESS", ...}`，由后端 `notify_ws` 推、由 `useTaskStore` 收
- **模式名称** — *裂变（Fission）*、*导演模式（Director）*、*创意工坊（Workshop）*、*工具箱（Toolbox）*；中文是 UI 显示名，英文是代码标识符
- **`config_json` 扩展字段** — 后端定义键，前端读写
- **API 根路径** — `/api`（开发期 Vite 反代，生产期 Nginx）

## ADR

系统级架构决策落在 `docs/adr/`；上下文级决策落在 `backend/docs/adr/` 与 `frontend/docs/adr/`。两个目录都由 `/grill-with-docs` 在决策真正成型时**惰性创建** —— 新克隆下来时不存在是正常的。

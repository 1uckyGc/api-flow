# 领域文档

工程类 skill 在探索本仓库代码前，**应该按这套约定**消费领域文档。

## 探索之前先读

- 根目录的 **`CONTEXT-MAP.md`** —— 它会指向各上下文的 `CONTEXT.md`，读你正在处理话题对应的那一份。
- **`docs/adr/`** —— 系统级架构决策。
- **各上下文的 ADR** —— 在 `backend/` 内动手前也看下 `backend/docs/adr/`；在 `frontend/` 内动手前也看下 `frontend/docs/adr/`。

如果上述文件**不存在**，**静默继续即可** —— 不要主动提示缺失，不要建议"先创建一份"。`/grill-with-docs` 这类生产端 skill 会在术语或决策真正成型时**惰性创建**它们。

## 文件结构

本仓库是**多上下文**布局。顶层结构如下：

```
/
├── CONTEXT-MAP.md                ← 索引文件，指向各上下文的 CONTEXT.md
├── docs/adr/                     ← 系统级决策（跨上下文，比如 AI 网关选型）
├── backend/
│   ├── CONTEXT.md                ← 后端领域语言（任务、工作流、AI 服务）
│   └── docs/adr/                 ← 后端专属决策
└── frontend/
    ├── CONTEXT.md                ← 前端领域语言（workspace、store、各模式）
    └── docs/adr/                 ← 前端专属决策
```

两个上下文：

- **backend** —— FastAPI + Celery + PostgreSQL。术语包括 task group、裂变、导演模式、workflow run、AI 网关客户端等。
- **frontend** —— React + Vite + Zustand。术语包括 workspace（裂变 / 导演 / 工坊）、store、画廊、工具箱等。

## 一切产出都用术语表里的词

当 skill 的产出涉及一个领域概念时（issue 标题、重构方案、bug 假设、测试名称），**统一使用对应 `CONTEXT.md` 里给出的术语**。不要漂移到术语表明确避免的同义词上。

如果你需要的概念**还不在术语表里**，这本身就是一个信号 —— 要么你在用项目不使用的语言（重新想想），要么是真正的概念缺口（记下来交给 `/grill-with-docs`）。

## 与现有 ADR 冲突时显式标注

如果你的产出和某个已有 ADR 矛盾，**显式说出来**，不要静默覆盖：

> _与 ADR-0007（导演锚点优先流水线）冲突 —— 但值得重新讨论，原因是……_

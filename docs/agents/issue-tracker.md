# Issue Tracker：本地 Markdown

本仓库的 issue 与 PRD 都以 markdown 文件形式存在 `.scratch/` 目录下。

## 约定

- **一个特性一个目录**：`.scratch/<feature-slug>/`
- **PRD 文件**：`.scratch/<feature-slug>/PRD.md`
- **实现 issue**：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，编号从 `01` 起
- **Triage 状态**记录在每个 issue 文件顶部的 `Status:` 行（具体取值见 `triage-labels.md`）
- **评论与对话历史**追加到文件底部，统一在 `## Comments` 标题下

## 当某个 skill 说 "publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下新建文件（必要时一并创建目录）。

## 当某个 skill 说 "fetch the relevant ticket"

读取被引用路径的文件。用户通常会直接给路径或 issue 编号。

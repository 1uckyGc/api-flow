# Triage 标签

各 skill 用五个固定的 triage 角色描述 issue 的处理状态。本文件把这五个角色映射到本仓库实际使用的标签字符串。

> **注意**：右侧"本仓库标签"列的字符串**保留英文原样** —— skill 的代码会按字面值查找，改成中文会让 skill 找不到。本文档的中文部分只是给人读的说明。

| Skill 中的标签（mattpocock/skills） | 本仓库标签 | 含义 |
| ------------------------------ | ---------- | ---- |
| `needs-triage`                 | `needs-triage`    | 维护者需要评估 |
| `needs-info`                   | `needs-info`      | 等待 reporter 补充信息 |
| `ready-for-agent`              | `ready-for-agent` | 已充分定义，AFK agent 可直接接手 |
| `ready-for-human`              | `ready-for-human` | 需要人工实现 |
| `wontfix`                      | `wontfix`         | 不会处理 |

当某个 skill 提到一个角色（例如"打上 AFK-ready 的 triage 标签"），就用这张表里对应的标签字符串。

在**本地 markdown 模式**下，标签字符串写在每个 issue 文件顶部的 `Status:` 行，路径在 `.scratch/<feature-slug>/issues/` 下。

要替换成你团队真正在用的标签词汇，**只改右侧那列**即可。

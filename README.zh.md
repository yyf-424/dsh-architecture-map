# Architecture map · 架构地图

[English](README.md) | 中文

**DeepSeek Harness 的架构工作台：可交互的语义架构图、按节点开启的侧栏子对话、增量架构记忆。**

> 状态：**pre-alpha，可工作的骨架**。Host 工具、右侧栏画布、节点位置本地记忆、架构记忆、按节点子对话、确定性导出和内置 Mermaid 渲染都已可用；共享位置和发布打磨是下一步。设计文档保存在本地，不纳入版本跟踪。

---

## 为什么

agent 已经能读仓库、画图，但那张图是死的：

- 不能点节点追问；
- 每次重新生成，命名和布局都会漂移，上次的「N3」找不到了；
- 讨论一个模块，要么污染主对话，要么开新会话把上下文全丢掉；
- 下一个会话又把代码从头读一遍，什么都没有沉淀。

Architecture map 把「项目架构」变成 harness 里**可寻址的一等对象**：

- agent 建**语义图**（稳定 id、代码锚点、状态）；
- 用户在右侧栏的交互画布上看图；
- 每个节点可以开一个**隔离的侧栏子对话**，继承主对话的记忆；
- 子对话的修改合并回唯一的图；
- **架构档案**让后续分析只处理变更文件。

## 界面示意

```
┌──────────────── 主对话 ───────────────────────────┬──────── 右侧栏 ──────────────┐
│  你：画一下这个项目的架构图                        │  [架构图]  [n3 · 讨论]   [+]  │
│  agent：14 个节点、19 条边，看右侧                 │   ┌────┐      ┌────┐         │
│                                                   │   │ n1 │─────▶│ n3 │         │
│  （你讨论时，主对话保持干净）                      │   └────┘      └────┘         │
│                                                   │  n3 · Session Store          │
│                                                   │  摘要 / 锚点 / 上下游          │
│                                                   │  [轻讨论] [深讨论]            │
└───────────────────────────────────────────────────┴──────────────────────────────┘
```

## 已实现

- **Canonical 架构图**：`.archmap/graph.json`，带 rev、schema 校验、原子写入和单步备份。模型通过 `arch_graph_get` / `arch_graph_patch` 读写；`apply:false` 只预览不写入。
- **右侧栏画布**：从当前会话 workspace 读取图，SVG 渲染节点/边，支持平移、滚轮缩放、`Fit`、节点拖拽、`Reset layout`，点击节点看详情。
- **位置本地记忆**：拖动的节点位置按 workspace 存在浏览器本地，刷新或同机新会话会保留；`Reset layout` 清掉。共享位置是后续计划。
- **增量架构记忆 + 格式改动识别**：`.archmap/manifest.json` 记录 hash 和归一化代码签名；`arch_sync` 只报告新增/修改/删除文件，区分代码改动和仅格式/注释改动，并列出受影响节点；`markStale:true` 会把这些节点标成 stale 并递增 graph rev，默认只报告不写图；`arch_manifest_commit` 记录已分析文件；`arch_doc_get` / `arch_doc_put` 读写 `overview`、`modules/<id>`、`notes/<id>`。
- **确定性导出**：`arch_export` 把 Mermaid flowchart、独立 SVG 或 Markdown 档案摘要写到 `.archmap/export/`；不改变 graph rev，也不改源文件。
- **内置 Mermaid 渲染**：assistant 消息里的 ` ```mermaid ` 块用 vendored Mermaid 12.2.0 渲染，runtime 由本插件 Host 路由提供，不依赖 CDN，也不依赖 `dsh-mermaid-plus`。流式时保留代码块，语法错误回退代码块 + 错误行；`renderMermaid:false` 可关闭。
- **按节点子对话**：`arch_discuss` 为 `node:<id>` 或 `edge:<id>` 开子会话；`fork` 继承主对话已完成轮次，`lite` 只靠图和档案。结果只走 caller，不污染主对话；结论写进 `notes/<id>`。节点详情里还有 `Discuss (fork)` / `Lite` 按钮，通过 `subagentchat` resource 在右侧栏打开子会话。

## 下一步计划

- 内置 Mermaid 渲染，聊天里的 ` ```mermaid ` 代码块不再依赖其他插件。
- 位置共享/写回图数据、右侧栏导出按钮、发布打磨（CI、打包、GIF）。

## 不是什么

- 不是通用白板（Excalidraw 型）：没有自由像素，每个元素都可寻址。
- 不是通用记忆插件：档案是为了完善这张架构图，不是保存所有对话记忆。
- 不只是画图工具：图、讨论、合并、记忆是一个闭环。

## 依赖

除 DSH 本身外，没有运行时插件依赖：

| 功能 | 需要额外插件? |
|---|---|
| 画布、图存储、位置本地记忆 | 不需要——本 bundle 已实现 |
| 架构记忆（`arch_sync` + dossier） | 不需要——本插件管理的 workspace 文件 |
| Mermaid 渲染 | 不需要——Mermaid 12.2.0 已 vendored 并由本机路由提供；`renderMermaid:false` 可关闭 |
| 侧栏子对话 | 不需要——`arch_discuss` + 右侧栏 `Discuss` 按钮 |
| Stale 检测 | 不需要——`arch_sync` 的 `markStale:true` |
| 导出（Mermaid/SVG/Markdown） | 不需要——`arch_export` |
| 更准的调用/影响边 | 可选：`dsh-plugin-codegraph`（推荐，**不默认安装**） |

## 记忆是怎么做的（不需要其他插件）

Architecture map 在 workspace 里维护一份**架构专用档案**，由插件自己管理：

```
.archmap/
├── graph.json        # canonical 图 + rev
├── manifest.json     # 已分析文件的 path -> sha256
├── overview.md       # 1 页总览
├── modules/<id>.md   # 每模块档案
└── notes/<node>.md   # 每节点讨论结论
```

- 首次分析读一遍仓库，写出档案 + 图。
- 之后 `arch_sync` 对 workspace 做 hash 对比，只返回新增/修改/删除的文件和受影响节点；agent 只读这些文件，更新档案，再用 `arch_manifest_commit` 提交。
- 对话记忆是另一层：`fork` 子对话通过 DSH 原生 fork 继承主对话已完成轮次；`lite` 只拿档案摘要。
- 这**不是**通用记忆系统，也**不依赖** `dsh-project-brain`、`dsh-living-memory`、`dsh-memex`；卸掉它们照样工作。

## 可选增强（推荐）

- [dsh-plugin-codegraph](https://github.com/CC19990113/dsh-plugin-codegraph)：tree-sitter 代码智能（符号、调用、影响面）。想让连线更准可以装；**不装也能用**。上游报告 337 文件仓库首次索引约 1s、增量约 45ms，建好之后结构查询很便宜；但它是 type-free 解析，动态派发和成员调用可能解析不到，仍要 grep 兜底。小仓库首次索引可能比几次 grep 更贵。

## 安装

尚未发布。v0.1 发布后：

1. 通过 **Plugins → Add plugin**（本地目录）或插件管理器安装 bundle。
2. 安装后**重启一次 DSH**，让 Client 半进入浏览器 boot graph。
3. 打开一个会话。
4. 可选但推荐：单独安装 `dsh-plugin-codegraph`（`dsh plugin add dsh-plugin-codegraph`）。它**不随本插件打包，也不会自动安装**。

### 在哪里打开

它没有独立的“启动”按钮，也没有左侧栏图标；入口是右侧栏面板和斜杠命令：

- 打开右侧栏，点 **+**（添加 tab）→ **Architecture map**。
- 或者在输入框输入 `/arch`，选 **Architecture map**。
- 想单独验证 Host 半，让 agent 调用 `arch_hello`。

## 要求

- 带 Web/Desktop Host 的 DeepSeek Harness。
- agent 可读的 workspace。

## 路线图

| 版本 | 内容 |
|---|---|
| 0.1 | 图核心与工具、右侧栏画布、节点拖拽、位置本地记忆、`arch_sync` + manifest + dossier、格式改动识别 + stale、`arch_discuss`、右侧栏讨论按钮、`arch_export`、内置 Mermaid fence 渲染 |
| 0.2 | 位置共享/写回图数据、右侧栏导出按钮、发布打磨 |
| 0.3 | 节点直连讨论、位置共享/写回图、提案、图 diff |
| 0.4 | 边讨论、分组折叠、Mermaid 导入、Office 导出 |
| 0.5 | 多图、PR 关联、团队共享 |

## 先例与致谢

这个方向已经有不少优秀的 DSH 插件。Architecture map 建立在它们的想法之上，并在注明的地方复用其 MIT 代码：

| 项目 | 我们借鉴/复用什么 |
|---|---|
| [dsh-mermaid-plus](https://github.com/pidongqianqian/dsh-mermaid-plus)（MIT） | 内置 Mermaid fence 渲染将参考它实现；保留原始版权声明。 |
| [@eduwork/dsh-side-chat](https://github.com/ECNU/EduWork/tree/main/packages/dsh-side-chat)（MIT/MulanPSL-2.0） | 原生 seed fork 侧聊、隐藏继承消息的 UX 参考。 |
| [@ahggg/dsh-side-chat](https://github.com/AHGGG/dsh-side-chat)（MIT） | Codex 式侧聊交互参考。 |
| [dsh-project-brain](https://github.com/yj-liuzepeng/dsh-project-brain)（MIT） | 项目记忆的先例；我们的档案只做架构专用，不做通用记忆。 |
| [dsh-anatomy](https://github.com/h2298511604-ops/dsh-anatomy)（MIT） | 实时架构图 UI 参考（对象是 DSH 本身）。 |
| [dsh-diagram-gallery](https://www.npmjs.com/package/dsh-diagram-gallery)（MIT） | 图生成/图表廊参考。 |
| [dsh-mindmap-live](https://github.com/SSShooter/dsh-mindmap-live)（MIT） | agent/用户双向编辑参考。 |
| [dsh-plugin-codegraph](https://github.com/CC19990113/dsh-plugin-codegraph)（MIT） | 可选的代码事实增强。 |

复制或改编的代码会保留原版权头，并在实现落地后登记到 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 设计文档

设计文档保存在本地，不纳入版本跟踪；README 只保留公开概览。

## 许可

MIT。

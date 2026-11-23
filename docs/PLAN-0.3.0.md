# 0.3.0 · 位置 pin 与信号流画布 · 施工图

> 状态：**已验收**（ACF rev 15：20 pins / 24 edges / 6 groups）；77 tests 通过；代码提交 `ce6dec6` + 施工图 docs 提交；tag `v0.3.0` 已打（本地，待 push/publish）
> 版本：0.3.0（minor）
> 影响面：Host graph schema + Client canvas + SVG 导出 + docs/skill
> 关联图：`.archmap/graph.json`（rev 32，n1–n17）；本版动 n1、n2、n4、n5、n6、n8，n3/n7/n9–n17 为回归面
> 前置：[docs/PLAN-0.2.1.md](PLAN-0.2.1.md) 已执行（含 discuss/consent 修复）；0.3 从 `release/0.2.1` 切出
> 后续：0.4 边讨论 / 分组折叠（不在本图）

---

## 0. 一句话

给图谱加**可脚本写入的节点位置**（`node.position`），让画布和 SVG 导出使用它；同时把边的语义画出来（标签、类型、回流曲线、同排绕障），使 ACF 这类**带环、按信号流阅读**的图不再退化为网格。

---

## 1. 目标与非目标

### 1.1 目标

1. `graph.json` 的节点可以带 `position: {x, y}`，表示画布左上角；脚本通过 `arch_graph_patch` 写入/清除。
2. 画布：pin 优先于自动布局；拖拽仍是浏览器本地覆盖，叠在 pin 上；`Reset layout` 只清本地覆盖。
3. 画布：渲染 `edge.label`，区分 `call/data/dependency`，回流边走曲线，同排被挡的边走绕行。
4. SVG 导出：跟随 pin，使用同一套连线几何和标签；Mermaid/Markdown 不变。
5. 文档/skill：position 字段、pin/拖拽优先级、环图仍需 pin 的边界。

### 1.2 非目标

- **不做**自动断环/自动识别信号方向；ACF 图已证明没有唯一解。
- **不做**分组背景带/泳道；`group` 仍在节点副标题里。
- **不做**“把拖拽位置写回 graph.json”的 UI 按钮；共享布局走 `arch_graph_patch`。
- **不做** schema 版本号升级；`position` 是可选字段，schema 仍为 1。
- **不做** Mermaid 的绝对坐标（Mermaid 本身不支持）。

---

## 2. 节点任务总表

| 节点 | 本版改动 | 任务 | 验证效果 |
| --- | --- | --- | --- |
| n1 Host entry | **有** | `arch_graph_patch` 描述补 `position` 形状与 `null` 清除 | agent 能从工具描述知道 position；调用成功 |
| n2 Graph store | **有** | `position` 字段、校验、patch、清除、摘要展示 | 合法 pin 写入 rev+1；非法值拒绝；`arch_graph_get` 显示 pin |
| n3 Memory store | 无 | 不改 manifest/sync | `arch_sync` 行为不变；pin 不影响 stale |
| n4 Exporter | **有** | 网格布局应用 pin；SVG 连线/标签与画布同构 | SVG 含 `x="…" y="…"`、path、标签；Mermaid/Markdown 不变 |
| n5 Sidebar panel | **有** | pin/覆盖优先级；reset 语义；Fit 覆盖 pin | 拖 pin 节点→本地覆盖；reset→回 pin；刷新仍保留拖拽 |
| n6 Graph canvas | **有** | `autoLayout` + pin wrapper；`edgeRoute`；标签；标题截断 | 信号流可读；环图不塌；标签不压标题 |
| n7 Mermaid fence | 无 | 不改 fence 渲染 | 聊天 mermaid 仍渲染 |
| n8 Architecture skill | **有** | schema/README/DETAIL/FAQ/CHANGELOG | 三处文档一致；agent 会写 position |
| n9 Project index | 无 | 不改 local/remote 解析 | 本地/远程 source 正常 |
| n10 Content source | 无 | 不改扫描/读取 | 本地 sync 正常 |
| n11 Remote transport | 无 | 不改 SSH | 远程只读命令不变 |
| n12 Remote content source | 无 | 不改远程读取 | 远程树/读/grep 正常 |
| n13 Consent gate | 无 | 不改授权 | 首次读仍弹卡 |
| n14 Remote read tools | 无 | 不改工具 | `arch_remote_*` 正常 |
| n15 Remote indexer | 无 | 不改轮询 | 变更检测不变 |
| n16 Remote maintainer | 无 | 不改维护 | `/arch remote update` 不变 |
| n17 Remote commands | 无 | 不改命令 | `/arch remote …` 不变 |
| 发布层 | **有** | 0.3.0、CHANGELOG、测试 77、文档 | 全绿 |

> 远程 n9–n17 的“无改动”是硬约束：本版只改图数据、画布和导出，**不得**触碰 SSH/consent/index 路径。

---

## 3. 逐节点施工

### n2 Graph store — `src/host/graph.js`

**数据契约**：

- `position`：可选对象，仅 `{x, y}`；`Number.isFinite`；`|x|,|y| ≤ 1_000_000`。
- 语义：节点左上角，画布坐标（不是中心）。
- `add_node`：可带；`update_node` patch 可带；`patch.position === null` 清除。
- 不改变 `schema: 1`；未知字段仍拒绝。

**步骤**：

1. `NODE_FIELDS`、`NODE_PATCH_FIELDS` 加 `position`；新增 `POSITION_FIELDS = new Set(['x','y'])`。
2. 新增 `assertPosition(position, where)`：plain object、known keys、finite、范围；错误码 `INVALID_GRAPH` / `LIMIT_EXCEEDED`。
3. `normalizeNode` 带 `position`。
4. `validateGraph` 对每个 node 调 `assertPosition`。
5. `update_node`：`Object.assign` 后，`position: null` → `delete node.position`。
6. `renderOverview`：有 position 时行尾加 `pin x,y`；`renderNode` 加 `pinned: x,y`。
7. `diffGraphs` 无需改（JSON 比较自然覆盖）。

**验证**：

- `add_node` 带 `{x:120,y:40}` → 读回一致；rev+1。
- `update_node` 改 `{x:300.5,y:88}` → 读回；`null` → 字段消失。
- 非法：`{x:'left'}`、`{x:1,y:2,w:3}`、`{x:1e7,y:0}` → 分别 `INVALID_GRAPH` / `INVALID_GRAPH` / `LIMIT_EXCEEDED`。
- `arch_graph_get` 显示 `pin`；不传 include 也能看到。

### n1 Host entry — `src/host/plugin.js`

**步骤**：

1. `arch_graph_patch` 的 `ops` 描述补：
   - `add_node` 可带 `position?:{x,y}`；
   - `update_node` patch `position:{x,y}` pin；`position:null` 清除。
2. 不改工具数量、参数 schema 的 `additionalProperties`，不改命令。

**验证**：

- 模型看到的工具描述包含 position（快照/人工检查）。
- `arch_graph_patch` 预览 `apply:false` 不写、返回 diff；`apply:true` 才 rev+1。

### n5 Sidebar panel — `client.js` · `createGraphTab`

**依赖**：0.2.1 的 `overlayPosition` + 覆盖层语义；`discussionCommand` + `/arch discuss [workspace]` 也必须从 0.2.1 带过来（否则 0.3 分支的远程 discuss 仍报 node-not-found）。

**步骤**：

1. `layoutView = layout(graph)`（`layout` 现在是 auto + pin）。
2. `positionOf` 继续 `overlayPosition(base, positions[id])`；pin 在 base 里，本地拖拽覆盖它。
3. reset 语义保持：只清本地覆盖，Fit 用 `layout(graph)`（含 pin）。
4. `fitGraph` 用全量 `positionOf`，确保 pin 在 Fit 范围内。
5. 不新增“写回图”的按钮；拖拽只在本地。
6. 详情面板可显示 `pinned`（可选，不阻塞）。

**验证**：

- pin 节点渲染在指定左上角；拖它 → 本地覆盖；刷新 → 拖后位置；reset → 回 pin。
- 有 pin 和无 pin 混合：无 pin 节点自动布局，pin 节点保持。
- 切 source：位置互不影响。

### n6 Graph canvas — `client.js` · layout / 连线 / 标签

**步骤**：

1. 保留 `autoLayout`（v0.2.0 的 layered + 环图 grid fallback）。
2. 新增 `pinnedPosition(node)`：finite `position` → `{x,y}`。
3. 新增 `layout(graph)`：先 `autoLayout`，再对 pin 节点 `{...base, x, y}`；更新 `width/height`；返回 `pinned` 计数。
4. 新增 `edgeRoute(from, to, boxes)`：
   - 前向：右→左；同排有 blocker 时上/下绕行；
   - 后向：左→右，水平回流在下方画弧；斜回流在两个 row 之间穿过，不压目标行；
   - 竖直：上/下边进。
5. 新增 `edgeStyle(kind)`：`dependency` 虚线、`containment` 点线、`data` 半透明；`call` 实线。
6. 渲染：先 path，再 node，再标签（标签带背景、`pointer-events:none`，避免被节点盖住/挡拖拽）。
7. `clipWidth`：按像素截断标题，避免 CJK 标题溢出 196px。
8. 性能：blocker 检测只对 `|dy|≤4` 的同排边执行；E×V 的扫描不要扩到所有边。

**验证**：

- 无 pin 的 DAG：布局与 v0.2.0 相同（除标签）。
- 带环无 pin：仍是 grid（文档已说明）。
- 带 pin 的 ACF：client → data/control-plane → core → resampler → checker → spi → plugins → async/transport/dmmotor；safety 在 core 上方。
- 边标签完整可见；`dependency` 边虚线；回流边不穿过节点标题。
- 同排 edge 被节点挡住时，path 有绕行 lane；标签不压节点标题。
- 400 节点/1200 边拖动不卡顿（同排扫描受限）。

### n4 Exporter — `src/host/export.js`

**步骤**：

1. `gridLayout` 后应用 `node.position`，重算 `width/height`（`Math.ceil`）。
2. 新增与 client 同构的 `edgeRoute(from, to, boxes)`（纯函数，无 React）。
3. SVG 边从 `<line>` 改为 `<path d="…">`；保留 `marker-end`。
4. 标签加背景 rect + 文本；紧 gap 时上移，避免压节点。
5. Mermaid 源码、Markdown digest 不动。

**验证**：

- 有 pin 的图：SVG 节点 `x/y` 等于 pin；`width/height` 覆盖最右/最下。
- 前向/后向边都是 `<path>`；标签存在。
- Mermaid 字节与不加 pin 时一致（`position` 不参与 Mermaid）。
- Markdown 字节不变。
- 导出不修改 graph/manifest。

### n8 Architecture skill / docs

**文件**：

- `skills/architecture-map/references/schema.md`：position 字段、patch/清除、优先级、环图 fallback。
- `README.md` / `README.zh.md`：canvas 卖点、pin FAQ、limitations（无分组带、自动环图仍 grid）。
- `docs/DETAIL.md` / `docs/DETAIL.zh.md`：功能与限制。
- `CHANGELOG.md`：0.3.0 Added/Changed。
- `package.json`：0.3.0。

**验证**：

- 文档三处一致：position 是左上角、有限数值；本地拖拽覆盖 pin；环图无 pin 回 grid。
- FAQ 示例可直接被 agent 复制成 `arch_graph_patch`。
- `rg "Shared positions|shared/persisted" README* docs/` 不再出现旧承诺。

---

## 4. 数据契约与兼容性

### 4.1 优先级

```text
浏览器本地拖拽 override  >  graph 的 node.position pin  >  自动布局
```

- 本地拖拽只存 `{x,y}`，按 workspace + source 存 localStorage。
- Reset 清本地；pin 不动。
- `position:null` 清 pin，回到自动布局。

### 4.2 兼容性

| 场景 | 期望 |
| --- | --- |
| v0.2.0 的图（无 position） | 完全兼容；布局行为不变；只是画布多标签 |
| 新图带 position，旧 Host 读取 | 旧 `validateGraph` 不拒绝未知 node 字段，字段保留；旧 client 忽略；下一次旧 `add_node` 会丢 position（可接受） |
| 新 Host 读旧图 | 无 position，正常 |
| 远程项目 | position 写在本地 `<workspace>/.archmap/projects/<id>/graph.json`；不写远程 |
| 部分节点 pin | pin 节点固定，其余自动；可能重叠，属用户责任 |
| `position` 非法 | 拒绝写入；不修改现有图 |

### 4.3 版本

- `schema` 仍为 1；`position` 是可选字段，向后兼容。
- `package.json` 0.3.0；CHANGELOG 0.3.0。
- 需要新 Host 进程：`arch_graph_patch` 的校验在插件加载时进入进程；**重启 DSH**。Client 刷新页面。

---

## 5. 测试矩阵

| 层 | 文件 | 用例 | 期望 |
| --- | --- | --- | --- |
| Graph | `test/graph.test.mjs` | position 写入/更新/清空/非法/上限 | 4 类断言通过 |
| Client layout | `test/client-sources.test.mjs` | pin 覆盖、环图 grid + pin、非有限 pin | 3 个用例 |
| Client route | 同上 | 同排绕行、水平回流、斜回流 | 3 个用例 |
| Client title | 同上 | `clipWidth` 短标题保留、长 CJK 截断 | 1 个用例 |
| Export | `test/export.test.mjs` | pin 的 x/y、尺寸、path、标签 | 1 个用例 |
| 回归 | 全量 | `npm run check`、`npm test` | 77 通过 |

> 0.2.1 已带 `overlayPosition` + 远程 discuss 源修复（68）；本版新增 9 个，合计 **77**。

---

## 6. ACF 验收（端到端）

**输入**：ACF 图（`remote:acf`，约 20 节点/23 边），以及上一轮给出的 20 个 `update_node` position。

1. **重启 Host**：重启 DSH（或重新加载插件）让 `arch_graph_patch` 认 `position`；刷新面板页面。
2. **读 rev**：在 BodySense 会话里 `arch_graph_get({workspace:"remote:acf"})`，记录当前 rev。
3. **写位置**：`arch_graph_patch({ workspace:"remote:acf", baseRev:<rev>, ops:[…20 个 update_node…] })`；先 `apply:false` 预览。
4. **看面板**：`/arch` → source `acf` → Fit。期望：
   - 主链左→右：client → data/control-plane → core → resampler → checker → spi → plugins → async/transport/dmmotor；
   - safety 两个节点在 core 上方，形成旁路；
   - 边标签可见；`Hold / Disable 裁决`、`Command 拉取 · Ack/State 回写`、`BackendState 反馈` 不压标题；
   - 拖一个 pinned 节点 → 本地覆盖；Reset → 回 pin。
5. **导出**：`arch_export({workspace:"remote:acf", format:"svg"})`；SVG 节点坐标等于 pin，backward 边是 path，标签存在。
6. **无 pin 回归**：同一张图清掉一个 position（`position:null`）→ 该节点回自动布局；其余 pin 不动。
7. **远程只读**：确认 ACF 源码/远程文件未被修改；`.archmap/projects/acf/graph.json` 新增 position。

---

## 7. 发布与回滚

| 项 | 值 |
| --- | --- |
| 前置 | `release/0.2.1`（尚未 tag） |
| 分支 | `feat/0.3.0` 已 fast-forward 到 `main`；`wip/0.3-position` 仅留档 |
| 版本 | 0.3.0 |
| CHANGELOG | Added：position、画布边标签/路由、导出 pin；Changed：reset 语义 |
| 生效 | Host 重启；client 刷新 |
| 回滚 | 关闭/回退 0.3.0；图里的 position 字段旧版可读（不丢），旧 client 忽略 |

**风险**：

- pin 布局可能重叠 → 文档明确“用户自选坐标”；reset 只清本地。
- 边标签在密集图上可能拥挤 → 标签有背景、紧 gap 上移；后续可加“只显示选中节点边标签”的开关（0.4）。
- 导出 SVG 的节点尺寸（210×84）与画布（196×64）不同 → 位置相同、盒子略大；文档说明。
- 自动环图仍 grid → 不修算法；pin 是确定性方案。

---

## 8. 完成闸门

- [ ] 0.2.1 已发布，`wip/0.3-position` 已 rebase。
- [ ] n2 的 position 校验/清除/摘要用例全过。
- [ ] n5/n6 的 pin、标签、绕行、回流用例全过。
- [ ] n4 的 SVG pin/path/标签用例全过；Mermaid/Markdown 不变。
- [ ] `npm test` = 77，`npm run check` 通过。
- [ ] ACF 端到端验收通过（§6），面板实机确认。
- [ ] 文档三处一致；CHANGELOG/版本 0.3.0。
- [ ] tag `v0.3.0`。

# 0.2.1 · 本地布局冻结修复 · 施工图

> 状态：**已执行**（`release/0.2.1`，6 commits：`f2e3b3d` + `c574e53` + `eeaacbc` + `bd3450a` + `abe04e7` + `5612ac0`）；0.3 已合并到 `main`
> 版本：0.2.1（patch）
> 影响面：Client + Host command + docs + tests；graph schema、导出器不变；远程 discuss 修复需要重启 Host
> 关联图：`.archmap/graph.json`（rev 32，n1–n17），本版动 n1 Host entry（discuss workspace）、n5 Sidebar panel、n6 Graph canvas、n8 Architecture skill、n17 Remote commands（授权范围）
> 前置：v0.2.0 tag
> 后续：[docs/PLAN-0.3.0.md](PLAN-0.3.0.md)

---

## 0. 一句话

把「拖动位置」从**整张布局快照**改成**覆盖层**：自动布局始终是基准，只有拖过的节点保留本地坐标；graph rev 变化后，未拖节点重新分层，`Reset layout` 只清覆盖，不再把旧坐标冻结下来。

---

## 1. 缺陷与根因

### 1.1 现象

在 v0.2.0 面板里：

1. 打开一张图，自动布局算出一组坐标。
2. 任意一次 `arch_graph_patch` 让 `graph.rev` 变化（加节点、加边、改摘要都算）。
3. 老节点**停在旧坐标**，只有新节点按新布局落位；如果拓扑变了，连线会穿过节点或互相压住。
4. 点 `Reset layout` 后，下一次 rev 变化又把 reset 时的坐标冻结；刷新页面才会重新布局。

### 1.2 根因

`client.js` 的 `createGraphTab` 里，加载位置的 effect 把**所有**节点的 base 坐标写进 `positions`：

```js
// v0.2.0 伪代码
const base = layout(graph)
const saved = readSavedPositions(storageKey)
setPositions(previous => {
  const next = {}
  for (const [id, box] of base.positions) {
    const old = previous[id] ?? saved[id]
    next[id] = old ? { ...box, x: old.x, y: old.y } : box
  }
  return next
})
```

`next` 包含全部节点。下一次 rev 变化时，`previous[id]` 对每个节点都存在，`old` 永远命中，于是 `base` 的新坐标被忽略。`resetLayout` 也曾把 `base.positions` 整体写回 `positions`，让冻结“落盘”到下一次 rev。

### 1.3 修复原则

- `positions` 只存**用户拖过的节点**，形状 `{ [id]: { x, y } }`。
- 渲染用 `positionOf(id) = overlayPosition(layout.positions.get(id), positions[id])`；宽高始终来自布局，坐标可被覆盖。
- graph rev 变化时，只从 localStorage 重新读 override，不注入 base。
- `Reset layout`：`setPositions({})` + 清 localStorage + 按当前布局 Fit。
- 拖拽写入 `{x, y}`；pointerup 只持久化该 id。

### 1.4 本版明确不做

- 不加 `node.position`（0.3.0）。
- 不画边标签、不改连线几何（0.3.0）。
- 不改 SVG 导出（0.3.0）。
- 不做“把拖拽写回 graph.json”的 UI（0.3.0 也不做）。

---

## 2. 节点任务总表

| 节点 | 本版改动 | 任务 | 验证效果 |
| --- | --- | --- | --- |
| n1 Host entry | **有** | `/arch discuss` 解析可选 workspace，面板传 `remote:<id>` | 远程源节点在 `remote:acf` 解析；本地源仍用 cwd |
| n2 Graph store | 无 | 不改 schema、baseRev、锁、备份 | patch rev 正常；anchor 校验正常 |
| n3 Memory store | 无 | 不改 manifest / sync | `arch_sync` 输出不变 |
| n4 Exporter | 无 | 不改 Mermaid/SVG/Markdown | 导出文件字节与 v0.2.0 一致（同图同输入） |
| n5 Sidebar panel | **有** | positions 改覆盖层；effect、reset、drag、fit | rev 变化后未拖节点重排；拖过节点保持；reset 清覆盖 |
| n6 Graph canvas | **有** | 新增纯函数 `overlayPosition`；`positionOf` 合并 base + override | 覆盖节点仍有正确 w/h；无 undefined |
| n7 Mermaid fence | 无 | 不改 fence 渲染 | `mermaid` 代码块仍渲染/回退 |
| n8 Architecture skill | **有** | 文档写清“环图退网格”和“只记拖拽” | README/DETAIL/schema 三处一致 |
| n9–n17 远程链路 | 无 | 不改 index/SSH/consent/polling/maintenance | 远程源可选；远程图仍能读、拖拽、reset |
| 发布层 | **有** | package 0.2.1、CHANGELOG、测试计数 | `npm test` 68、`npm run check` 通过 |

> 说明：n9–n17 是本版的**回归面**，不是改动面；任何 client 改动都不应触碰远程授权与 SSH 路径。

---

## 3. 逐节点施工

### n1 Host entry — `src/host/plugin.js`

**问题**：`/arch discuss` 直接用 `agent.session.header.cwd` 当 workspace，面板选中的 `acf` 不会传下来；远程节点于是去本地图找，报 `node "async-io" does not exist in /Users/yyf/ideas/BodySense`。

**步骤**：

1. 新增并导出纯函数 `parseArchDiscuss(input)`：接受 `discuss <node|edge>:<id> [fork|lite] [workspace]`。
2. 命令 handler 用它；`workspace = discuss.workspace ?? agent.session.header.cwd`。
3. 本地源面板不传第三段；远程源传 `remote:<id>`。
4. 用法文本补 `[workspace]`。
5. 远程仍由 `startDiscussion` 做 consent 检查；未授权时返回 `REMOTE_CONSENT_REQUIRED`，不是 node-not-found。

**验证**：

- `parseArchDiscuss('discuss node:api fork remote:acf')` → `{target:'node:api',mode:'fork',workspace:'remote:acf'}`。
- 本地：`discuss node:api fork` → workspace 为 cwd。
- 面板选 acf，点 Discuss → 命令行为 `node:async-io ... remote:acf`；授权后能起子会话。

### n5 Sidebar panel — `client.js` · `createGraphTab`

**文件**：`client.js`

**步骤**：

1. 在组件里保留 `const [positions, setPositions] = React.useState({})`，语义改为“本地覆盖”。
2. 新增 `positionOf`（可放在 `layoutView` 之后）：

   ```js
   const positionOf = id => {
     const base = layoutView.positions.get(id)
     if (!base) return undefined
     return overlayPosition(base, positions[id])
   }
   ```

3. 把 `[graph?.rev, storageKey]` effect 改为：

   ```js
   React.useEffect(() => {
     if (!graph || !storageKey) return
     const ids = new Set(graph.nodes.map(node => node.id))
     const saved = readSavedPositions(storageKey)
     setPositions(Object.fromEntries(
       Object.entries(saved).filter(([id]) => ids.has(id)),
     ))
   }, [graph?.rev, storageKey])
   ```

4. `resetLayout`：

   ```js
   setPositions({})
   clearSavedPositions(storageKey)
   fitBoxes([...layout(graph).positions.values()])
   ```

5. 拖拽 move：`setPositions(prev => ({ ...prev, [id]: { x: last.x, y: last.y } }))`；pointerup 的 `saved[id] = last` 不变。
6. `fitGraph`：用 `nodes.map(node => positionOf(node.id)).filter(Boolean)`，不再读 `Object.values(positions)`。
7. 删除旧的“遍历 base 并把 previous/saved 合并进 next”的逻辑。
8. 新增 `discussionCommand(id, mode, workspace)`；`openDiscussion` 里按 `source.kind === 'remote'` 传 `remote:${source.id}`。

**完成标准**：

- `positions` 里只出现拖过的 id；刷新后仍能从 localStorage 恢复。
- graph rev 变化后，未拖节点按新布局移动；拖过节点保持。
- Reset 后 `positions === {}`，刷新后仍为空（localStorage key 被清）。
- 切到远程源再切回，两个 source 的覆盖互不影响。

### n6 Graph canvas — `client.js` · layout 辅助

**文件**：`client.js`

**步骤**：

1. 新增纯函数（放在 `layout` 附近）：

   ```js
   function overlayPosition(base, override) {
     if (!base) return undefined
     if (!override || !Number.isFinite(override.x) || !Number.isFinite(override.y)) return base
     return { ...base, x: override.x, y: override.y }
   }
   ```

2. `NodeShape` 继续用 `box.w/box.h`；覆盖只改 `x/y`。
3. 自动布局函数保持 v0.2.0 行为；**不要**在本版引入 pin / `pinnedPosition` / `edgeRoute`。
4. 标题截断、边标签、曲线路由都留到 0.3.0，避免本版 diff 扩大。

**完成标准**：

- 覆盖节点渲染时 `w=196,h=64` 始终存在。
- `overlayPosition(base, {x:NaN,y:0})` 返回 base（防御坏 localStorage）。
- 纯函数可被测试提取，不依赖 React。

### n8 Architecture skill — 文档

**文件**：

- `README.md` / `README.zh.md`：Limitations 补“环图且无 pin 时退化为紧凑网格；在意顺序请 pin 布局”。
- `docs/DETAIL.md` / `docs/DETAIL.zh.md`：Known limitations 同步。
- `skills/architecture-map/references/schema.md`：Limits 一节补同一句。
- `CHANGELOG.md`：0.2.1 条目。

**本版文案不要提**：`node.position`、边标签、导出 pin（这些是 0.3.0 的卖点，提前写会让 0.2.1 文档与行为不一致）。

**完成标准**：

- 三处文档措辞一致：**v0.2.0 的 layered 布局对带环图会退化为网格**。
- README 仍准确描述“拖动位置按 workspace 存浏览器本地”。
- `rg "node\.position|pinned|shared positions" README.md docs/DETAIL.md skills/architecture-map/references/schema.md` 在本版不出现 0.3 的 pin 承诺。

---

## 4. 测试与验证

### 4.1 自动

| 命令 / 文件 | 用例 | 期望 |
| --- | --- | --- |
| `node --test test/client-sources.test.mjs` | 新增 `overlayPosition` 用例 | base 原样返回；override 只改 x/y；坏 override 回退 base |
| `npm run check` | 全量 `node --check` | 通过 |
| `npm test` | 全量 | 65 → **68** 通过（0.2.0 基线 65；+overlay，+discussionCommand，+parseArchDiscuss） |

### 4.2 手动（浏览器）

前置：用当前 v0.2.0 skill/图；面板打开一张 ≥5 节点的图。

1. **拖拽持久化**：拖节点 A 到空白处 → 刷新页面 → A 仍在拖后位置；其他节点不变。
2. **rev 重排**：对图 `arch_graph_patch` 加一条边或一个节点 → 未拖节点按新布局重排；A 保持；没有明显压线。
3. **Reset**：点 Reset → A 回到自动布局；刷新 → 不回弹。
4. **多 source**：本地拖 A，切到远程图，再切回 → A 的覆盖还在；远程图自己的位置独立。
5. **远程 discuss**：选 `acf`，对节点点 Discuss/Lite → 命令带 `remote:acf`；未授权时提示远程授权，授权后能起子会话。
6. **回归**：点节点详情、Discuss 按钮、滚动缩放、Fit、Mermaid fence 均正常。

### 4.3 缺陷复现基线（证明修的是真问题）

在 v0.2.0 上重复 4.2.2：未拖节点不移动，新节点插在旧布局里，常出现连线穿节点。记录 before/after 截图或坐标对比，附在 PR 描述。

---

## 5. 拆版与发布

### 5.1 执行记录

- `wip/0.3-position` `5816f82`：0.2.1 + 0.3.0 的混合实现（用于后续 0.3）。
- `release/0.2.1` `f2e3b3d`：client 覆盖层修复 + `overlayPosition` 测试。
- `release/0.2.1` `c574e53`：环图 fallback 文档 + 0.2.1 版本/CHANGELOG。
- `release/0.2.1` `eeaacbc`：`/arch discuss` 带选中源；`discussionCommand` + `parseArchDiscuss` 测试。
- `release/0.2.1` `bd3450a`：远程 discuss 文档 + 测试计数。
- `release/0.2.1` `abe04e7`：远程授权范围 `session|always` + 测试。
- `release/0.2.1` `5612ac0`：授权范围文档（README/DETAIL/CHANGELOG）。
- `main` `d45a42a`：v0.2.0 基线（0.2.1 尚未合入）。

本版实际只改：

- `client.js`：§3 的 n5/n6 覆盖层改动 + `discussionCommand`（不含 `pinnedPosition`、`edgeRoute`、`edgeStyle`、`edgeLabelWidth`、边标签 JSX、`clipWidth`）。
- `src/host/plugin.js`：`parseArchDiscuss` + `/arch discuss [workspace]`。
- `src/host/remote/commands.js`：`/arch remote grant <id> [session|always]`。
- `README.md`、`README.zh.md`、`docs/DETAIL.md`、`docs/DETAIL.zh.md`、`skills/architecture-map/references/schema.md`：环图回网格、拖拽覆盖、远程 discuss 需授权。
- `test/client-sources.test.mjs`：`overlayPosition` + `discussionCommand` 用例。
- `test/plugin-registration.test.mjs`：`parseArchDiscuss` 用例；`test/remote-commands.test.mjs`：授权范围用例。
- `CHANGELOG.md`、`package.json`：0.2.1。
- **不要**改：`src/host/graph.js`、`src/host/export.js`（留给 0.3）。

### 5.2 版本与发布

| 项 | 值 |
| --- | --- |
| package.json | `0.2.1` |
| CHANGELOG | `## 0.2.1 — <date>`：Fixed 本地布局冻结；Docs 环图 fallback |
| 兼容性 | Client + Host command；**远程 discuss 修复需要重启 Host**；其余 client-only |
| 生效方式 | 面板刷新页面；若开了 HMR 则自动 |
| tag | `v0.2.1` |

### 5.3 提交粒度

建议 2 个 commit：

1. `fix(client): keep dragged positions as overrides`（client + test）
2. `docs: document cyclic grid fallback and local drag semantics`（docs + changelog + version）

---

## 6. 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 布局在图更新后会“跳” | 用户可能已习惯旧行为（冻结） | 这是文档语义；需要稳定布局时在 0.3.0 用 pin。PR 描述写清 |
| 旧 localStorage 里有全量坐标 | 只可能来自旧 drag/reset？旧实现只写 drag 的 id | 读取时按当前节点过滤；多余 id 丢弃 |
| 覆盖节点重叠 | 用户手动拖的，责任在用户 | 不自动纠正；Reset 可恢复 |
| Client 缓存 | 刷新后仍是旧 JS | 强制刷新/重启 DSH；不涉及 Host |

回滚：`git revert` 两个 commit 即可；无 schema/数据迁移。

---

## 7. 完成闸门（进入 0.3.0）

- [ ] `npm test` = 68，`npm run check` 通过。
- [ ] 4.2 的 6 个手动场景全部通过。
- [ ] 4.3 的 before/after 记录存在。
- [ ] `git diff v0.2.0..v0.2.1` 不含 `src/host/graph.js`、`src/host/export.js`；`src/host/plugin.js` 只含 `/arch discuss` 的 workspace 解析。
- [ ] 0.3 的 `wip/0.3-position` 分支保留完整；可 rebase 到 `v0.2.1`。
- [ ] tag `v0.2.1` 已打；[PLAN-0.3.0](PLAN-0.3.0.md) 开始执行。

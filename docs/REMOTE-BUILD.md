# 远程仓库架构查看 · 施工图（节点级）

> 配套：[docs/REMOTE-PLAN.md](REMOTE-PLAN.md)
> 状态：可施工
> 规则：**一个节点做完 → 验证 → 全部通过后才开始下一个节点**；验证结果记到 §7。

---

## 0. 怎么用这份文档

- 节点按 `W0 → W12` 顺序做，不跳步；
- 每个节点都有：目标、依赖、改动文件、步骤、验证清单、通过标准、失败处理；
- 每个节点结束时必须跑 `npm run check && npm test`，再跑该节点的专项验证；
- 验证不通过：在本节点内修复或回滚，**不进入下一节点**；
- 每个工作节点落地时，在架构图里新增/更新对应节点（见 §5），锚点验证通过后再标 `fresh`；
- 全过程不改远程文件、不装远程服务、不 clone。

---

## 1. 施工原则

1. **本地优先**：任何改动都不能破坏现有本地工作流；每个节点都要回归本地测试。
2. **先抽象后远程**：先把内容源（content）和状态（state）拆开，再接 SSH；不要一开始就把 `node:fs` 到处替换成条件分支。
3. **只读**：远程只执行固定只读命令；代码里禁止出现远程写、`rm`、`mv`、`>` 重定向。
4. **失败关闭**：没有授权、没有连接、路径越界、输出超限，一律返回清晰错误，不返回部分内容。
5. **可回滚**：每个节点独立可回退；图数据有 `graph.bak.json`；manifest/doc 写入用临时文件 + rename。
6. **证据**：验证命令、输出摘要、日期记入 §7；没有记录视为未验证。

---

## 2. 验证环境

### 2.1 本地命令

```sh
npm run check          # node --check 所有源文件
npm test               # node --test 全部测试
node --test test/remote-ssh.test.mjs   # 单个节点专项
```

仓库没有运行时依赖（只用 Node 内置模块），`npm` 不需要安装包即可跑。

### 2.2 假 SSH（CI 用，不连网络）

新增 `test/fixtures/fake-ssh/ssh`（POSIX shell 或 Node 脚本），测试时把它放到 `PATH` 最前面：

```sh
PATH="$PWD/test/fixtures/fake-ssh:$PATH" npm test
```

约定：

- 环境变量 `FAKE_SSH_ROOT`：它冒充的“远程根目录”（测试临时目录）；
- `FAKE_SSH_LOG`：每条命令追加一行 JSON，测试断言用过哪些命令；
- `FAKE_SSH_CAPS`：能力模拟（例如 `uname=Linux,git=1,sha256sum=1,rg=1`）；
- `FAKE_SSH_FAIL`：模拟连接失败/超时；
- 它解析 `ssh` 参数：跳过 `-o`、`-p`、`-l`、`-i`、`-F`、`-S` 等选项，取 host 和剩余命令，在 `FAKE_SSH_ROOT` 下执行。

测试断言两件事：

1. **命令正确**：路径带空格/引号/中文时不注入；
2. **没有越界**：同步只出现 `git ls-files`/`git status`/`find`/`sha256sum`/`stat`，**不出现** `cat`/`sed`/`head`（说明没有把内容拉回本地）。

### 2.3 测试夹具

- 用 `mkdtemp` 建临时目录，不提交源码夹具；
- 需要 git 的测试：测试内 `git init` + 提交（CI 的 Ubuntu/macOS 自带 git）；没有 git 时 `t.skip`；
- 非 git 测试：纯目录 + 文件 + 指定 mtime；
- 路径转义夹具：空格、单引号、中文、`..`、NUL、换行。

### 2.4 真远程（人工验收）

准备一台**非生产** Linux 机器和一个小仓库：

```sh
ssh <host> 'git -C /tmp/archmap-remote status --porcelain'
```

人工验收只在 W12 做；W1–W11 全部可以用假 SSH 验证。

---

## 3. 节点总览

| 节点 | 内容 | 依赖 | 主要产出 | 预估 |
|---|---|---|---|---|
| W0 | 基线冻结 | — | 测试全绿、记录基线 | 0.5 天 |
| W1 | 项目索引与目录 | W0 | `.archmap/index.json`、多项目解析 | 1.5 天 |
| W2 | 内容源抽象 | W1 | `ContentSource` + 本地适配器 | 1.5 天 |
| W3 | SSH 只读传输 | W2 | `remote/ssh.js` | 1.5 天 |
| W4 | 远程内容源 | W3 | `remote/content.js` | 1.5 天 |
| W5 | 远程图/档案/导出打通 | W4 | `remote:<id>` 可读写本地状态 | 1.5 天 |
| W6 | 授权门 | W5 | 首次读取询问、始终允许、撤销 | 1 天 |
| W7 | 远程读取工具 | W4、W6 | `arch_remote_*` + skill | 1.5 天 |
| W8 | 远程增量同步 | W5、W7 | remote sync、stale、manifest | 1.5 天 |
| W9 | 面板来源与状态 | W1、W8 | 来源选择器、状态条 | 1.5 天 |
| W10 | 变更轮询与自动维护 | W6、W8、W9 | 指纹、命令、维护子会话 | 2 天 |
| W11 | 非 git 兜底与安全加固 | W10 | mtime 索引、安全清单 | 1.5 天 |
| W12 | 端到端验收 | W11 | 真远程验收、文档收尾 | 1 天 |

总计约 17–18 个工作日（单人；不含多远程并行）。

---

## 4. 节点详情

### W0 · 基线冻结

**目标**：确认当前代码是绿的，记录施工前基线。

**依赖**：无。

**改动**：不改代码。

**步骤**

1. 记录当前分支、HEAD、Node 版本；
2. 跑 `npm run check && npm test`；
3. 记录 `.archmap/graph.json` 的 `rev`、节点数、边数；
4. 打开一次 `/arch` 面板，确认本地图可读。

**验证**

```sh
npm run check
npm test
```

- [ ] 全部测试通过；
- [ ] 记录基线：`rev`、节点/边数、测试通过数；
- [ ] 本地面板正常。

**通过标准**：全绿，基线写入 §7。  
**失败处理**：先修基线，不进入 W1。

---

### W1 · 项目索引与目录

**目标**：一个 `.archmap` 能描述“本地项目 + 远程项目”，本地行为完全不变。

**依赖**：W0。

**改动**

- 新增 `src/host/projects.js`：`index.json` 读写、schema 校验、id 规则、`dir` 逃逸检查、默认本地项目、`remote:<id>` 解析；
- 新增 `src/host/workspace.js`：`resolveWorkspace(raw, exec)` 返回 `{ kind, display, stateDir, content?, project }`；
- 改 `src/host/graph.js`、`src/host/memory.js`、`src/host/export.js`：数据目录从“固定 `.archmap`”改为“项目 stateDir”；
- 改 `src/host/plugin.js`：工具 `workspace` 描述增加 `remote:<id>`；`workspaceOf` 接 exec；
- 新增 `test/projects.test.mjs`。

**步骤**

1. 定义 `index.json`（见 PLAN §4.3）：`schema/projects[id/kind/dir/host/root/vcs/consent/autoRefresh]`；
2. id 规则：`^[a-z][a-z0-9_-]{0,63}$`，`local` 保留；重复/非法报错；
3. `dir` 必须是 `.archmap` 相对路径，不含 `..`、绝对路径、空段；
4. 没有 `index.json` → 只有一个本地项目（`dir: "."`），所有旧行为不变；
5. `remote:<id>`：从**当前会话 cwd** 的工作区读 `index.json`，解析到 `<cwd>/.archmap/<dir>`；没有 cwd / 没有该 id 时给明确错误；
6. 本地项目继续用 `<workspace>/.archmap`，不迁移；
7. 所有 store 的 `resolveRoot` 改为 `resolveWorkspace`，本地分支行为不变。

**验证**

```sh
npm run check
npm test
node --test test/projects.test.mjs
```

- [ ] 无 `index.json` 时，本地 `arch_graph_get/sync/doc/export` 输出与 W0 基线一致；
- [ ] 有 `index.json` 时，本地项目仍读 `.archmap/graph.json`；
- [ ] 远程项目解析到 `.archmap/projects/<id>`；
- [ ] 非法 id、重复 id、`dir: "../x"`、未知 `remote:id`、无 session cwd 都报清晰错误；
- [ ] 现有 graph/memory/export 测试全过。

**通过标准**：本地零回归；索引/解析的单测全过。  
**失败/回滚**：删除新模块与调用，回到 W0；不得改本地数据路径。

---

### W2 · 内容源抽象

**目标**：把“读代码内容”从 `node:fs` 里抽出来，为远程替换做准备。纯重构，行为不变。

**依赖**：W1。

**改动**

- 新增 `src/host/content/local.js`：实现 `listTree/hashMany/readText/readRange/stat`；
- 新增 `src/host/content/index.js`：接口与错误码；
- 改 `src/host/graph.js`：锚点哈希走 `content.hashMany`；
- 改 `src/host/memory.js`：`scan`/`commit` 走 `content`；
- 改 `src/host/export.js`：只依赖 `stateDir`；
- 新增 `test/content-local.test.mjs`。

**步骤**

1. 定义 `ContentSource`（只读+哈希，不写）：`listTree`、`hashMany`、`readText`、`readRange`、`stat`；
2. 本地实现保持现有忽略规则、二进制/大小限制、`signatureOf` 归一化；
3. 图锚点、manifest、commit 改为调用 `content`；
4. 不改变任何图/manifest 文件格式。

**验证**

```sh
npm run check && npm test
node --test test/content-local.test.mjs
```

- [ ] `test/graph.test.mjs`、`memory.test.mjs`、`export.test.mjs` 全过；
- [ ] 对本仓库跑 `arch_sync full`，`scanned/added` 数与 W0 基线一致；
- [ ] `arch_manifest_commit` 后 `arch_sync` 计数与之前一致；
- [ ] 锚点 hash 与 W0 相同（同一文件、同一算法）；
- [ ] 无内容读出到日志/临时文件。

**通过标准**：本地输出逐字节一致（图/manifest/export）。  
**失败/回滚**：恢复直接 `fs` 调用；不得带着半套抽象进入 W3。

---

### W3 · SSH 只读传输

**目标**：一个只读、可测、可取消的 SSH 命令层；先不接模型工具。

**依赖**：W2。

**改动**

- 新增 `src/host/remote/ssh.js`：spawn、ControlMaster、超时、AbortSignal、并发上限、单引号转义、能力探测、错误映射、输出上限；
- 新增 `test/fixtures/fake-ssh/ssh`；
- 新增 `test/remote-ssh.test.mjs`。

**步骤**

1. 连接参数：`BatchMode=yes`、`ConnectTimeout=10`、`ServerAliveInterval=15`、`ControlMaster=auto`、`ControlPath`（短哈希路径）、`ControlPersist=300`；不覆盖 `StrictHostKeyChecking`；
2. 命令构造：固定模板 + `shQuote`；路径校验（绝对、无 NUL/换行/`..` 越界）；
3. 能力探测：`uname -s`、`command -v git/sha256sum/shasum/rg`；
4. 错误映射：权限拒绝/主机未知/超时/退出码 → 可读错误；
5. 测试：fake ssh 记录 argv，返回夹具结果。

**验证**

```sh
node --test test/remote-ssh.test.mjs
npm test
```

- [ ] 路径 `a b`、`a'b`、中文、换行、NUL 的转义/拒绝正确；
- [ ] 能力探测返回 Linux/git/sha256sum/rg 组合；
- [ ] 超时和 AbortSignal 会杀掉子进程；
- [ ] 非零退出带 stderr 摘要，不吞错；
- [ ] 输出超限报错，不截断后继续；
- [ ] 代码里没有任何远程写命令（`rm`/`mv`/`>`/`tee`/`chmod`）。

**通过标准**：注入/取消/错误路径测试全过。  
**失败/回滚**：本节点独立，不回退 W2。

---

### W4 · 远程内容源

**目标**：用 SSH 实现与本地同形的只读内容源。

**依赖**：W3。

**改动**

- 新增 `src/host/remote/content.js`；
- 新增 `test/remote-content.test.mjs`。

**步骤**

1. `listTree`：git 用 `git ls-files -z --cached --others --exclude-standard`；非 git 用 `find`（忽略 `.git/node_modules/dist/...`，上限 20000）；
2. `hashMany`：批量 `sha256sum`/`shasum -a 256`，NUL 分隔路径；返回 `path -> sha256`；
3. `readText`/`readRange`：`cat` + `sed`/`head`，分页、行号、大小上限、二进制拒绝；
4. `grep`：`rg` 优先，回退 `grep -rIn`；include/context/上限；
5. `stat`：`stat`/`find` 元数据；
6. `fingerprint`：git `HEAD + status --porcelain -z`；非 git 路径/大小/mtime 摘要；
7. 所有返回带截断标记，不静默丢数据。

**验证**

```sh
node --test test/remote-content.test.mjs
npm test
```

- [ ] 夹具目录的 `listTree` 与本地遍历结果一致；
- [ ] `hashMany` 与本地 `sha256` 一致；
- [ ] `readText` 分页、行号、EOF 正确；二进制/超大拒绝；
- [ ] `grep` 结果与本地 `rg`/`grep` 一致，支持 include/context/上限；
- [ ] 路径越界、符号链接指向 root 外被拒绝；
- [ ] fake ssh 日志里没有写命令。

**通过标准**：夹具上与本地内容源行为对齐；只读。  
**失败/回滚**：W3 不受影响；远程内容源不接工具。

---

### W5 · 远程图 / 档案 / 导出打通

**目标**：`workspace: "remote:<id>"` 可以建图、读图、写档案、导出；数据只落在本地项目目录。

**依赖**：W4。

**改动**

- `src/host/workspace.js`：远程项目返回 `stateDir` + `content`；
- `src/host/graph.js`：锚点哈希走 `content.hashMany`；
- `src/host/plugin.js`：工具调用把 `exec` 传进 store；`arch_discuss` 的 workspace 解析；
- 新增 `test/remote-project.test.mjs`。

**步骤**

1. store 的 `resolveWorkspace` 接受 exec，远程项目用 `stateDir`、`content`；
2. `arch_graph_patch` 的锚点批量远程哈希（sha256，不读内容）；
3. `arch_doc_*`、`arch_export` 只写本地项目目录；
4. 错误信息显示 `remote:<id>`，不泄露本地状态路径；
5. 本地 string workspace 路径行为不变。

**验证**

```sh
node --test test/remote-project.test.mjs
npm test
```

- [ ] 在夹具远程项目上 `arch_graph_patch` 建节点（含锚点），锚点 hash 等于远端 `sha256sum`；
- [ ] `arch_graph_get`、`arch_doc_put/get`、`arch_export` 正常；
- [ ] 数据出现在 `<hub>/.archmap/projects/<id>/`，没有出现在 `<hub>/.archmap/graph.json`；
- [ ] fake ssh 日志无写命令、无 `cat`/`sed`（本节点不读内容）；
- [ ] 本地项目测试全过。

**通过标准**：远程项目可建图；远程零写入；本地零回归。  
**失败/回滚**：删除远程分支，保留 W1–W4。

---

### W6 · 授权门

**目标**：读远程内容/目录结构之前必须获得用户授权；支持本次会话、始终允许、拒绝、撤销。

**依赖**：W5。

**改动**

- 新增 `src/host/remote/consent.js`；
- `src/host/plugin.js`：`ctx.inject(['userQuestions'])`；
- 新增 `test/remote-consent.test.mjs`。

**步骤**

1. 授权记录：内存 `Map<sessionId, {scope, rootSessionId}>`；`index.json` 里 `consent.scope = "workspace"`；
2. 首次读取调用 `ctx.userQuestions.ask({ agent, signal, questions:[...] })`，`intent: {kind:'approval', approve, reject, always, detail}`；
3. 问题只含 host/root，不含文件内容；
4. 选择：本次会话 / 始终允许 / 拒绝 / 跳过（按拒绝处理本次，不持久化）；
5. 没有 `userQuestions` 服务：失败关闭，提示 `/arch remote grant`；
6. 子会话：`workspace` 级授权直接可用；仅会话级时，父会话启动的子会话继承（记录 child session id）；
7. 撤销：清 index 授权 + 内存 + 停止自动维护。

**验证**

```sh
node --test test/remote-consent.test.mjs
npm test
```

- [ ] 无授权时读取被拒绝，未调用内容源；
- [ ] “本次会话”后同会话可读，新会话再问；
- [ ] “始终允许”写入 index，重启后仍有效；
- [ ] “拒绝”不读、不写授权；
- [ ] 撤销后再次读取会重新询问；
- [ ] 无 `userQuestions` 时失败关闭；
- [ ] 问题文本不含文件内容；
- [ ] 讨论子会话继承规则符合预期；维护子会话必须有 workspace 授权。

**通过标准**：授权状态机测试全过；内容零泄漏。  
**失败/回滚**：保持“未授权默认拒绝”，不得临时放行。

---

### W7 · 远程读取工具

**目标**：agent 能读远程代码；工具只在授权后返回内容。

**依赖**：W4、W6。

**改动**

- 新增 `src/host/remote/tools.js`：`arch_remote_list/status/tree/read/grep`；
- `src/host/plugin.js`：注册工具；
- `skills/architecture-map/SKILL.md`：远程工作流；
- `locale/en.json`、`locale/zh.json`；
- `src/host/plugin.js`：讨论子会话的 remote 提示 + 工具收紧；
- 新增 `test/remote-tools.test.mjs`。

**步骤**

1. 工具 schema/输出对齐本地 `read`/`grep` 的习惯；
2. `tree/read/grep` 前先 `ensureConsent`；`list/status` 不读内容；
3. `status` 只返回计数/HEAD，不返回路径；
4. 错误信息提示“用 arch_remote_*，不要用本地 read/grep”；
5. skill 写明：`remote:<id>` 时禁止本地 read/grep/bash 查这些路径；
6. 讨论子会话 prompt 带 remote id + 工具引导；收紧本地 `read`/`grep`/`bash`。

**验证**

```sh
node --test test/remote-tools.test.mjs
npm test
```

- [ ] 首次 `arch_remote_read` 触发授权；拒绝时零内容；
- [ ] 允许后返回分页内容/行号；grep 返回命中；
- [ ] `arch_remote_status` 不含路径/内容；
- [ ] `tree` 也走授权；
- [ ] 未授权时工具错误明确，不抛未处理异常；
- [ ] 讨论子会话拿不到本地 read/grep 权限或提示改用远程工具；
- [ ] skill 文本包含远程规则。

**通过标准**：工具可用 + 授权门生效 + skill 更新。  
**失败/回滚**：下架远程工具注册，保留 W6 授权模块。

---

### W8 · 远程增量同步

**目标**：`arch_sync` / `arch_manifest_commit` 在远程项目上闭环，能标 stale。

**依赖**：W5、W7。

**改动**

- `src/host/memory.js`：远程 sync 分支；
- 新增 `src/host/remote/indexer.js`（扫描/同步部分）；
- `src/host/graph.js`：锚点刷新；
- 新增 `test/remote-sync.test.mjs`。

**步骤**

1. 远程 `scan`：`listTree` + 只对 manifest 文件 `hashMany`；新增/删除靠路径差；
2. `cosmetic` 恒为 0（内容变化一律视为代码变化）；
3. `affectedNodes` 用锚点 + manifest 哈希比较；
4. `markStale` 复用现有逻辑；
5. `commit`：只对提交路径远程哈希，更新 manifest（本地）；
6. 写 `projects/<id>/remote-state.json` 的 pending（可选，W10 用）。

**验证**

```sh
node --test test/remote-sync.test.mjs
npm test
```

- [ ] 夹具远程项目：全量 sync 计数正确；
- [ ] 改一个文件：只报告该文件，affected 节点正确，`markStale` rev +1；
- [ ] 新增/删除文件计数正确；
- [ ] `commit` 后再次 sync 为 0；
- [ ] 锚点 hash 刷新后 affected 归零；
- [ ] fake ssh 日志无 `cat`/`sed`/`head`（同步不拉内容）；
- [ ] 本地测试全过。

**通过标准**：远程增量正确、保守、不传内容。  
**失败/回滚**：远程 sync 关闭，工具仍可读；不得破坏 manifest。

---

### W9 · 面板来源与状态

**目标**：面板能在「本地 / 远程项目」之间切换，显示远程状态；本地行为不变。

**依赖**：W1、W8。

**改动**

- `client.js`：读 `.archmap/index.json`、来源选择器、按项目路径读图/状态、位置键、状态条、错误/回退；
- `locale/en.json`、`locale/zh.json`；
- 不新增网络路由。

**步骤**

1. `readIndex`：`workspaceFiles.read(sessionId, '.archmap/index.json')`；缺失/损坏 → 本地单图 + 提示；
2. 来源选择器：本地 + 远程项目；选择存 `localStorage`（键含 cwd + source id）；
3. 图路径：本地 `.archmap/graph.json`；远程 `.archmap/projects/<id>/graph.json`；
4. 状态条：来源、HEAD、dirty、pending、最后检查、授权状态；读 `remote-state.json`；
5. 位置键加 source id，避免互相覆盖；
6. 保持 2 秒轮询。

**验证**

```sh
npm run check
node --check client.js
```

手工矩阵（用临时工作区 + 假 graph/index，或真实远程）：

- [ ] 无 `index.json`：只显示本地，与改造前一致；
- [ ] 有本地 + 远程条目：可切换，两张图分别正确；
- [ ] 远程项目没有图：空态 + 引导文案；
- [ ] `index.json` 损坏：回退本地 + 错误提示，不白屏；
- [ ] 切换后节点位置不串；
- [ ] 状态条随 `remote-state.json` 更新；
- [ ] 只通过 `workspaceFiles` 读，无新请求路径。

**通过标准**：本地无回归；远程可看；错误态可恢复。  
**失败/回滚**：面板回到单图模式，保留远程工具。

---

### W10 · 变更轮询与自动维护

**目标**：远程变更自动检测、标 stale；满足条件时自动起维护子会话；命令可用。

**依赖**：W6、W8、W9。

**改动**

- `src/host/remote/indexer.js`：指纹轮询、退避、pending、state；
- 新增 `src/host/remote/commands.js`：`/arch remote ...` 处理器（可注入测试）；
- 新增 `src/host/remote/maintainer.js`：条件判断、prompt、子会话启动、限制；
- `src/host/plugin.js`：注册命令、选择/更新入口；
- 新增 `test/remote-indexer.test.mjs`、`test/remote-commands.test.mjs`、`test/remote-maintainer.test.mjs`。

**步骤**

1. 轮询：git 60 秒、非 git 300 秒（W11 细化）；失败指数退避，最长 15 分钟；同项目不并发；
2. 检测到变更：`sync` + `markStale` + 写 `remote-state.json`；
3. 命令：`add/list/select/sync/update/grant/revoke/remove`；
4. 自动维护条件：workspace 授权、autoRefresh、pending ≤50、距上次 ≥10 分钟、单实例、有活跃父会话；否则只提示；
5. 维护子会话：`spawn`、prompt 带变更清单、禁止 bash/write/edit/apply_patch/terminal、完成后写状态；
6. 失败：记录 `lastError`，不自动重试；面板可见。

**验证**

```sh
node --test test/remote-indexer.test.mjs
node --test test/remote-commands.test.mjs
node --test test/remote-maintainer.test.mjs
npm test
```

- [ ] 指纹变化 → pending + stale + rev 增加；
- [ ] 无变化不写 state、不 bump rev；
- [ ] 连接失败退避、不清图、不误报；
- [ ] 命令 add/list/select/sync/update/revoke/remove 行为正确；
- [ ] 自动维护条件矩阵：缺授权/超 50 文件/10 分钟内/已有实例/无活跃会话都不启动；
- [ ] 启动时是 `spawn`、工具被限制、prompt 含变更清单与 remote id；
- [ ] 仅“本次会话”授权时不自动启动；
- [ ] 子会话失败写 `lastError`，不无限重试；
- [ ] 插件卸载/停止后定时器清理。

**通过标准**：刷新闭环 + 上限与授权严格。  
**失败/回滚**：关闭自动维护（保留手动 Sync/Update），不影响读取与面板。

---

### W11 · 非 git 兜底与安全加固

**目标**：非 git 远程可用；安全与失败模式补齐。

**依赖**：W10。

**改动**

- `src/host/remote/content.js`、`indexer.js`：非 git 索引；
- `src/host/remote/ssh.js`：安全校验/输出上限；
- 新增 `test/remote-nongit.test.mjs`、`test/remote-security.test.mjs`；
- 文档更新。

**步骤**

1. 非 git：路径 + 大小 + mtime 索引（`remote-index.json`，只元数据）；定期全量路径兜底删除；变更文件按需哈希；
2. 安全：路径规范化 + root 包含；不跟随 root 外符号链接；输出/文件数/字节上限；主机未知/权限拒绝清晰报错；
3. 失败：远程断开、路径消失、授权撤销中途、超大输出、二进制、编码错误；
4. 文档：README/PLAN 补远程说明；故障排查。

**验证**

```sh
node --test test/remote-nongit.test.mjs
node --test test/remote-security.test.mjs
npm test
```

- [ ] 非 git 目录：首次索引、改文件、加文件、删文件都能检测；
- [ ] 非 git 的变更检测不读取内容；
- [ ] 路径 `../x`、绝对路径、NUL/换行、root 外符号链接被拒绝；
- [ ] 主机未知/权限拒绝/超时错误可读；
- [ ] 输出超限有截断标记；
- [ ] 撤销授权后正在进行的读取停止；
- [ ] fake ssh 日志无写命令。

**通过标准**：非 git 可用；安全清单全过。  
**失败/回滚**：非 git 标记为实验性，git 路径不受影响。

---

### W12 · 端到端验收

**目标**：真远程跑通完整闭环；文档与架构图收尾。

**依赖**：W11。

**步骤（人工）**

1. 本地基线：`npm run check && npm test`，本地面板正常；
2. 真远程添加：`/arch remote add staging <host> /tmp/archmap-remote`；
3. 首次读：授权卡出现；**拒绝** → 无内容；**本次会话** → 可读；**始终允许** → index 记录；
4. 建档：让 agent 读几个文件、建 3–5 个节点、写 overview；图落在 `.archmap/projects/staging/`；
5. 远程无写入：`ssh <host> 'git -C /tmp/archmap-remote status --porcelain'` 与操作前一致；
6. 变更刷新：在远程改一个文件 → 60 秒内面板出现 stale/pending；满足条件时自动维护子会话运行并更新图；
7. 上限：一次改 >50 文件 → 只提示，不自动改图；
8. 撤销：`/arch remote revoke staging` → 再读触发询问，自动维护停止；
9. 重启应用：index/图/始终授权还在；本次会话授权失效；
10. 非 git：另一个非 git 目录重复 2–8（可简化）；
11. 本地回归：本地项目图/档案/导出与 W0 一致；`npm test` 全绿。

**验证记录**：§7 最后一行 + 真远程输出摘要。  
**通过标准**：11 项全过；远程 `git status` 无变化；无本地源码副本。  
**失败处理**：回到对应节点修复，重新从该节点验证，不直接发布。

---

## 5. 架构图节点登记

每落地一个工作节点，就在 `.archmap` 图里登记对应节点（先用 `status: "proposed"`，验证通过后改 `fresh` 并 `refreshAnchors`）。这样“节点验证”同时是代码验证和图验证。

| 计划节点 | 标题 | 类型 | 分组 | 锚点文件（落地后） | 落地于 | 验证 |
|---|---|---|---|---|---|---|
| n9 | Project index | module | g-host | `src/host/projects.js`, `src/host/workspace.js` | W1 | 锚点 hash + 本地回归 |
| n10 | Content source | module | g-host | `src/host/content/index.js`, `src/host/content/local.js` | W2 | scan/hash 与旧实现一致 |
| n11 | Remote transport | module | g-host | `src/host/remote/ssh.js` | W3 | 注入/超时测试 |
| n12 | Remote content source | module | g-host | `src/host/remote/content.js` | W4 | 与本地对齐 |
| n13 | Consent gate | module | g-host | `src/host/remote/consent.js` | W6 | 状态机测试 |
| n14 | Remote read tools | module | g-host | `src/host/remote/tools.js` | W7 | 授权 + 工具测试 |
| n15 | Remote indexer | module | g-host | `src/host/remote/indexer.js` | W8/W10 | 同步/轮询测试 |
| n16 | Remote maintainer | module | g-host | `src/host/remote/maintainer.js` | W10 | 条件矩阵 + 子会话 |

建议边（落地时按实际调用关系补）：

- `n1 → n9`（注册项目解析）、`n1 → n14`（注册远程工具）；
- `n14 → n12`（读内容）、`n14 → n13`（先授权）；
- `n12 → n11`（传输）；
- `n15 → n12`（索引/哈希）、`n15 → n2`（标 stale）；
- `n16 → n15`（变更驱动维护）、`n16 → n8`（沿用 skill）；
- `n2 → n10`、`n3 → n10`、`n9 → n10`、`n9 → n12`、`n5 → n9`。

验证方法：

1. `arch_graph_patch` 新增/更新节点，带 `path`（可暂不带 hash）；
2. `refreshAnchors: true` 刷新；hash 必须存在；
3. `arch_graph_get` 看节点摘要与代码一致；
4. 测试通过后把 `status` 改为 `fresh`；失败保持 `proposed`/`stale`。

---

## 6. 每节点的完成定义（DoD）

一个节点算“完成”，必须同时满足：

- 代码改动只在本文列出的文件（超出则先更新本文）；
- `npm run check && npm test` 全绿；
- 该节点专项验证全过；
- 本地工作流零回归（有基线对比）；
- 没有远程写、没有本地源码副本；
- 架构图对应节点已登记并能刷新锚点；
- §7 有验证记录（日期、命令、结果、通过）；
- 文档/注释/错误信息已更新（涉及用户可见行为时）。

---

## 7. 验证记录

每完成一个节点，追加一行；**没有记录视为未验证，不得进入下一节点**。

| 节点 | 开始日期 | 验证日期 | 验证命令/步骤 | 结果摘要 | 通过 | 备注 |
|---|---|---|---|---|---|---|
| W0 | 2026-11-22 | 2026-11-22 | `npm run check && npm test` | 7/7 pass；基线 `d501c41`，graph rev 7 / 8 nodes / 8 edges | ☑ | worktree `feature/remote-source` |
| W1 | 2026-11-22 | 2026-11-22 | `node --test test/projects.test.mjs`；`npm run check && npm test` | 5/5 + 12/12 pass；本地 graph rev 7 / 8 nodes / 8 edges 不变；远程项目落到 `.archmap/projects/staging/` | ☑ | 远程 sync/commit 仍失败关闭，W8 接 |
| W2 | 2026-11-22 | 2026-11-22 | `node --test test/content-local.test.mjs`；`npm run check && npm test`；新旧 scan 对拍 | 5/5 + 17/17 pass；旧 `memory.scan` 与新 `content.scan` 输出完全一致；13 个锚点 0 mismatch；`.git` worktree 文件被跳过 | ☑ | 纯重构；本地格式/行为未变 |
| W3 | 2026-11-22 | 2026-11-22 | `node --test test/remote-ssh.test.mjs`；`npm run check && npm test` | 7/7 + 24/24 pass；引号/超时/取消/输出上限/鉴权错误映射全过；假 SSH 不连网 | ☑ | 无远程写命令 |
| W4 | 2026-11-22 | 2026-11-22 | `node --test test/remote-content.test.mjs`；`npm run check && npm test` | 7/7 + 31/31 pass；git/非 git 的 list、hash/describe、分页读、grep、fingerprint；只传哈希不传内容；无写命令 | ☑ | 非 git 指纹目前哈希全量文件，W11 优化 |
| W5 | 2026-11-22 | 2026-11-22 | `node --test test/remote-project.test.mjs`；`npm run check && npm test` | 3/3 + 34/34 pass；远程建图锚点=远端 sha256；数据在 `.archmap/projects/staging/`；doc/export 正常；假 SSH 日志无写命令；sync/commit 仍关闭 | ☑ | 远程内容只经哈希/元数据，不落源码 |
| W6 | 2026-11-22 | 2026-11-22 | `node --test test/remote-consent.test.mjs`；`npm run check && npm test` | 6/6 + 40/40 pass；首次问一次、始终写入 index、拒绝/跳过零授权、无 userQuestions 失败关闭、撤销、子会话继承、自动维护仅 workspace 授权 | ☑ | 问题只含 host/root，不含文件内容 |
| W7 | 2026-11-22 | 2026-11-22 | `node --test test/remote-tools.test.mjs`；`node --test test/plugin-registration.test.mjs`；`npm run check && npm test` | 5/5 + 1/1 + 46/46 pass；list/status 不询问；tree/read/grep 首次询问；拒绝/无服务时零内容；skill 与双 README 已更新 | ☑ | 讨论子会话限制在 W12 手工确认 |
| W8 | | | `node --test test/remote-sync.test.mjs` | | ☐ | |
| W9 | | | `node --check client.js` + 手工矩阵 | | ☐ | |
| W10 | | | `node --test test/remote-{indexer,commands,maintainer}.test.mjs` | | ☐ | |
| W11 | | | `node --test test/remote-{nongit,security}.test.mjs` | | ☐ | |
| W12 | | | §4 W12 的 11 项 + 真远程 | | ☐ | |

---

## 8. 失败处理与回滚

| 情况 | 处理 |
|---|---|
| 本地测试回归 | 停在本节点，恢复改动；不得用远程分支掩盖 |
| SSH 命令注入/越界 | 视为 W3 失败；修 quote/校验；补测试 |
| 授权被绕过 | 视为 W6 失败；默认拒绝；不得上线 |
| 同步误报/漏报 | 停在 W8；先保守（全部标 stale）再优化 |
| 自动维护失控 | 关闭 autoRefresh（保留手动）；修条件矩阵 |
| 远程数据损坏 | 用 `graph.bak.json` 恢复；检查锁与 rename |
| 非 git 不可用 | 标记实验性，git 路径继续 |
| 真远程验收失败 | 回到对应节点；重新验证该节点及后续受影响节点 |

---

## 9. 变更控制

- 任何超出本文档的改动，先在本文档更新节点/文件/验证，再动代码；
- 节点顺序调整必须说明依赖原因；
- 新增决策（例如多远程、远程写回）属于范围变更，单独评审，不插入当前节点；
- W12 通过前不发布“远程功能可用”的说明。

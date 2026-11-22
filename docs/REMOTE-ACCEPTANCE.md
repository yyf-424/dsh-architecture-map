# 远程仓库端到端验收（W12）

> 适用：main `aad374b`（W0–W11 已完成）
> 前置：完全退出并重开 DSH；一台**非生产** Linux 机器；SSH key/known_hosts 已配好；本地 hub 工作区。

本清单验证真实远程上的只读读取、授权、建图、增量刷新、自动维护、撤销、重启和非 git 兜底。每一步记录“通过/失败 + 现象”。

---

## 0. 远程准备

在远程创建一个小仓库（只读验收，不改生产代码）：

```sh
ssh <host> '
  rm -rf /tmp/archmap-acceptance
  mkdir -p /tmp/archmap-acceptance/src
  cd /tmp/archmap-acceptance
  printf "# Acceptance\n" > README.md
  printf "export function greet(name) { return \"hi \" + name }\n" > src/app.js
  printf "export const version = 1\n" > src/version.js
  git init -q
  git add -A
  git -c user.email=acceptance@example.com -c user.name=Acceptance commit -qm init
  git status --porcelain
'
```

预期：`git status --porcelain` 无输出（干净）。

再准备一个非 git 目录：

```sh
ssh <host> '
  rm -rf /tmp/archmap-acceptance-nongit
  mkdir -p /tmp/archmap-acceptance-nongit
  printf "export const a = 1\n" > /tmp/archmap-acceptance-nongit/a.js
  printf "export const b = 2\n" > /tmp/archmap-acceptance-nongit/b.js
'
```

确认远程工具：

```sh
ssh <host> 'command -v git; command -v sha256sum; command -v readlink; command -v stat; uname -s'
```

---

## 0.1 快速只读 smoke（可选，替代重复手工探针）

在本地仓库执行：

```sh
node scripts/w12-smoke.mjs <host> /tmp/archmap-acceptance /tmp/archmap-acceptance-nongit
```

它只做 probe、tree、fingerprint、describe、read、readRange、grep、stat，不修改远程。全部 PASS 后，再继续下面的授权/建图/刷新步骤。

---

## 1. 本地基线与 hub

1. 本地仓库：

```sh
cd /Users/yyf/project/dsh-architecture-map
npm run check && npm test
```

预期：`64/64` 通过。

2. 打开一个本地 hub 工作区（空目录即可）：

```
/Users/yyf/project/remote-acceptance-hub
```

3. 在 hub 会话里执行：

```
/arch remote add acceptance <host> /tmp/archmap-acceptance
```

预期：返回 `vcs git`；`.archmap/index.json` 出现 `acceptance`。
（如果放在已有本地项目里，也会写进那个项目的 `.archmap`。）

4. 列出：

```
/arch remote list
```

预期：`acceptance · ssh <host>:/tmp/archmap-acceptance · vcs git · consent none`。

---

## 2. 面板与来源

1. 打开 `/arch`。
2. 来源选择器应有「本地」和 `acceptance`。
3. 选 `acceptance`：状态行显示 host/root/vcs/授权；没有图时显示远程空状态，不应出现“图不可用”。

---

## 3. 授权（进入上下文前）

1. 让 agent 调用 `arch_remote_tree`（例如：“用 arch_remote_tree 看一下 acceptance”）。
2. 第一次调用应弹出授权卡：
   - **拒绝** → 工具报未授权，**没有任何文件内容**；
   - 再调用 → **允许，本次会话** → 能返回目录树；
   - 另一个会话再读 → 又会询问；
   - 选择 **始终允许这个远程** → `.archmap/index.json` 的 `acceptance.consent.scope` 为 `workspace`。

3. 撤销：

```
/arch remote revoke acceptance
```

之后再读应重新询问；自动维护应停止。

---

## 4. 远程建图

1. 让 agent 用 `arch_remote_tree` / `arch_remote_read` / `arch_remote_grep` 读 `README.md`、`src/app.js`、`src/version.js`。
2. 建 3–5 个节点和图：

```
arch_graph_patch({ workspace: "remote:acceptance", baseRev: 0, ops: [...] })
arch_doc_put({ workspace: "remote:acceptance", id: "overview", content: "..." })
arch_manifest_commit({ workspace: "remote:acceptance", paths: ["README.md","src/app.js","src/version.js"] })
```

预期：

- 图出现在 `/arch` 的 `acceptance` 来源；
- 数据在本地 hub 的 `.archmap/projects/acceptance/`；
- 远程 `ssh <host> 'cd /tmp/archmap-acceptance && git status --porcelain'` 仍然无输出；
- 本地 hub 不出现远程源码副本（只有 graph/manifest/dossiers/state）。

---

## 5. 远程变更 → 自动刷新

1. 确保来源 `acceptance` 被面板选中（会启动轮询）；并且已选“始终允许”。
2. 修改远程一个已分析文件：

```sh
ssh <host> 'cd /tmp/archmap-acceptance && printf "export const version = 2\n" > src/version.js'
```

3. 等待 ≤60 秒，或执行：

```
/arch remote sync acceptance
```

预期：

- 面板对应节点变为 stale；
- `.archmap/projects/acceptance/remote-state.json` 的 `pending` 增加；
- 满足条件时自动起维护子会话（≤50 文件、10 分钟冷却、workspace 授权），子会话结束后用 `arch_manifest_commit` 更新；
- 可手动 `/arch remote update acceptance` 强制起维护子会话。

4. 再查远程 `git status --porcelain` 仍然只有 `src/version.js` 的修改，没有插件写入。

---

## 6. 上限与冷却

1. 修改超过 50 个文件（例如循环写 `bulk-1..60.js`）。
2. `/arch remote sync acceptance` 或等待轮询：

预期：只标 stale/提示，不自动起维护子会话；`/arch remote update` 也应拒绝（too-many-files）。

清理这些测试文件，再 `git checkout -- .` 恢复远程。

---

## 7. 重启与持久化

1. 完全退出并重开 DSH。
2. 打开同一 hub：
   - `.archmap/index.json` 和 `projects/acceptance/` 仍在；
   - “始终允许”的 workspace 授权仍在；
   - 来源选择和图仍在；
   - 只选过“本次会话”的授权应失效，再次读取会询问。

---

## 8. 非 git 兜底

1. `/arch remote add nongit <host> /tmp/archmap-acceptance-nongit`
2. 读取、建图、修改远程 `a.js`。
3. 等待轮询或 `/arch remote sync nongit`：

预期：变化被检测到（path/size/mtime 指纹），不会为了检测而哈希整个目录内容；节点 stale。

---

## 9. 安全边界

1. 远程创建指向 root 外的符号链接：

```sh
ssh <host> 'ln -sf /etc/hostname /tmp/archmap-acceptance/leak.txt'
```

2. 调用 `arch_remote_read` 读 `leak.txt`：

预期：返回 `PATH_ESCAPE`/拒绝，不返回 `/etc/hostname` 内容。

3. 尝试 `../`、绝对路径：同样拒绝。
4. 删除该链接。

---

## 10. 本地回归

1. 打开原来的本地项目，`/arch` 本地图、档案、导出仍正常。
2. `npm run check && npm test` 仍为 `64/64`。
3. 远程验收没有在本地生成源码副本。

---

## 记录表

| 步骤 | 结果 | 现象/截图 |
|---|---|---|
| 0 远程准备 | | |
| 1 添加/list | | |
| 2 面板来源 | | |
| 3 授权拒绝/本次/始终/撤销 | | |
| 4 远程建图 + 远程无写入 | | |
| 5 变更 stale + 自动维护 | | |
| 6 >50 文件上限 | | |
| 7 重启持久化 | | |
| 8 非 git | | |
| 9 符号链接/路径逃逸 | | |
| 10 本地回归 | | |

## 回传

把每一步的结果、失败步骤的现象（截图/错误文本）发回来；如果有一步失败，W12 不通过，回到对应节点修复后重跑。

/**
 * Architecture map — Client half.
 *
 * Node 1: right-sidebar tab + /arch + auto-open.
 * Node 3: the tab reads `<session workspace>/.archmap/graph.json` through the
 * workspaceFiles Remote and renders a small, dependency-free SVG map with
 * node details. React Flow comes later.
 */
window.__ModuleLoader__.load({
  id: 'dsh-architecture-map',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TYPE_ID = 'dsh-architecture-map/graph'
    const GRAPH_PATH = '.archmap/graph.json'
    const INDEX_PATH = '.archmap/index.json'
    const POLL_MS = 2000
    const POSITIONS_KEY = 'dsh-architecture-map:positions:'
    const SOURCE_KEY = 'dsh-architecture-map:source:'
    const MERMAID_CONFIG_URL = '/x-dsh-architecture-map/config'
    const LOCALE_NS = 'architecture-map'
    const EN = {
      'panel.title': 'Architecture map',
      'panel.refresh': 'Refresh',
      'panel.fit': 'Fit',
      'panel.reset': 'Reset layout',
      'panel.hint': 'drag to pan · wheel to zoom',
      'panel.empty': 'Click a node to see its summary, anchors and edges.',
      'panel.error': 'Graph unavailable',
      'panel.noGraphRemote': 'No graph yet for this remote project.',
      'panel.remoteHint': 'Ask the agent to create one with arch_graph_patch (workspace: remote:<id>).',
      'panel.indexError': 'Project index unavailable; showing the local graph.',
      'panel.noGraph': 'no graph',
      'source.label': 'Source',
      'source.local': 'Local',
      'source.consent': 'consent',
      'legend.fresh': 'fresh',
      'legend.stale': 'stale',
      'legend.proposed': 'proposed',
      'discuss.fork': 'Discuss (fork)',
      'discuss.lite': 'Lite',
      'discuss.starting': 'Starting…',
      'discuss.hint': 'Tool schemas may be inherited, but shell and source-write calls are denied for discussion children; graph changes still need your approval.',
      'detail.kind': 'kind',
      'detail.group': 'group',
      'detail.status': 'status',
      'guide.title': 'Architecture map',
      'guide.description': 'Open the live architecture graph panel',
    }
    const ZH = {
      'panel.title': '架构地图',
      'panel.refresh': '刷新',
      'panel.fit': '适配',
      'panel.reset': '重置布局',
      'panel.hint': '拖动平移 · 滚轮缩放',
      'panel.empty': '点击节点查看摘要、锚点和边。',
      'panel.error': '图不可用',
      'panel.noGraphRemote': '这个远程项目还没有图。',
      'panel.remoteHint': '让 agent 用 arch_graph_patch（workspace: remote:<id>）创建一张。',
      'panel.indexError': '项目索引不可用，已回退到本地图。',
      'panel.noGraph': '暂无图',
      'source.label': '来源',
      'source.local': '本地',
      'source.consent': '授权',
      'legend.fresh': '有效',
      'legend.stale': '过期',
      'legend.proposed': '提案',
      'discuss.fork': '讨论（fork）',
      'discuss.lite': '轻讨论',
      'discuss.starting': '启动中…',
      'discuss.hint': '子会话可能继承工具 schema，但 shell 和源码写调用会被拒绝；改图仍需你确认。',
      'detail.kind': '类型',
      'detail.group': '分组',
      'detail.status': '状态',
      'guide.title': '架构地图',
      'guide.description': '打开实时架构图面板',
    }
    let t = key => EN[key] ?? key
    const MERMAID_RUNTIME_URL = '/x-dsh-architecture-map/vendor/mermaid.esm.min.mjs'

    const styles = {
      root: {
        height: '100%',
        boxSizing: 'border-box',
        padding: '16px',
        fontFamily: 'inherit',
        color: 'var(--dsw-alias-text-primary, inherit)',
        background: 'var(--dsw-alias-bg-primary, transparent)',
        overflow: 'auto',
      },
      header: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '12px',
      },
      title: {
        fontSize: '15px',
        fontWeight: 600,
        margin: 0,
      },
      meta: {
        fontSize: '12px',
        opacity: 0.68,
      },
      button: {
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '6px',
        padding: '3px 8px',
        fontSize: '12px',
        cursor: 'pointer',
      },
      select: {
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
        background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.08))',
        color: 'inherit',
        borderRadius: '6px',
        padding: '3px 6px',
        fontSize: '12px',
        maxWidth: '220px',
      },
      sourceBar: {
        fontSize: '11px',
        opacity: 0.7,
        margin: '-4px 0 10px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      empty: {
        border: '1px dashed var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
        borderRadius: '10px',
        padding: '20px',
        fontSize: '13px',
        lineHeight: 1.6,
        opacity: 0.8,
      },
      error: {
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
        borderRadius: '10px',
        padding: '12px 14px',
        fontSize: '12px',
        lineHeight: 1.5,
        marginBottom: '12px',
        opacity: 0.85,
      },
      toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      },
      canvas: {
        width: '100%',
        height: 'auto',
        display: 'block',
        overflow: 'visible',
        touchAction: 'none',
        cursor: 'grab',
        userSelect: 'none',
      },
      detail: {
        marginTop: '14px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
        borderRadius: '10px',
        padding: '12px 14px',
        fontSize: '12px',
        lineHeight: 1.6,
      },
      detailTitle: {
        fontSize: '13px',
        fontWeight: 600,
        margin: '0 0 6px',
      },
      detailRow: {
        margin: '2px 0',
        opacity: 0.85,
      },
      mono: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
      },
      discussRow: {
        display: 'flex',
        gap: '8px',
        marginTop: '10px',
        flexWrap: 'wrap',
      },
      discussError: {
        marginTop: '8px',
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-danger, #d9534f)',
      },
      discussHint: {
        marginTop: '6px',
        fontSize: '11px',
        lineHeight: 1.4,
        opacity: 0.6,
      },
      mermaid: {
        overflow: 'auto',
        maxWidth: '100%',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.25))',
        borderRadius: '8px',
        padding: '8px',
        background: 'var(--dsw-alias-bg-primary, transparent)',
      },
      mermaidError: {
        marginTop: '6px',
        fontSize: '12px',
        lineHeight: 1.5,
        opacity: 0.72,
        color: 'var(--dsw-alias-warning, #c58a1a)',
      },
      legend: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        margin: '0 0 8px',
        fontSize: '11px',
        opacity: 0.72,
        flexWrap: 'wrap',
      },
      legendItem: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      },
      legendDot: {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        display: 'inline-block',
      },
    }

    function clip(text, max) {
      const value = String(text ?? '')
      return value.length <= max ? value : `${value.slice(0, max - 1)}…`
    }

    /** Clip to a pixel budget (CJK counts as a full em, ASCII as ~0.58 em). */
    function clipWidth(text, maxWidth, fontSize = 13) {
      const value = String(text ?? '')
      let width = 0
      let out = ''
      for (const char of value) {
        const charWidth = char.charCodeAt(0) > 255 ? fontSize : fontSize * 0.58
        if (width + charWidth > maxWidth - fontSize) return `${out}…`
        out += char
        width += charWidth
      }
      return out
    }

    /**
     * A local drag only replaces the x/y of the automatic layout box; width,
     * height and every undragged node still come from the layout.
     */
    function overlayPosition(base, override) {
      if (!base) return undefined
      if (!override || !Number.isFinite(override.x) || !Number.isFinite(override.y)) return base
      return { ...base, x: override.x, y: override.y }
    }

    /** The panel's Discuss/Lite path must carry the selected source, not the session cwd. */
    function discussionCommand(id, mode, workspace) {
      return `/arch discuss node:${id} ${mode}${workspace ? ` ${workspace}` : ''}`
    }

    let mermaidRuntime
    let mermaidUid = 0

    /**
     * Load the vendored Mermaid ESM once. The Host's /config route is the
     * renderMermaid switch: when it is false, fences stay plain code blocks and
     * the 5 MB runtime is never fetched.
     */
    function loadMermaidRuntime() {
      if (mermaidRuntime) return mermaidRuntime
      const dynamicImport = typeof globalThis.__dshMermaidImport === 'function'
        ? globalThis.__dshMermaidImport
        : specifier => import(/* @vite-ignore */ specifier)
      mermaidRuntime = fetch(MERMAID_CONFIG_URL, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`Mermaid config unavailable (${response.status})`)
          return response.json()
        })
        .then(config => {
          if (config?.mermaid === false) throw new Error('Mermaid rendering is disabled')
          return dynamicImport(new URL(MERMAID_RUNTIME_URL, document.baseURI).href)
        })
        .then(module => {
          const api = module.default ?? module
          const dark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true
          api.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: dark ? 'dark' : 'default',
            fontFamily: 'inherit',
            flowchart: { htmlLabels: true, curve: 'basis' },
          })
          return api
        })
        .catch(error => {
          console.warn('[architecture-map] Mermaid runtime unavailable:', error)
          throw error
        })
      return mermaidRuntime
    }

    /** Keep a Mermaid render failure inside the fence instead of the whole page. */
    class MermaidErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        console.warn('[architecture-map] Mermaid fence failed:', error)
      }
      render() {
        return this.state.failed ? this.props.fallback : this.props.children
      }
    }

    /** Chat fence renderer for ```mermaid blocks. Falls back to the code block. */
    function MermaidInner(props) {
      const code = typeof props.code === 'string' ? props.code : ''
      const streaming = props.streaming === true
      const fallback = props.children ?? null
      const [result, setResult] = React.useState({ status: 'idle', svg: null, error: null, renderError: false })

      React.useEffect(() => {
        if (streaming || code.trim() === '') return undefined
        let disposed = false
        setResult(previous => ({ ...previous, status: 'loading', error: null, renderError: false }))
        const id = `archmap-mermaid-${++mermaidUid}`
        loadMermaidRuntime()
          .then(api => api.render(id, code))
          .then(rendered => {
            if (!disposed) setResult({ status: 'ready', svg: rendered.svg, error: null, renderError: false })
          })
          .catch(error => {
            if (disposed) return
            const message = String(error?.message ?? error)
            const renderError = !/disabled/i.test(message)
            setResult({ status: 'error', svg: null, error: message, renderError })
          })
        return () => { disposed = true }
      }, [code, streaming])

      if (streaming || result.status !== 'ready') {
        return h(React.Fragment, null,
          fallback,
          result.renderError && result.error
            ? h('div', { style: styles.mermaidError }, `Mermaid: ${result.error}`)
            : null,
        )
      }
      return h('div', { style: styles.mermaid, dangerouslySetInnerHTML: { __html: result.svg } })
    }

    function MermaidFence(props) {
      return h(MermaidErrorBoundary, { fallback: props.children ?? null }, h(MermaidInner, props))
    }

    function readSavedPositions(key) {
      if (!key) return {}
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return {}
        const result = {}
        for (const [id, value] of Object.entries(parsed)) {
          if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) result[id] = { x: value.x, y: value.y }
        }
        return result
      } catch {
        return {}
      }
    }

    function writeSavedPositions(key, value) {
      if (!key) return
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Local storage can be unavailable in private contexts; positions are a view preference.
      }
    }

    function clearSavedPositions(key) {
      if (!key) return
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore: the in-memory layout still resets.
      }
    }

    function localSource() {
      return { id: 'local', kind: 'local', label: t('source.local'), graphPath: GRAPH_PATH, meta: '' }
    }

    function sourcesFromIndex(index) {
      const projects = Array.isArray(index?.projects) ? index.projects : []
      const sources = []
      for (const project of projects) {
        if (!project || typeof project.id !== 'string') continue
        if (project.kind === 'local') {
          sources.push(localSource())
          continue
        }
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(project.id)) continue
        const safeDir = typeof project.dir === 'string'
          && project.dir !== ''
          && !project.dir.startsWith('/')
          && !project.dir.split('/').includes('..')
          ? project.dir
          : `projects/${project.id}`
        const parts = [
          project.host,
          project.root,
          project.vcs,
          `${t('source.consent')} ${project.consent?.scope ?? 'none'}`,
        ].filter(Boolean)
        sources.push({
          id: project.id,
          kind: 'remote',
          label: project.title || project.id,
          graphPath: `.archmap/${safeDir}/graph.json`,
          meta: parts.join(' · '),
        })
      }
      const local = sources.find(source => source.kind === 'local')
      const rest = sources.filter(source => source.kind !== 'local')
      return local ? [local, ...rest] : [localSource(), ...rest]
    }

    function isMissingFile(error) {
      const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
      return text.includes('enoent')
        || text.includes('not found')
        || text.includes('not_found')
        || text.includes('fs_not_found')
        || text.includes('no entry at')
        || text.includes('does not exist')
    }

    function readSavedSource(cwd) {
      if (!cwd) return null
      try {
        return window.localStorage.getItem(SOURCE_KEY + cwd)
      } catch {
        return null
      }
    }

    function writeSavedSource(cwd, id) {
      if (!cwd) return
      try {
        window.localStorage.setItem(SOURCE_KEY + cwd, id)
      } catch {
        // Source choice is a view preference; the in-memory selection still works.
      }
    }

    function gridLayout(nodes) {
      const count = Math.max(nodes.length, 1)
      const cols = Math.min(2, Math.max(1, Math.ceil(Math.sqrt(count))))
      const rows = Math.ceil(nodes.length / cols)
      const cellW = 236
      const cellH = 108
      const pad = 18
      const nodeW = 196
      const nodeH = 64
      const positions = new Map()
      nodes.forEach((node, index) => {
        positions.set(node.id, {
          x: pad + (index % cols) * cellW,
          y: pad + Math.floor(index / cols) * cellH,
          w: nodeW,
          h: nodeH,
        })
      })
      return {
        positions,
        width: cols * cellW + pad,
        height: Math.max(rows * cellH + pad, 96),
      }
    }

    /**
     * Layered layout: longest-path levels for a DAG. Cyclic graphs fall back to
     * the grid so a bad edge cannot collapse the canvas into one column.
     * Pinned `node.position` values are applied afterwards by `layout`.
     */
    function autoLayout(graph) {
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
      if (nodes.length === 0) return { positions: new Map(), width: 0, height: 96 }
      const ids = new Set(nodes.map(node => node.id))
      const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
        .filter(edge => ids.has(edge.from) && ids.has(edge.to))
      if (edges.length === 0) return gridLayout(nodes)
      const indegree = new Map(nodes.map(node => [node.id, 0]))
      const outgoing = new Map(nodes.map(node => [node.id, []]))
      for (const edge of edges) {
        outgoing.get(edge.from).push(edge.to)
        indegree.set(edge.to, indegree.get(edge.to) + 1)
      }
      const queue = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id)
      const levels = new Map(nodes.map(node => [node.id, 0]))
      let visited = 0
      while (queue.length > 0) {
        const id = queue.shift()
        visited += 1
        for (const to of outgoing.get(id)) {
          levels.set(to, Math.max(levels.get(to), levels.get(id) + 1))
          indegree.set(to, indegree.get(to) - 1)
          if (indegree.get(to) === 0) queue.push(to)
        }
      }
      if (visited !== nodes.length) return gridLayout(nodes)

      const byLevel = new Map()
      for (const node of nodes) {
        const level = levels.get(node.id) ?? 0
        if (!byLevel.has(level)) byLevel.set(level, [])
        byLevel.get(level).push(node)
      }
      const direction = String(graph?.layout?.direction ?? 'LR').toUpperCase()
      const horizontal = direction !== 'TB' && direction !== 'TD' && direction !== 'BT'
      const nodeW = 196
      const nodeH = 64
      const layerGap = 54
      const nodeGap = 26
      const pad = 24
      const layerCount = Math.max(...byLevel.keys()) + 1
      const widest = Math.max(...[...byLevel.values()].map(list => list.length), 1)
      const width = horizontal
        ? pad * 2 + layerCount * nodeW + (layerCount - 1) * layerGap
        : pad * 2 + widest * nodeW + (widest - 1) * nodeGap
      const height = horizontal
        ? pad * 2 + widest * nodeH + (widest - 1) * nodeGap
        : pad * 2 + layerCount * nodeH + (layerCount - 1) * layerGap
      const positions = new Map()
      for (const [level, list] of byLevel) {
        list.forEach((node, index) => {
          positions.set(node.id, {
            x: horizontal ? pad + level * (nodeW + layerGap) : pad + index * (nodeW + nodeGap),
            y: horizontal ? pad + index * (nodeH + nodeGap) : pad + level * (nodeH + layerGap),
            w: nodeW,
            h: nodeH,
          })
        })
      }
      return { positions, width, height }
    }

    function pinnedPosition(node) {
      const position = node?.position
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
      return { x: position.x, y: position.y }
    }

    /**
     * Automatic layout with optional manual pins. A node with a finite
     * `position` keeps that top-left corner; everything else is placed by the
     * layered/grid fallback. Local drags still override both in the panel.
     */
    function layout(graph) {
      const view = autoLayout(graph)
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
      let width = view.width
      let height = view.height
      let pinned = 0
      for (const node of nodes) {
        const position = pinnedPosition(node)
        if (!position) continue
        const base = view.positions.get(node.id) ?? { x: 0, y: 0, w: 196, h: 64 }
        const box = { ...base, x: position.x, y: position.y }
        view.positions.set(node.id, box)
        pinned += 1
        width = Math.max(width, box.x + box.w + 24)
        height = Math.max(height, box.y + box.h + 24)
      }
      return { positions: view.positions, width, height, pinned }
    }

    /**
     * Straight or curved edge geometry. Forward edges leave the right side and
     * enter the left side; backward edges leave the left side and enter the
     * right side as return paths. Same-row forward edges detour around a node
     * that blocks the straight line.
     */
    function edgeRoute(from, to, boxes = []) {
      const fx = from.x + from.w / 2
      const fy = from.y + from.h / 2
      const tx = to.x + to.w / 2
      const ty = to.y + to.h / 2
      const dx = tx - fx
      const dy = ty - fy
      const horizontal = Math.abs(dx) >= (from.w + to.w) / 2 - 8
      if (horizontal && dx >= 0) {
        const start = { x: from.x + from.w, y: fy }
        const end = { x: to.x, y: ty }
        // Same-row edges can be blocked by a node between the two boxes. Route
        // above or below the blocker instead of drawing through its title.
        const blockers = Math.abs(dy) > 4 ? [] : boxes.filter(box => {
          if (box === from || box === to) return false
          return box.x < end.x
            && box.x + box.w > start.x
            && box.y < fy
            && box.y + box.h > fy
        })
        if (blockers.length > 0) {
          const top = Math.min(fy, ...blockers.map(box => box.y)) - 26
          const bottom = Math.max(fy, ...blockers.map(box => box.y + box.h)) + 18
          const lane = top >= 12 && fy - top <= bottom - fy ? top : bottom
          const inner = 10
          const d = [
            `M ${start.x} ${start.y}`,
            `L ${start.x + inner} ${start.y}`,
            `L ${start.x + inner} ${lane}`,
            `L ${end.x - inner} ${lane}`,
            `L ${end.x - inner} ${end.y}`,
            `L ${end.x} ${end.y}`,
          ].join(' ')
          return {
            d,
            label: { x: (start.x + end.x) / 2, y: lane - 7 },
          }
        }
        return {
          d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
          label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 7 },
          gap: to.x - (from.x + from.w),
          above: Math.max(12, Math.min(from.y, to.y) - 12),
        }
      }
      if (horizontal) {
        const start = { x: from.x, y: fy }
        const end = { x: to.x + to.w, y: ty }
        const bow = 70 + Math.min(60, Math.abs(dx) * 0.08)
        // A diagonal return edge should pass between the two rows, not dip
        // through whatever sits below the target row.
        const controlY = Math.abs(dy) < 24
          ? Math.max(start.y, end.y) + bow
          : (start.y + end.y) / 2
        const control = { x: (start.x + end.x) / 2, y: controlY }
        return {
          d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
          label: {
            x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
            y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
          },
        }
      }
      const start = { x: fx, y: dy >= 0 ? from.y + from.h : from.y }
      const end = { x: tx, y: dy >= 0 ? to.y : to.y + to.h }
      return {
        d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
        label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 7 },
      }
    }

    function edgeLabelWidth(text) {
      let width = 0
      for (const char of text) width += char.charCodeAt(0) > 255 ? 10 : 6
      return width + 10
    }

    function edgeStyle(kind) {
      if (kind === 'dependency') return { width: 1.2, opacity: 0.45, dash: '4 3' }
      if (kind === 'containment') return { width: 1.2, opacity: 0.4, dash: '1 4' }
      if (kind === 'data') return { width: 1.3, opacity: 0.5 }
      return { width: 1.4, opacity: 0.6 }
    }

    function readAll(ctx, sessionId, filePath, signal) {
      return (async () => {
        let offset = 1
        let text = ''
        for (let page = 0; page < 100; page += 1) {
          const result = await ctx.remote.workspaceFiles.read(sessionId, filePath, { offset }, signal)
          if (!result || result.ok !== true) {
            const reason = result?.error?.message ?? result?.error?.code ?? 'read failed'
            const error = new Error(reason)
            error.code = result?.error?.code
            throw error
          }
          text += (text === '' ? '' : '\n') + result.value.text
          if (result.value.eof) {
            return JSON.parse(text)
          }
          if (!Number.isInteger(result.value.lines) || result.value.lines <= 0) {
            throw new Error(`${filePath} read made no progress`)
          }
          offset += result.value.lines
        }
        throw new Error(`${filePath} is too large to read in one view`)
      })()
    }

    function NodeShape(props) {
      const { node, box, selected, onPointerDown } = props
      const x = box.x
      const y = box.y
      const fill = selected
        ? 'var(--dsw-alias-accent-soft, rgba(79,140,255,0.18))'
        : 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.08))'
      const stroke = selected
        ? 'var(--dsw-alias-accent, #4f8cff)'
        : 'var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))'
      return h(
        'g',
        { onPointerDown: onPointerDown, style: { cursor: 'grab' } },
        h('rect', {
          x, y, width: box.w, height: box.h, rx: 8,
          fill, stroke, strokeWidth: selected ? 2 : 1,
        }),
        h('text', {
          x: x + 12, y: y + 24, fill: 'currentColor', fontSize: 13, fontWeight: 600,
        }, clipWidth(node.title ?? node.id, 170)),
        h('text', {
          x: x + 12, y: y + 44, fill: 'currentColor', fontSize: 11, opacity: 0.65,
        }, `${node.kind ?? 'module'}${node.group ? ` · ${node.group}` : ''}${node.status === 'stale' ? ` · ${t('legend.stale')}` : ''}`),
        h('circle', {
          cx: x + box.w - 14, cy: y + 14, r: 4,
          fill: node.status === 'stale'
            ? 'var(--dsw-alias-warning, #d9a441)'
            : node.status === 'proposed'
              ? 'var(--dsw-alias-danger, #e5484d)'
              : 'var(--dsw-alias-success, #4caf7d)',
        }),
      )
    }

    function createGraphTab(ctx) {
      return function GraphTab(props) {
        const sessionId = props?.sessionId
        const cwd = props.useSessions(sessions => sessions.byId[sessionId]?.cwd)
        const [state, setState] = React.useState({ status: 'loading', graph: null, error: null })
        const [selectedId, setSelectedId] = React.useState(null)
        const [discussState, setDiscussState] = React.useState({ status: 'idle', error: null })
        const [tick, setTick] = React.useState(0)
        const [view, setView] = React.useState({ zoom: 1, x: 0, y: 0 })
        const [positions, setPositions] = React.useState({})
        const [sources, setSources] = React.useState([])
        const [sourceId, setSourceId] = React.useState(null)
        const [indexError, setIndexError] = React.useState(null)
        const svgRef = React.useRef(null)
        const panRef = React.useRef(null)
        const fittedRef = React.useRef(false)
        const trackedRef = React.useRef(null)
        const storageKey = cwd ? `${POSITIONS_KEY}${cwd}:${sourceId ?? 'local'}` : undefined

        React.useEffect(() => {
          setDiscussState({ status: 'idle', error: null })
        }, [selectedId])

        React.useEffect(() => {
          if (!sessionId) {
            setSources([localSource()])
            setSourceId('local')
            setIndexError(null)
            return undefined
          }
          let disposed = false
          let controller
          const loadIndex = async () => {
            if (controller) controller.abort()
            controller = new AbortController()
            try {
              const index = await readAll(ctx, sessionId, INDEX_PATH, controller.signal)
              if (!disposed) {
                setSources(sourcesFromIndex(index))
                setIndexError(null)
              }
            } catch (error) {
              if (disposed || error?.name === 'AbortError') return
              if (!disposed) {
                setSources([localSource()])
                setIndexError(isMissingFile(error) ? null : (error?.message ?? String(error)))
              }
            }
          }
          loadIndex()
          return () => {
            disposed = true
            if (controller) controller.abort()
          }
        }, [sessionId, cwd, tick])

        React.useEffect(() => {
          if (sources.length === 0) return
          setSourceId(current => {
            if (current && sources.some(source => source.id === current)) return current
            const saved = readSavedSource(cwd)
            if (saved && sources.some(source => source.id === saved)) return saved
            return sources.find(source => source.kind === 'local')?.id ?? sources[0].id
          })
        }, [sources, cwd])

        React.useEffect(() => {
          if (sourceId) writeSavedSource(cwd, sourceId)
        }, [sourceId, cwd])

        // Selecting a remote source starts the host-side change poller once per
        // session + project. The command returns immediately; failures surface
        // through remote-state.json rather than blocking the panel.
        React.useEffect(() => {
          if (!sessionId || !sourceId) return
          const selected = sources.find(item => item.id === sourceId)
          if (!selected || selected.kind !== 'remote') return
          const key = `${sessionId}:${selected.id}`
          if (trackedRef.current === key) return
          trackedRef.current = key
          Promise.resolve(ctx.remote.commands.execute(sessionId, `/arch remote select ${selected.id}`, [])).catch(() => {})
        }, [sessionId, sourceId, sources])

        React.useEffect(() => {
          setState({ status: 'loading', graph: null, error: null })
          setSelectedId(null)
          fittedRef.current = false
        }, [sourceId])

        React.useEffect(() => {
          if (!sessionId) {
            setState({ status: 'error', graph: null, error: 'No session is bound to this tab.' })
            return undefined
          }
          if (!sourceId) {
            setState({ status: 'loading', graph: null, error: null })
            return undefined
          }
          const source = sources.find(item => item.id === sourceId)
          const graphPath = source?.graphPath ?? GRAPH_PATH
          let disposed = false
          let controller
          const load = async () => {
            if (controller) controller.abort()
            controller = new AbortController()
            try {
              const graph = await readAll(ctx, sessionId, graphPath, controller.signal)
              if (!disposed) {
                setState(previous => previous.graph?.rev === graph.rev ? previous : { status: 'live', graph, error: null })
              }
            } catch (error) {
              if (disposed || error?.name === 'AbortError') return
              if (isMissingFile(error)) {
                setState({ status: 'empty', graph: null, error: null })
                return
              }
              setState(previous => ({
                status: previous.graph ? 'live' : 'error',
                graph: previous.graph,
                error: error?.message ?? String(error),
              }))
            }
          }
          load()
          const timer = setInterval(load, POLL_MS)
          return () => {
            disposed = true
            clearInterval(timer)
            if (controller) controller.abort()
          }
        }, [sessionId, tick, sourceId, sources])

        const graph = state.graph
        const source = sources.find(item => item.id === sourceId) ?? null
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
        const edges = Array.isArray(graph?.edges) ? graph.edges : []
        const selected = nodes.find(node => node.id === selectedId)
        const selectedEdges = selected
          ? edges.filter(edge => edge.from === selected.id || edge.to === selected.id)
          : []
        const layoutView = layout(graph)
        // Local drags are overrides on top of the graph's own (possibly pinned)
        // positions. Keeping only x/y here means a graph repin still shows up.
        const positionOf = id => overlayPosition(layoutView.positions.get(id), positions[id])

        const fitBoxes = boxes => {
          if (boxes.length === 0) return
          const minX = Math.min(...boxes.map(box => box.x))
          const maxX = Math.max(...boxes.map(box => box.x + box.w))
          const minY = Math.min(...boxes.map(box => box.y))
          const maxY = Math.max(...boxes.map(box => box.y + box.h))
          const pad = 60
          const zoom = Math.min(1000 / (maxX - minX + pad), 700 / (maxY - minY + pad), 1.4)
          setView({
            zoom,
            x: (1000 - (maxX - minX) * zoom) / 2 - minX * zoom,
            y: (700 - (maxY - minY) * zoom) / 2 - minY * zoom,
          })
        }

        const fitGraph = target => {
          const boxes = (Array.isArray(target?.nodes) ? target.nodes : [])
            .map(node => positionOf(node.id))
            .filter(Boolean)
          fitBoxes(boxes.length > 0 ? boxes : [...layout(target).positions.values()])
        }

        const resetLayout = () => {
          if (!graph) return
          setPositions({})
          clearSavedPositions(storageKey)
          fitBoxes([...layout(graph).positions.values()])
        }

        React.useEffect(() => {
          if (!graph || !storageKey) return
          const ids = new Set(graph.nodes.map(node => node.id))
          const saved = readSavedPositions(storageKey)
          setPositions(Object.fromEntries(
            Object.entries(saved).filter(([id]) => ids.has(id)),
          ))
        }, [graph?.rev, storageKey])

        React.useEffect(() => {
          if (!graph || fittedRef.current) return
          fittedRef.current = true
          fitGraph(graph)
        }, [graph?.rev])

        const onNodePointerDown = (event, id) => {
          event.stopPropagation()
          if (event.button !== 0) return
          const box = positionOf(id)
          if (!box) return
          const startX = event.clientX
          const startY = event.clientY
          const originX = box.x
          const originY = box.y
          let moved = false
          let last = null
          const move = moveEvent => {
            if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 3) {
              moved = true
            }
            if (!moved) return
            const dx = (moveEvent.clientX - startX) / view.zoom
            const dy = (moveEvent.clientY - startY) / view.zoom
            last = { x: originX + dx, y: originY + dy }
            setPositions(previous => ({
              ...previous,
              [id]: last,
            }))
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            if (!moved) {
              setSelectedId(id)
              return
            }
            if (last && storageKey) {
              const saved = readSavedPositions(storageKey)
              saved[id] = last
              writeSavedPositions(storageKey, saved)
            }
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up, { once: true })
          event.preventDefault()
        }

        const viewPoint = event => {
          const svg = svgRef.current
          if (!svg) return undefined
          const ctm = svg.getScreenCTM()
          if (!ctm) return undefined
          const point = svg.createSVGPoint()
          point.x = event.clientX
          point.y = event.clientY
          return point.matrixTransform(ctm.inverse())
        }

        const onWheel = event => {
          event.preventDefault()
          // Normalize line/page deltas, and ignore zero/tiny events. Some
          // trackpads/mice emit a deltaY=0 or a tiny settle event after a
          // notch; treating every event as a full 12% step made the zoom jump
          // 140% -> 157% -> 140% without any further user action.
          const raw = event.deltaMode === 1
            ? event.deltaY * 16
            : event.deltaMode === 2
              ? event.deltaY * 400
              : event.deltaY
          if (!Number.isFinite(raw) || Math.abs(raw) < 1) return
          const vb = viewPoint(event)
          if (!vb) return
          const clamped = Math.max(-160, Math.min(160, raw))
          const factor = Math.exp(-clamped * 0.0015)
          setView(current => {
            const zoom = Math.min(2.5, Math.max(0.35, current.zoom * factor))
            if (zoom === current.zoom) return current
            const worldX = (vb.x - current.x) / current.zoom
            const worldY = (vb.y - current.y) / current.zoom
            return {
              zoom,
              x: vb.x - worldX * zoom,
              y: vb.y - worldY * zoom,
            }
          })
        }

        React.useEffect(() => {
          const svg = svgRef.current
          if (!svg) return undefined
          const handler = event => onWheel(event)
          svg.addEventListener('wheel', handler, { passive: false })
          return () => svg.removeEventListener('wheel', handler)
        }, [graph])

        const onPointerDown = event => {
          if (event.button !== 0) return
          const vb = viewPoint(event)
          if (!vb) return
          panRef.current = { startX: vb.x, startY: vb.y, originX: view.x, originY: view.y }
          event.currentTarget.setPointerCapture?.(event.pointerId)
          event.preventDefault()
        }

        const onPointerMove = event => {
          const pan = panRef.current
          if (!pan) return
          const vb = viewPoint(event)
          if (!vb) return
          setView(current => ({
            ...current,
            x: pan.originX + (vb.x - pan.startX),
            y: pan.originY + (vb.y - pan.startY),
          }))
        }

        const onPointerUp = () => {
          panRef.current = null
        }

        const sourcePicker = sources.length > 1
          ? h('select', {
              value: sourceId ?? '',
              style: styles.select,
              title: t('source.label'),
              'aria-label': t('source.label'),
              onChange: event => {
                const next = event.target.value
                setSourceId(next)
                writeSavedSource(cwd, next)
              },
            }, sources.map(item => h('option', { key: item.id, value: item.id },
              item.kind === 'local' ? t('source.local') : item.label)))
          : null

        const header = h(
          'div',
          { style: styles.header },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
            h('h2', { style: styles.title }, t('panel.title')),
            sourcePicker,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: styles.meta, title: cwd ?? undefined }, graph
              ? `rev ${graph.rev} · ${nodes.length} nodes · ${edges.length} edges`
              : state.status === 'empty' ? t('panel.noGraph') : 'loading…'),
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: () => setTick(value => value + 1),
              title: t('panel.refresh'),
            }, t('panel.refresh')),
          ),
        )

        const sourceBar = indexError
          ? h('div', { style: styles.sourceBar }, `${t('panel.indexError')} ${indexError}`)
          : source?.kind === 'remote'
            ? h('div', { style: styles.sourceBar, title: source.meta }, `${source.label} · ${source.meta}`)
            : null

        const toolbar = nodes.length === 0
          ? null
          : h('div', { style: styles.toolbar },
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: () => fitGraph(graph),
            }, t('panel.fit')),
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: resetLayout,
              title: 'Clear local drags and return to the pinned or automatic layout',
            }, t('panel.reset')),
            h('span', { style: styles.meta }, `${Math.round(view.zoom * 100)}%`),
            h('span', { style: { ...styles.meta, opacity: 0.55 } }, t('panel.hint')))

        const boxes = nodes.map(node => positionOf(node.id)).filter(Boolean)
        const edgeViews = edges.flatMap(edge => {
          const from = positionOf(edge.from)
          const to = positionOf(edge.to)
          return from && to ? [{ edge, route: edgeRoute(from, to, boxes) }] : []
        })

        const canvas = nodes.length === 0
          ? h('div', { style: styles.empty },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } },
              source?.kind === 'remote' ? t('panel.noGraphRemote') : 'No graph yet'),
            h('div', null, source?.kind === 'remote'
              ? t('panel.remoteHint').replace('<id>', source.id)
              : 'Ask the agent to create one with arch_graph_patch in this session workspace.'),
            cwd ? h('div', { style: { ...styles.mono, marginTop: '8px', opacity: 0.65 } }, cwd) : null,
            state.error ? h('div', { style: { marginTop: '8px', opacity: 0.7 } }, state.error) : null)
          : h(
            'svg',
            {
              ref: svgRef,
              viewBox: '0 0 1000 700',
              preserveAspectRatio: 'xMidYMid meet',
              style: styles.canvas,
              role: 'img',
              'aria-label': 'Architecture graph',
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
            },
            h('defs', null,
              h('marker', {
                id: 'archmap-arrow',
                viewBox: '0 0 10 10',
                refX: '9',
                refY: '5',
                markerWidth: '6',
                markerHeight: '6',
                orient: 'auto-start-reverse',
              }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--dsw-alias-text-secondary, #888)' }))),
            h('g', { transform: `translate(${view.x} ${view.y}) scale(${view.zoom})` },
              edgeViews.map(({ edge, route }) => {
                const style = edgeStyle(edge.kind)
                return h('path', {
                  key: `edge:${edge.id}`,
                  d: route.d,
                  fill: 'none',
                  stroke: 'var(--dsw-alias-text-secondary, #888)',
                  strokeWidth: style.width,
                  strokeOpacity: style.opacity,
                  strokeDasharray: style.dash,
                  strokeLinecap: 'round',
                  markerEnd: 'url(#archmap-arrow)',
                })
              }),
              nodes.map(node => {
                const box = positionOf(node.id)
                return box
                  ? h(NodeShape, {
                    key: node.id, node, box,
                    selected: node.id === selectedId,
                    onPointerDown: event => onNodePointerDown(event, node.id),
                  })
                  : null
              }),
              edgeViews.map(({ edge, route }) => {
                const label = clip(edge.label, 24).trim()
                if (!label) return null
                const width = edgeLabelWidth(label)
                const tight = route.gap !== undefined && width + 6 > route.gap
                const labelY = tight ? route.above : route.label.y
                return h('g', { key: `label:${edge.id}`, style: { pointerEvents: 'none' } },
                  h('rect', {
                    x: route.label.x - width / 2,
                    y: labelY - 9,
                    width,
                    height: 15,
                    rx: 3,
                    fill: 'var(--dsw-alias-bg-primary, #ffffff)',
                    opacity: 0.9,
                  }),
                  h('text', {
                    x: route.label.x,
                    y: labelY + 2,
                    textAnchor: 'middle',
                    fontSize: 10.5,
                    fill: 'var(--dsw-alias-text-secondary, #888)',
                  }, label))
              }),
            ),
          )

        const legendColors = {
          fresh: 'var(--dsw-alias-success, #4caf7d)',
          stale: 'var(--dsw-alias-warning, #d9a441)',
          proposed: 'var(--dsw-alias-danger, #e5484d)',
        }
        const legend = h('div', { style: styles.legend },
          Object.entries(legendColors).map(([status, color]) => h('span', { key: status, style: styles.legendItem },
            h('span', { style: { ...styles.legendDot, background: color } }),
            t(`legend.${status}`),
          )))

        const openDiscussion = async mode => {
          if (!selected || discussState.status === 'starting') return
          if (!sessionId) {
            setDiscussState({ status: 'error', error: 'No session is bound to this tab.' })
            return
          }
          setDiscussState({ status: 'starting', error: null })
          try {
            const workspace = source?.kind === 'remote' ? `remote:${source.id}` : undefined
            const line = discussionCommand(selected.id, mode, workspace)
            const response = await ctx.remote.commands.execute(sessionId, line, [])
            if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
            const outcome = response.value?.result
            if (!outcome || outcome.kind !== 'success') throw new Error(outcome?.text ?? 'discussion failed')
            const text = outcome.text ?? ''
            const match = /\[child=([^\s\]]+) parent=([^\s\]]+) mode=([^\s\]]+)/.exec(text)
            if (!match) throw new Error(`discussion started but no sidebar address: ${text}`)
            if (!ctx.sidebarRight || typeof ctx.sidebarRight.openResource !== 'function') {
              throw new Error('the right sidebar does not support opening a subagent chat')
            }
            const address = `dsh-resource://subagentchat/session/${encodeURIComponent(match[1])}?parent=${encodeURIComponent(match[2])}&mode=${encodeURIComponent(match[3])}`
            ctx.sidebarRight.openResource(address, { kind: 'subagentchat', preferNewPane: true })
            setDiscussState({ status: 'idle', error: null })
          } catch (error) {
            setDiscussState({ status: 'error', error: error?.message ?? String(error) })
          }
        }

        const detail = selected
          ? h('div', { style: styles.detail },
            h('p', { style: styles.detailTitle }, `${selected.id} · ${selected.title}`),
            h('div', { style: styles.detailRow }, `${t('detail.kind')} ${selected.kind}${selected.group ? ` · ${t('detail.group')} ${selected.group}` : ''} · ${t('detail.status')} ${t(`legend.${selected.status}`)}`),
            selected.summary ? h('div', { style: styles.detailRow }, selected.summary) : null,
            selected.anchors?.length
              ? h('div', { style: { ...styles.detailRow, ...styles.mono } }, selected.anchors.map(anchor => `${anchor.path}${anchor.symbol ? `#${anchor.symbol}` : ''}`).join('  ·  '))
              : null,
            selectedEdges.length
              ? h('div', { style: styles.detailRow }, selectedEdges.map(edge => `${edge.id}: ${edge.from} → ${edge.to}${edge.label ? ` (${edge.label})` : ''}`).join('  ·  '))
              : null,
            h('div', { style: styles.discussRow },
              h('button', {
                type: 'button',
                style: styles.button,
                disabled: discussState.status === 'starting',
                onClick: () => openDiscussion('fork'),
              }, discussState.status === 'starting' ? t('discuss.starting') : t('discuss.fork')),
              h('button', {
                type: 'button',
                style: styles.button,
                disabled: discussState.status === 'starting',
                onClick: () => openDiscussion('lite'),
              }, t('discuss.lite'))),
            h('div', { style: styles.discussHint }, t('discuss.hint')),
            discussState.error ? h('div', { style: styles.discussError }, discussState.error) : null)
          : h('div', { style: { ...styles.detail, opacity: 0.65 } }, t('panel.empty'))

        return h('div', { style: styles.root },
          header,
          sourceBar,
          state.status === 'error' && state.error
            ? h('div', { style: styles.error }, `${t('panel.error')}: ${state.error}`)
            : null,
          toolbar,
          legend,
          canvas,
          nodes.length > 0 ? detail : null,
        )
      }
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.commands', 'remote.workspaceFiles'],
      apply(ctx) {
        if (ctx.locale) {
          const register = () => ctx.locale.register(LOCALE_NS, { en: EN, zh: ZH })
          if (typeof ctx.effect === 'function') ctx.effect(register, 'architecture-map: locale dictionaries')
          else register()
          t = ctx.locale.bind(LOCALE_NS)
        }
        ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: 'archmap.graph',
          priority: 'extension',
          title: () => t('panel.title'),
          guide: [{
            id: 'open',
            order: 30,
            title: () => t('panel.title'),
            description: () => 'Open the live architecture graph panel',
          }],
        })

        const GraphTab = createGraphTab(ctx)
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
        }, GraphTab))

        // Fence rendering is optional: a slot/version mismatch must never stop
        // the graph tab from mounting. Register it after the panel and contain
        // any failure to this feature.
        try {
          ctx.slots.inject('conversation.chat.markdown.fence', () => {
            try {
              return ctx.slots.register({
                name: 'conversation.chat.markdown.fence',
                key: 'mermaid',
                id: 'dsh-architecture-map/fence/mermaid',
              }, MermaidFence)
            } catch (error) {
              console.warn('[architecture-map] Mermaid fence registration failed:', error)
              return () => {}
            }
          })
        } catch (error) {
          console.warn('[architecture-map] Mermaid fence injection failed:', error)
        }

        // `/arch` is a Host command (the composer shows the same blue chip as
        // /goal). When it succeeds, open the panel here.
        ctx.on('command/executed', (sessionId, commandName, result) => {
          if (commandName !== 'arch' || result?.kind !== 'success') return
          try {
            ctx.sidebarRight.openTab('archmap.graph')
          } catch (error) {
            console.warn('[architecture-map] openTab failed after /arch', error)
          }
        })

      },
    }
  },
})

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
    const POLL_MS = 2000
    const POSITIONS_KEY = 'dsh-architecture-map:positions:'
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
     */
    function layout(graph) {
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

    function readAll(ctx, sessionId, signal) {
      return (async () => {
        let offset = 1
        let text = ''
        for (let page = 0; page < 100; page += 1) {
          const result = await ctx.remote.workspaceFiles.read(sessionId, GRAPH_PATH, { offset }, signal)
          if (!result || result.ok !== true) {
            const reason = result?.error?.message ?? result?.error?.code ?? 'read failed'
            throw new Error(reason)
          }
          text += (text === '' ? '' : '\n') + result.value.text
          if (result.value.eof) {
            return JSON.parse(text)
          }
          if (!Number.isInteger(result.value.lines) || result.value.lines <= 0) {
            throw new Error('graph read made no progress')
          }
          offset += result.value.lines
        }
        throw new Error('graph file is too large to read in one view')
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
        }, clip(node.title ?? node.id, 22)),
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
        const storageKey = cwd ? POSITIONS_KEY + cwd : undefined
        const [state, setState] = React.useState({ status: 'loading', graph: null, error: null })
        const [selectedId, setSelectedId] = React.useState(null)
        const [discussState, setDiscussState] = React.useState({ status: 'idle', error: null })
        const [tick, setTick] = React.useState(0)
        const [view, setView] = React.useState({ zoom: 1, x: 0, y: 0 })
        const [positions, setPositions] = React.useState({})
        const svgRef = React.useRef(null)
        const panRef = React.useRef(null)
        const fittedRef = React.useRef(false)

        React.useEffect(() => {
          setDiscussState({ status: 'idle', error: null })
        }, [selectedId])

        React.useEffect(() => {
          if (!sessionId) {
            setState({ status: 'error', graph: null, error: 'No session is bound to this tab.' })
            return undefined
          }
          let disposed = false
          let controller
          const load = async () => {
            if (controller) controller.abort()
            controller = new AbortController()
            try {
              const graph = await readAll(ctx, sessionId, controller.signal)
              if (!disposed) {
                setState(previous => previous.graph?.rev === graph.rev ? previous : { status: 'live', graph, error: null })
              }
            } catch (error) {
              if (disposed || error?.name === 'AbortError') return
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
        }, [sessionId, tick])

        const graph = state.graph
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
        const edges = Array.isArray(graph?.edges) ? graph.edges : []
        const selected = nodes.find(node => node.id === selectedId)
        const selectedEdges = selected
          ? edges.filter(edge => edge.from === selected.id || edge.to === selected.id)
          : []
        const layoutView = layout(graph)
        const positionOf = id => positions[id] ?? layoutView.positions.get(id)

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
          const current = Object.values(positions)
          fitBoxes(current.length > 0 ? current : [...layout(target).positions.values()])
        }

        const resetLayout = () => {
          if (!graph) return
          const base = layout(graph)
          setPositions(Object.fromEntries(base.positions))
          clearSavedPositions(storageKey)
          fitBoxes([...base.positions.values()])
        }

        React.useEffect(() => {
          if (!graph || !storageKey) return
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
            setPositions(previous => {
              const current = previous[id] ?? box
              return {
                ...previous,
                [id]: { ...current, ...last },
              }
            })
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

        const header = h(
          'div',
          { style: styles.header },
          h('h2', { style: styles.title }, t('panel.title')),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: styles.meta, title: cwd ?? undefined }, graph
              ? `rev ${graph.rev} · ${nodes.length} nodes · ${edges.length} edges`
              : 'loading…'),
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: () => setTick(value => value + 1),
              title: t('panel.refresh'),
            }, t('panel.refresh')),
          ),
        )

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
              title: 'Reset node positions to the automatic layout',
            }, t('panel.reset')),
            h('span', { style: styles.meta }, `${Math.round(view.zoom * 100)}%`),
            h('span', { style: { ...styles.meta, opacity: 0.55 } }, t('panel.hint')))

        const canvas = nodes.length === 0
          ? h('div', { style: styles.empty },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'No graph yet'),
            h('div', null, 'Ask the agent to create one with arch_graph_patch in this session workspace.'),
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
              edges.map(edge => {
                const from = positionOf(edge.from)
                const to = positionOf(edge.to)
                if (!from || !to) return null
                return h('line', {
                  key: `edge:${edge.id}`,
                  x1: from.x + from.w, y1: from.y + from.h / 2,
                  x2: to.x, y2: to.y + to.h / 2,
                  stroke: 'var(--dsw-alias-text-secondary, #888)',
                  strokeWidth: 1.2,
                  strokeOpacity: 0.6,
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
            status,
          )))

        const openDiscussion = async mode => {
          if (!selected || discussState.status === 'starting') return
          if (!sessionId) {
            setDiscussState({ status: 'error', error: 'No session is bound to this tab.' })
            return
          }
          setDiscussState({ status: 'starting', error: null })
          try {
            const line = `/arch discuss node:${selected.id} ${mode}`
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
            h('div', { style: styles.discussHint },
              'Tool schemas may be inherited, but shell and source-write calls are denied for discussion children; graph changes still need your approval.'),
            discussState.error ? h('div', { style: styles.discussError }, discussState.error) : null)
          : h('div', { style: { ...styles.detail, opacity: 0.65 } }, t('panel.empty'))

        return h('div', { style: styles.root },
          header,
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

        // Temporary M0 convenience: keep trying until a session is available.
        console.info('[architecture-map] client loaded')
        let attempts = 0
        const timer = setInterval(() => {
          attempts += 1
          try {
            ctx.sidebarRight.openTab('archmap.graph')
            clearInterval(timer)
          } catch {
            if (attempts >= 60) {
              console.warn('[architecture-map] could not auto-open the sidebar tab; open it from the sidebar instead')
              clearInterval(timer)
            }
          }
        }, 500)
        if (typeof ctx.effect === 'function') ctx.effect(() => () => clearInterval(timer))
      },
    }
  },
})

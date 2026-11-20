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
      canvas: {
        width: '100%',
        height: 'auto',
        display: 'block',
        overflow: 'visible',
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
    }

    function clip(text, max) {
      const value = String(text ?? '')
      return value.length <= max ? value : `${value.slice(0, max - 1)}…`
    }

    function layout(graph) {
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
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
      const { node, box, selected, onSelect } = props
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
        { onClick: () => onSelect(node.id), style: { cursor: 'pointer' } },
        h('rect', {
          x, y, width: box.w, height: box.h, rx: 8,
          fill, stroke, strokeWidth: selected ? 2 : 1,
        }),
        h('text', {
          x: x + 12, y: y + 24, fill: 'currentColor', fontSize: 13, fontWeight: 600,
        }, clip(node.title ?? node.id, 22)),
        h('text', {
          x: x + 12, y: y + 44, fill: 'currentColor', fontSize: 11, opacity: 0.65,
        }, `${node.kind ?? 'module'}${node.group ? ` · ${node.group}` : ''}${node.status === 'stale' ? ' · stale' : ''}`),
        h('circle', {
          cx: x + box.w - 14, cy: y + 14, r: 4,
          fill: node.status === 'stale'
            ? 'var(--dsw-alias-warning, #d9a441)'
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
        const [tick, setTick] = React.useState(0)

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
        const view = layout(graph)

        const header = h(
          'div',
          { style: styles.header },
          h('h2', { style: styles.title }, 'Architecture map'),
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
              title: 'Refresh graph',
            }, 'Refresh'),
          ),
        )

        const canvas = nodes.length === 0
          ? h('div', { style: styles.empty },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'No graph yet'),
            h('div', null, 'Ask the agent to create one with arch_graph_patch in this session workspace.'),
            cwd ? h('div', { style: { ...styles.mono, marginTop: '8px', opacity: 0.65 } }, cwd) : null,
            state.error ? h('div', { style: { marginTop: '8px', opacity: 0.7 } }, state.error) : null)
          : h(
            'svg',
            {
              viewBox: `0 0 ${view.width} ${view.height}`,
              style: styles.canvas,
              role: 'img',
              'aria-label': 'Architecture graph',
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
            edges.map(edge => {
              const from = view.positions.get(edge.from)
              const to = view.positions.get(edge.to)
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
              const box = view.positions.get(node.id)
              return box
                ? h(NodeShape, {
                  key: node.id, node, box,
                  selected: node.id === selectedId,
                  onSelect: setSelectedId,
                })
                : null
            }),
          )

        const detail = selected
          ? h('div', { style: styles.detail },
            h('p', { style: styles.detailTitle }, `${selected.id} · ${selected.title}`),
            h('div', { style: styles.detailRow }, `kind ${selected.kind}${selected.group ? ` · group ${selected.group}` : ''} · ${selected.status}`),
            selected.summary ? h('div', { style: styles.detailRow }, selected.summary) : null,
            selected.anchors?.length
              ? h('div', { style: { ...styles.detailRow, ...styles.mono } }, selected.anchors.map(anchor => `${anchor.path}${anchor.symbol ? `#${anchor.symbol}` : ''}`).join('  ·  '))
              : null,
            selectedEdges.length
              ? h('div', { style: styles.detailRow }, selectedEdges.map(edge => `${edge.id}: ${edge.from} → ${edge.to}${edge.label ? ` (${edge.label})` : ''}`).join('  ·  '))
              : null)
          : h('div', { style: { ...styles.detail, opacity: 0.65 } }, 'Click a node to see its summary, anchors and edges.')

        return h('div', { style: styles.root },
          header,
          state.status === 'error' && state.error
            ? h('div', { style: styles.error }, `Graph unavailable: ${state.error}`)
            : null,
          canvas,
          nodes.length > 0 ? detail : null,
        )
      }
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
      apply(ctx) {
        ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: 'archmap.graph',
          priority: 'extension',
          title: () => 'Architecture map',
          guide: [{
            id: 'open',
            order: 30,
            title: () => 'Architecture map',
            description: () => 'Open the live architecture graph panel',
          }],
        })

        const GraphTab = createGraphTab(ctx)
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
        }, GraphTab))

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

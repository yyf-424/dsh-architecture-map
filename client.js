/**
 * Architecture map — Client half (M0 skeleton).
 *
 * Registers a right-sidebar tab type and an empty placeholder body. The graph
 * canvas, node cards, and discussion bridge land in later nodes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-architecture-map',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const styles = {
      root: {
        height: '100%',
        boxSizing: 'border-box',
        padding: '20px',
        fontFamily: 'inherit',
        color: 'var(--dsw-alias-text-primary, inherit)',
        background: 'var(--dsw-alias-bg-primary, transparent)',
        overflow: 'auto',
      },
      eyebrow: {
        fontSize: '11px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        opacity: 0.65,
        marginBottom: '6px',
      },
      title: {
        fontSize: '16px',
        fontWeight: 600,
        margin: '0 0 8px',
      },
      copy: {
        fontSize: '13px',
        lineHeight: 1.6,
        opacity: 0.8,
        margin: '0 0 20px',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.28))',
        borderRadius: '10px',
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
      },
      cardTitle: {
        fontSize: '13px',
        fontWeight: 600,
        margin: '0 0 4px',
      },
      cardCopy: {
        fontSize: '12px',
        lineHeight: 1.5,
        opacity: 0.7,
        margin: 0,
      },
    }

    function DiagramMark() {
      return h(
        'svg',
        {
          width: 64,
          height: 48,
          viewBox: '0 0 64 48',
          'aria-hidden': true,
          style: { flex: 'none' },
        },
        h('path', {
          d: 'M14 14 L32 24 L50 14 M32 24 L14 38 M32 24 L50 38',
          fill: 'none',
          stroke: 'var(--dsw-alias-accent, #4f8cff)',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.8,
        }),
        h('rect', { x: 6, y: 8, width: 16, height: 12, rx: 3, fill: 'var(--dsw-alias-accent, #4f8cff)', opacity: 0.9 }),
        h('rect', { x: 42, y: 8, width: 16, height: 12, rx: 3, fill: 'var(--dsw-alias-accent, #4f8cff)', opacity: 0.55 }),
        h('rect', { x: 24, y: 18, width: 16, height: 12, rx: 3, fill: 'var(--dsw-alias-accent, #4f8cff)', opacity: 0.75 }),
        h('rect', { x: 6, y: 32, width: 16, height: 12, rx: 3, fill: 'var(--dsw-alias-accent, #4f8cff)', opacity: 0.55 }),
        h('rect', { x: 42, y: 32, width: 16, height: 12, rx: 3, fill: 'var(--dsw-alias-accent, #4f8cff)', opacity: 0.9 }),
      )
    }

    function GraphTab() {
      return h(
        'div',
        { style: styles.root },
        h('div', { style: styles.eyebrow }, 'M0 skeleton'),
        h('h2', { style: styles.title }, 'Architecture map'),
        h(
          'p',
          { style: styles.copy },
          'The right-sidebar seat is wired. The semantic graph, node cards, and per-node discussions come next.',
        ),
        h(
          'div',
          { style: styles.card },
          h(DiagramMark),
          h(
            'div',
            null,
            h('p', { style: styles.cardTitle }, 'Empty tab is working'),
            h('p', { style: styles.cardCopy }, 'Next node: canonical graph store and the arch_* tools.'),
          ),
        ),
      )
    }

    const TYPE_ID = 'dsh-architecture-map/graph'

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
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

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
        }, GraphTab))

        // A reliable manual entry point while the tab is not discoverable yet:
        // type /arch in the composer and pick "Architecture map".
        // `/arch` is a Host command (so the composer shows the same blue
        // command chip as /goal). When it is submitted successfully, open the
        // panel here, where the client can reach the sidebar service.
        ctx.on('command/executed', (sessionId, commandName, result) => {
          if (commandName !== 'arch' || result?.kind !== 'success') return
          try {
            ctx.sidebarRight.openTab('archmap.graph')
          } catch (error) {
            console.warn('[architecture-map] openTab failed after /arch', error)
          }
        })

        // Temporary M0 convenience: open the tab once a session is available so
        // the install is easy to verify. Later nodes replace this with explicit
        // commands and an activation-on-demand flow.
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

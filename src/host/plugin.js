/**
 * Architecture map — Host half (M0 skeleton).
 *
 * Registers one diagnostic tool so the agent and the user can confirm the
 * plugin is installed, activated, and able to register a tool. The real
 * `ctx.arch` service, graph store, and `arch_*` tools land in later nodes.
 */
export const name = 'architecture-map'

/** Services this plugin needs before it activates. */
export const inject = ['tools', 'commands']

/**
 * Register the M0 diagnostic tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'arch_hello',
    description:
      'Return a diagnostic hello message. Use this once to confirm the Architecture map plugin is installed and active.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute() {
      return { message: 'hello from architecture map' }
    },
  })

  // The host command supplies the catalog row and the composer's command chip.
  // The client half hangs a bare-invocation decoration on it to open the panel.
  ctx.commands.register({
    name: 'arch',
    description: 'Open the Architecture map panel',
    input: { hint: '[open]' },
    handler: ({ rawInput }) => {
      const extra = rawInput.trim()
      if (extra !== '' && extra !== 'open') {
        return {
          kind: 'error',
          text: '用法：/arch 或 /arch open（打开面板）。要调用工具，请直接发送“调用 arch_hello”。',
        }
      }
      return { kind: 'success', text: 'Architecture map opened in the right sidebar.' }
    },
  })
}

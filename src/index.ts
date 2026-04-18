import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildContainer } from './di/container.js'
import { registerTools } from './mcp/register-tools.js'

const server = new McpServer({
  name: 'locator-intelligence-mcp',
  version: '1.0.0',
})

const services = buildContainer()
registerTools(server, services)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    try {
      await services.shutdown()
    } finally {
      process.exit(0)
    }
  })
}

const transport = new StdioServerTransport()
await server.connect(transport)

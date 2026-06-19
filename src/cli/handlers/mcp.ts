import type { CliContext } from '../context-factory.js';

export async function handleMcp(ctx: CliContext, params: { port?: number; daemon: boolean }): Promise<void> {
  // Delegate to the MCP server module — it will handle its own lifecycle
  const { startMcpServer } = await import('../../mcp/server.js');
  await startMcpServer(ctx.db.getPath(), []);
}

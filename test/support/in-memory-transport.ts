import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { McpTransport, McpTransportContext } from '@rekog/mcp-nest';

/**
 * An mcp-nest transport linked to an in-memory client transport (notes §9):
 * the real RPC pipeline (DI, filters, registration) with no network.
 * It presents itself as stdio, so tools see no raw request.
 */
export class InMemoryMcpTransport implements McpTransport {
  readonly kind = 'stdio' as const;
  readonly clientSide: InMemoryTransport;
  private readonly serverSide: InMemoryTransport;

  constructor() {
    [this.clientSide, this.serverSide] = InMemoryTransport.createLinkedPair();
  }

  async start(ctx: McpTransportContext): Promise<void> {
    await ctx
      .createBoundServer({ transport: 'stdio', stateless: false, era: 'legacy' })
      .connect(this.serverSide);
  }

  async close(): Promise<void> {
    await this.serverSide.close();
  }
}

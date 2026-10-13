import { Controller, Get, Header, type Type, UseGuards } from '@nestjs/common';
import { McpHttpControllerFor, type McpHttpHandlerSource } from '@rekog/mcp-nest';
import { HttpAuthGuard } from './http-auth.guard';

/**
 * The MCP route as our own Nest controller (mcp-nest notes §7): owning the
 * route is what lets HttpAuthGuard answer 401 before any JSON-RPC is read,
 * and what makes MCP_HTTP_PATH take effect.
 */
export function mcpHttpController(path: string, transport: McpHttpHandlerSource): Type {
  @Controller(path)
  @UseGuards(HttpAuthGuard)
  class McpHttpController extends McpHttpControllerFor(transport) {}
  return McpHttpController;
}

/** Liveness for load balancers and the container healthcheck; no auth, no GlitchTip call. */
@Controller()
export class HealthController {
  @Get('healthz')
  @Header('content-type', 'text/plain; charset=utf-8')
  health(): string {
    return 'ok';
  }
}

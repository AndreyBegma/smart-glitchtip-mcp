import { applyDecorators, UseFilters } from '@nestjs/common';
import { McpController } from '@rekog/mcp-nest';
import { ToolErrorFilter } from './tool-error.filter';

/**
 * Marks a class of GlitchTip tools: an mcp-nest controller whose errors reach
 * the agent through ToolErrorFilter. Every tool class uses this, never a bare
 * @McpController().
 */
export function GlitchTipTools(): ClassDecorator {
  return applyDecorators(McpController(), UseFilters(ToolErrorFilter));
}

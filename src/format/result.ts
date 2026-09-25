import type { CallToolResult } from '@modelcontextprotocol/server';

// Every handler returns an explicit `content` array: mcp-nest JSON-quotes any
// other return value (notes §4). No structuredContent in v1 (D-12).

export function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] };
}

export function json(value: unknown): CallToolResult {
  return text(JSON.stringify(value, null, 2));
}

/** A failure the handler detected itself; GlitchTip failures go through the filter. */
export function error(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

import { RpcException } from '@nestjs/microservices';
import type { z } from 'zod';

/**
 * mcp-nest passes a prompt's raw `arguments` (strings, possibly `undefined`)
 * to the handler with no validation of its own (D-27); this is that
 * validation. A failure is an object `RpcException` — never a string, which
 * would reach the client as `-32603 "Internal error"` instead of `-32602`.
 */
export function validatePromptArgs<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  name: string,
  args: Record<string, string> | undefined,
): z.infer<z.ZodObject<Shape>> {
  const result = schema.safeParse(args ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const argument = String(issue.path[0] ?? 'arguments');
  throw new RpcException({
    code: -32602,
    message: `Invalid arguments for prompt ${name}: ${argument} ${issue.message}.`,
  });
}

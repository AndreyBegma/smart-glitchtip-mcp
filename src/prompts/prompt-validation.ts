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
  const argument = issue.path[0] === undefined ? 'arguments' : String(issue.path[0]);
  const detail = missingRequiredArg(issue)
    ? 'is required'
    : withoutLeadingArgument(issue.message, argument);
  throw new RpcException({
    code: -32602,
    message: `Invalid arguments for prompt ${name}: ${argument} ${detail}.`,
  });
}

/** A required string field that got no value at all: zod's own message names no argument. */
function missingRequiredArg(issue: z.ZodIssue): boolean {
  return issue.code === 'invalid_type' && issue.input === undefined;
}

/**
 * `pathSegmentParam`'s own messages already name the argument (`"version
 * must not be empty"`), since the toolsets reuse them directly in their own
 * errors; strip that leading repeat so the prompt's own `<argument> ` prefix
 * is not doubled (`"version version must not be empty"`).
 */
function withoutLeadingArgument(message: string, argument: string): string {
  const prefix = `${argument} `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

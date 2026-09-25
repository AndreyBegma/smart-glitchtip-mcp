import type { CallToolResult } from '@modelcontextprotocol/server';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { applyBudget } from './budget';
import { json, text } from './result';

/** The `format` argument every tool accepts. */
export const formatParam = z
  .enum(['text', 'json'])
  .default('text')
  .describe(
    'text (default): compact, for reading. json: the same fields as JSON, for further processing.',
  );
export type OutputFormat = z.infer<typeof formatParam>;

/** Both renderings of one result; only the one asked for is built. */
export interface View {
  text(): string;
  json(): unknown;
}

/**
 * Turns a tool's view into the result the agent receives: the requested
 * format, bounded by MCP_RESPONSE_BUDGET (D-12).
 */
@Injectable()
export class ToolOutput {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  render(format: OutputFormat, view: View): CallToolResult {
    const result = format === 'json' ? json(view.json()) : text(view.text());
    const [first] = result.content;
    if (first?.type === 'text') first.text = applyBudget(first.text, this.config.responseBudget);
    return result;
  }
}

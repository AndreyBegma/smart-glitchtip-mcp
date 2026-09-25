import type { CallToolResult } from '@modelcontextprotocol/server';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { applyBudget } from './budget';
import { applyJsonBudget } from './json-budget';
import { text } from './result';
import { type UntrustedSource, untrusted } from './untrusted';

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
  /**
   * Declares the JSON rendering as GlitchTip data (D-18): `render` wraps the
   * serialised JSON in one fence, so the text between the tags still parses.
   * Text renderings fence their own fields.
   */
  readonly untrusted?: { readonly field: string; readonly source?: UntrustedSource };
}

/**
 * A view could not be rendered because GlitchTip's response did not have the
 * shape this server expects (a `TypeError`/`RangeError` while reading it).
 * Not agent-facing on purpose: ToolErrorFilter logs the cause with an error
 * id and gives the agent the `malformed` message.
 */
export class MalformedViewError extends Error {
  constructor(
    /** The tool that was rendering, or "this call". */
    readonly operation: string,
    options: { cause: unknown },
  ) {
    super(`A view of ${operation} could not read the GlitchTip response.`, options);
    this.name = 'MalformedViewError';
  }
}

/** A thrown value that means "the response did not have the expected shape". */
export function isShapeError(error: unknown): error is TypeError | RangeError {
  return error instanceof TypeError || error instanceof RangeError;
}

/**
 * Turns a tool's view into the result the agent receives: the requested
 * format, bounded by MCP_RESPONSE_BUDGET (D-12). JSON stays valid JSON under
 * the budget; text is cut on a line boundary, never inside an open fence.
 */
@Injectable()
export class ToolOutput {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  render(format: OutputFormat, view: View, operation = 'this call'): CallToolResult {
    try {
      return text(format === 'json' ? this.json(view) : this.text(view));
    } catch (error) {
      if (isShapeError(error)) throw new MalformedViewError(operation, { cause: error });
      throw error;
    }
  }

  private text(view: View): string {
    return applyBudget(view.text(), this.config.responseBudget);
  }

  private json(view: View): string {
    const value = view.json();
    const budget = this.config.responseBudget;
    const fence = view.untrusted;
    if (!fence) return serialise(applyJsonBudget(value, budget));
    const wrap = (json: string) => untrusted(fence.field, json, fence.source);
    // Budget the JSON for the room the fence leaves; escaping `&` and `<`
    // can still push it over, so tighten by the excess until it fits.
    let room = budget - wrap('').length;
    for (;;) {
      const fenced = wrap(serialise(applyJsonBudget(value, room)));
      if (fenced.length <= budget || room <= 0) return fenced;
      room -= fenced.length - budget;
    }
  }
}

function serialise(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

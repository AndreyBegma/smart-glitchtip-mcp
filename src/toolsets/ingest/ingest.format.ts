import type { View } from '../../format/tool-output';

/** A confirmation with no richer shape than its own summary text (D-12). */
export function ingestResultView(summary: string, data: Record<string, unknown> = {}): View {
  return { text: () => summary, json: () => ({ result: summary, ...data }) };
}

/** Appends the DSN/instance host-mismatch diagnostic line, if there is one. */
export function withHostNote(message: string, note?: string): string {
  return note ? `${message}\n${note}` : message;
}

import type { DestinationStream } from 'pino';

/** A pino destination that keeps every line in memory, for asserting on log output. */
export function captureStream(): { stream: DestinationStream; text(): string } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(''),
  };
}

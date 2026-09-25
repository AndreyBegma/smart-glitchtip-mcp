import { z } from 'zod';
import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { UploadError } from './upload.error';

// The snapshot declares no response body for chunk-upload and the assemble
// routes, so their answers are checked here before anything reads them.

export const chunkUploadInfoSchema = z.object({
  /** Where GlitchTip says to send chunks; never used (AGENTS.md rule 9). */
  url: z.string().nullish(),
  chunkSize: z.number().int().positive(),
  chunksPerRequest: z.number().int().positive(),
  maxFileSize: z.number().int().positive(),
  maxRequestSize: z.number().int().positive().nullish(),
  concurrency: z.number().int().positive(),
  hashAlgorithm: z.string(),
  compression: z.array(z.string()),
  accept: z.array(z.string()),
});
export type ChunkUploadInfo = z.infer<typeof chunkUploadInfoSchema>;

export const assembleStateSchema = z.object({
  state: z.string(),
  missingChunks: z.array(z.string()).default([]),
  detail: z.string().nullish(),
});
export type AssembleState = z.infer<typeof assembleStateSchema>;

export const difAssembleReplySchema = z.record(z.string(), assembleStateSchema);

export const proguardReplySchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]),
    debugId: z.string().nullish(),
    uuid: z.string().nullish(),
    objectName: z.string().nullish(),
    size: z.number().nullish(),
    sha1: z.string().nullish(),
  }),
);
export type ProguardReply = z.infer<typeof proguardReplySchema>;

/** The error for an answer that is not JSON, or not the shape `step` expects. */
export function unexpectedResponse(step: string): UploadError {
  return new UploadError(`GlitchTip returned an unexpected response for ${step}.`);
}

/** Parses `value` with `schema`, or throws the unexpected-response error for `step`. */
export function expectShape<T>(schema: z.ZodType<T>, value: unknown, step: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw unexpectedResponse(step);
  return parsed.data;
}

/**
 * Awaits one GlitchTip call and names the step when its answer was not JSON;
 * every other failure passes through with the client's message.
 */
export async function atStep<T>(step: string, call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof GlitchTipError && error.kind === 'malformed') {
      throw unexpectedResponse(step);
    }
    throw error;
  }
}

import { z } from 'zod';
import { versionParam } from '../toolsets/releases/releases.params';

// Argument schemas for the two prompts (D-27 §Arguments). Each prompt's own
// z.object serves both `prompts/list` (via `.describe()`, read last in the
// chain so it lands on the outer, optional wrapper) and validation
// (`safeParse` in prompt-validation.ts).

const SLUG = /^[A-Za-z0-9_-]+$/;

/** `""` counts as absent: clients send empty fields for an omitted argument. */
function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

export const promptOrganizationParam = z
  .preprocess(emptyToUndefined, z.string().regex(SLUG, 'must be an organization slug').optional())
  .describe("Organization slug. Optional: the server's default is used.");

export const promptProjectParam = z
  .preprocess(emptyToUndefined, z.string().regex(SLUG, 'must be a project slug').optional())
  .describe('Project slug. Optional: narrows the release and its issues to one project.');

const ISSUE_ID = /^[1-9][0-9]{0,18}$/;

/** Rendered as a JSON number (D-27 §Arguments): validated as a string, then converted. */
export const promptIssueIdParam = z
  .string()
  .regex(ISSUE_ID, 'must be a positive integer issue id')
  .refine((value) => Number.isSafeInteger(Number(value)), 'must be a safe integer')
  .transform((value) => Number(value))
  .describe('Numeric issue id (not the shortId like PROJ-123).');

/** The releases toolset's own `versionParam` (1–255 chars, no dots-only/`/\%`/control/bidi), with
 * the prompt's own argument description (D-27 §Arguments) in place of the tool's. */
export const promptVersionParam = versionParam.describe(
  'Release version, exactly as GlitchTip shows it.',
);

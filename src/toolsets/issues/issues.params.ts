import { z } from 'zod';

/** Numeric issue id GlitchTip uses in paths — not the shortId like `PROJ-123`. */
export const issueIdParam = z
  .number()
  .int()
  .positive()
  .describe("Numeric issue id (GlitchTip's numeric id, not the shortId like PROJ-123).");

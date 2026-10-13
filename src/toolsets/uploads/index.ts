import type { ToolsetDefinition } from '../toolset';
import { UploadsMutations } from './uploads.mutations';
import { UploadsTools } from './uploads.tools';

// Stdio only, and only with GLITCHTIP_UPLOAD_ROOT set: configuration leaves
// this toolset out otherwise (D-22, src/config/config.ts).
export const toolset: ToolsetDefinition = {
  name: 'uploads',
  read: [UploadsTools],
  write: [UploadsMutations],
  available: true,
};

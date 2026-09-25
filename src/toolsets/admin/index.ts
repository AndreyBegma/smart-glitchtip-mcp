import type { ToolsetDefinition } from '../toolset';
import { AdminMutations } from './admin.mutations';
import { AdminTools } from './admin.tools';

export const toolset: ToolsetDefinition = {
  name: 'admin',
  read: [AdminTools],
  write: [AdminMutations],
  available: true,
};

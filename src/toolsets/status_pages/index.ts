import type { ToolsetDefinition } from '../toolset';
import { StatusPagesMutations } from './status_pages.mutations';
import { StatusPagesTools } from './status_pages.tools';

export const toolset: ToolsetDefinition = {
  name: 'status_pages',
  read: [StatusPagesTools],
  write: [StatusPagesMutations],
  available: true,
};

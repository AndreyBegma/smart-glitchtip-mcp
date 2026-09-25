import type { ToolsetDefinition } from '../toolset';
import { ProjectAccessMutations } from './project-access.mutations';
import { ProjectKeysMutations } from './project-keys.mutations';
import { ProjectsMutations } from './projects.mutations';
import { ProjectsTools } from './projects.tools';

export const toolset: ToolsetDefinition = {
  name: 'projects',
  read: [ProjectsTools],
  write: [ProjectsMutations, ProjectKeysMutations, ProjectAccessMutations],
  available: true,
};

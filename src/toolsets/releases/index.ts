import type { ToolsetDefinition } from '../toolset';
import { ReleasesMutations } from './releases.mutations';
import { ReleasesTools } from './releases.tools';
import { RepositoriesMutations } from './repositories.mutations';
import { RepositoriesTools } from './repositories.tools';

export const toolset: ToolsetDefinition = {
  name: 'releases',
  read: [ReleasesTools, RepositoriesTools],
  write: [ReleasesMutations, RepositoriesMutations],
  available: true,
};

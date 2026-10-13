import type { ToolsetDefinition } from '../toolset';
import { TeamsMutations } from './teams.mutations';
import { TeamsTools } from './teams.tools';

export const toolset: ToolsetDefinition = {
  name: 'teams',
  read: [TeamsTools],
  write: [TeamsMutations],
  available: true,
};

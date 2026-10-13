import type { ToolsetDefinition } from '../toolset';
import { StatsTools } from './stats.tools';

export const toolset: ToolsetDefinition = {
  name: 'stats',
  read: [StatsTools],
  write: [],
  available: true,
};

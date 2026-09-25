import type { ToolsetDefinition } from '../toolset';
import { PerformanceTools } from './performance.tools';

export const toolset: ToolsetDefinition = {
  name: 'performance',
  read: [PerformanceTools],
  write: [],
  available: true,
};

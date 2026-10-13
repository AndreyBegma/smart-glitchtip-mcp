import type { ToolsetDefinition } from '../toolset';
import { MonitorsMutations } from './monitors.mutations';
import { MonitorsTools } from './monitors.tools';

export const toolset: ToolsetDefinition = {
  name: 'monitors',
  read: [MonitorsTools],
  write: [MonitorsMutations],
  available: true,
};

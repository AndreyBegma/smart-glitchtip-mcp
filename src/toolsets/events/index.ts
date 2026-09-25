import type { ToolsetDefinition } from '../toolset';
import { EventsTools } from './events.tools';

export const toolset: ToolsetDefinition = {
  name: 'events',
  read: [EventsTools],
  write: [],
  available: true,
};

import type { ToolsetDefinition } from '../toolset';
import { EventResources } from './events.resources';
import { EventsTools } from './events.tools';

export const toolset: ToolsetDefinition = {
  name: 'events',
  read: [EventsTools, EventResources],
  write: [],
  available: true,
};

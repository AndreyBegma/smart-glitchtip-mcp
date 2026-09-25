import type { ToolsetDefinition } from '../toolset';
import { LogsTools } from './logs.tools';

export const toolset: ToolsetDefinition = {
  name: 'logs',
  read: [LogsTools],
  write: [],
  available: true,
};

import type { ToolsetDefinition } from '../toolset';
import { AlertRecipientsMutations } from './alert-recipients.mutations';
import { AlertsMutations } from './alerts.mutations';
import { AlertsTools } from './alerts.tools';

export const toolset: ToolsetDefinition = {
  name: 'alerts',
  read: [AlertsTools],
  write: [AlertsMutations, AlertRecipientsMutations],
  available: true,
};

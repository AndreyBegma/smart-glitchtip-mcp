import type { ToolsetDefinition } from '../toolset';
import { BillingMutations } from './billing.mutations';
import { BillingTools } from './billing.tools';

export const toolset: ToolsetDefinition = {
  name: 'billing',
  read: [BillingTools],
  write: [BillingMutations],
  available: true,
};

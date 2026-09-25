import type { ToolsetDefinition } from '../toolset';
import { OrganizationsMutations } from './organizations.mutations';
import { OrganizationsTools } from './organizations.tools';

export const toolset: ToolsetDefinition = {
  name: 'organizations',
  read: [OrganizationsTools],
  write: [OrganizationsMutations],
  available: true,
};

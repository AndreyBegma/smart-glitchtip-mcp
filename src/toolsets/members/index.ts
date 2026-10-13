import type { ToolsetDefinition } from '../toolset';
import { MembersMutations } from './members.mutations';
import { MembersTools } from './members.tools';

export const toolset: ToolsetDefinition = {
  name: 'members',
  read: [MembersTools],
  write: [MembersMutations],
  available: true,
};

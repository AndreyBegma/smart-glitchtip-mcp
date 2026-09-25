import type { ToolsetDefinition } from '../toolset';
import { IssuesMutations } from './issues.mutations';
import { IssueSubresourceMutations } from './issues.subresource.mutations';
import { IssueSubresourceTools } from './issues.subresource.tools';
import { IssuesTools } from './issues.tools';

export const toolset: ToolsetDefinition = {
  name: 'issues',
  read: [IssuesTools, IssueSubresourceTools],
  write: [IssuesMutations, IssueSubresourceMutations],
  available: true,
};

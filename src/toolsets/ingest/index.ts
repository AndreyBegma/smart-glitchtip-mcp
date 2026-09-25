import type { ToolsetDefinition } from '../toolset';
import { IngestMutations } from './ingest.mutations';

export const toolset: ToolsetDefinition = {
  name: 'ingest',
  read: [],
  write: [IngestMutations],
  available: true,
};

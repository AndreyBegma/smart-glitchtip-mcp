import type { ToolsetDefinition } from '../toolset';
import { ApiGetTools } from './api-get.tools';
import { ApiRequestMutations } from './api-request.mutations';

/**
 * The escape hatch (D-21): `api_get` whenever the toolset is enabled;
 * `api_request` only when the server is not read-only and
 * GLITCHTIP_API_REQUEST_ALLOW_WRITE is true — decided at registration (D-07).
 */
export const toolset: ToolsetDefinition = {
  name: 'api_request',
  read: [ApiGetTools],
  write: [ApiRequestMutations],
  available: true,
  writeEnabled: (config) => config.apiRequestAllowWrite,
};

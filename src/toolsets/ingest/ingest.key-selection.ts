import type { components } from '../../glitchtip/generated/schema';
import type { GlitchTipClient } from '../../glitchtip/glitchtip.client';
import { parseDsn } from './ingest.dsn';

/**
 * The snapshot's `ProjectKeySchema` has no `isActive`; the GlitchTip source's
 * has one (spec "Choosing the key"). A missing field counts as active.
 */
type RawProjectKey = components['schemas']['ProjectKeySchema'] & { readonly isActive?: unknown };

export interface PickedKey {
  readonly id: string;
  readonly label: string;
  readonly public: string;
  readonly projectID: number;
}

export type KeySelection =
  | { readonly ok: true; readonly key: PickedKey; readonly dsnHostMismatch?: string }
  | { readonly ok: false; readonly message: string };

const PROJECT_KEY_SCOPES = ['project:read', 'project:write', 'project:admin'] as const;

/** Step 1 of "Choosing the key": every client key of the project, on the resolved instance. */
export async function listProjectKeys(
  client: GlitchTipClient,
  org: string,
  project: string,
): Promise<readonly RawProjectKey[]> {
  const page = await client.page(
    {
      name: 'list project keys',
      scopes: PROJECT_KEY_SCOPES,
      resource: 'Project',
      id: project,
      org,
    },
    (api) =>
      api.GET('/api/0/projects/{organization_slug}/{project_slug}/keys/', {
        params: {
          path: { organization_slug: org, project_slug: project },
          query: { limit: 100 },
        },
      }),
  );
  return page.items as readonly RawProjectKey[];
}

function keyLabel(key: RawProjectKey): string {
  return key.label ?? key.name ?? '(unlabelled)';
}

function isActive(key: RawProjectKey): boolean {
  return key.isActive !== false;
}

function toPickedKey(key: RawProjectKey): PickedKey {
  return { id: key.id, label: keyLabel(key), public: key.public, projectID: key.projectID };
}

/**
 * Step 2 of "Choosing the key": `key_id`, or `dsn`, or the project's sole key.
 * Never makes a request itself — `keys` is already fetched. A failed pick is
 * a validation-shaped error the caller returns as `isError`, before any
 * ingest request (spec "Errors", acceptance 9 and 11).
 */
export function selectKey(
  keys: readonly RawProjectKey[],
  org: string,
  project: string,
  input: { readonly keyId?: string; readonly dsn?: string },
  instanceOrigin: string,
): KeySelection {
  let chosen: RawProjectKey | undefined;
  let dsnHostMismatch: string | undefined;

  if (input.keyId !== undefined) {
    chosen = keys.find((key) => key.id === input.keyId);
    if (!chosen) {
      return {
        ok: false,
        message: `Key ${input.keyId} is not a client key of ${org}/${project}.`,
      };
    }
  } else if (input.dsn !== undefined) {
    // The dsn param schema already refused an unparseable value.
    const parsed = parseDsn(input.dsn) as NonNullable<ReturnType<typeof parseDsn>>;
    chosen = keys.find(
      (key) =>
        key.public.toLowerCase() === parsed.publicKey.toLowerCase() &&
        key.projectID === parsed.projectId,
    );
    if (!chosen) {
      return {
        ok: false,
        message: `This DSN is not a key of ${org}/${project} on ${instanceOrigin}.`,
      };
    }
    const instanceHost = new URL(instanceOrigin).host;
    if (parsed.host.toLowerCase() !== instanceHost.toLowerCase()) {
      dsnHostMismatch =
        `The DSN names host ${parsed.host}; this server reached the instance at ` +
        `${instanceOrigin}. SDKs send to the DSN host.`;
    }
  } else if (keys.length === 1) {
    chosen = keys[0];
  } else if (keys.length === 0) {
    return { ok: false, message: `${org}/${project} has no client keys.` };
  } else {
    const list = keys.map((key) => `${key.id} | ${keyLabel(key)}`).join('; ');
    return {
      ok: false,
      message: `Several client keys exist for ${org}/${project}: ${list}. Pass \`key_id\`.`,
    };
  }

  if (!isActive(chosen)) {
    return { ok: false, message: `Key ${chosen.id} is inactive.` };
  }
  return { ok: true, key: toPickedKey(chosen), dsnHostMismatch };
}

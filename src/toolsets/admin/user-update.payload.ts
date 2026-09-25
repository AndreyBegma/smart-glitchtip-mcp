import type { components } from '../../glitchtip/generated/schema';
import { AdminRefusal } from './admin.calls';
import { type Fields, isFields } from './admin.values';

type UserIn = components['schemas']['UserIn'];
type UserOptions = components['schemas']['UserOptions'];

/** What `update_current_user` may change; an omitted field keeps its stored value. */
export interface UserChanges {
  readonly name?: string | null;
  readonly timezone?: string;
  readonly language?: string;
  readonly clock_24_hours?: boolean;
  readonly preferred_theme?: string;
}

type Kind = 'string' | 'boolean' | 'number';

/** The option keys `UserIn` applies whole, with the input that may change each. */
const OPTIONS: readonly (readonly [keyof UserOptions, Kind, keyof UserChanges | undefined])[] = [
  ['timezone', 'string', 'timezone'],
  ['stacktraceOrder', 'number', undefined],
  ['language', 'string', 'language'],
  ['clock24Hours', 'boolean', 'clock_24_hours'],
  ['preferredTheme', 'string', 'preferred_theme'],
];

const OPTION_KEYS: ReadonlySet<string> = new Set(OPTIONS.map(([key]) => key));

/**
 * The `PUT /users/me/` body: the stored user with `changes` applied. `UserIn`
 * is applied whole — every key of `options`, unset ones as null [Confirmed:
 * `update_user` sets every attribute of `payload.dict()`] — so every field
 * this call does not change is re-sent as read. A field it must re-send that
 * the read lacks, or holds with the wrong type, refuses the write instead of
 * sending a default over GlitchTip's value (AGENTS.md rule 15). `null` is
 * GlitchTip's own "unset" and is re-sent as null.
 */
export function userUpdateBody(stored: unknown, changes: UserChanges): UserIn {
  if (!isFields(stored)) refuse('the user');
  const name =
    changes.name !== undefined ? changes.name : (kept(stored, 'name', 'string') as string | null);
  if (!isFields(stored.options)) refuse('options');
  const unknown = Object.keys(stored.options).find((key) => !OPTION_KEYS.has(key));
  if (unknown !== undefined) refuseUnknown(unknown);
  const options: Record<string, unknown> = {};
  for (const [key, kind, input] of OPTIONS) {
    const change = input === undefined ? undefined : changes[input];
    options[key] =
      change !== undefined ? change : kept(stored.options, key, kind, `options.${key}`);
  }
  return { name, options: options as UserOptions };
}

function kept(record: Fields, key: string, kind: Kind, label = key): unknown {
  if (!(key in record)) refuse(label);
  const value = record[key];
  if (value !== null && typeof value !== kind) refuse(label);
  return value;
}

/**
 * The PUT replaces `options` whole, so a stored key this server does not know
 * would be dropped by the write — rule 15 the other way round.
 */
function refuseUnknown(key: string): never {
  // The key is GlitchTip's text: named only when it is a plain identifier.
  const named = PLAIN_KEY.test(key) ? `\`options.${key}\`` : 'an option';
  throw new AdminRefusal(
    `Not updated: GlitchTip's read of the current user has ${named} this server does not ` +
      'know; the update replaces options whole and would drop it. Nothing was written. ' +
      'Change it in the GlitchTip UI.',
  );
}

const PLAIN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function refuse(field: string): never {
  throw new AdminRefusal(
    `Not updated: GlitchTip's read of the current user has no readable \`${field}\`, and the ` +
      'update must re-send it; sending a default would overwrite the stored value. Nothing was ' +
      'written. Check the user with get_current_user.',
  );
}

import type { View } from '../../format/tool-output';
import {
  booleanField,
  day,
  EM_DASH,
  type Fields,
  fenced,
  GAP,
  idText,
  isFields,
  jsonBoolean,
  jsonNumber,
  jsonString,
  listBody,
  numberField,
  objectBody,
  yesNo,
} from './admin.values';

// The token's own user and its e-mail addresses (spec "get_current_user",
// "list_user_emails"). Both renderings project an allowlist: never
// `chatwootIdentifierHash`, never an identity's `uid`, never an unknown key.
// What a person wrote — the name, e-mail addresses, option strings — is
// fenced with source glitchtip-user; an identity's provider is set by
// GlitchTip's configuration, fenced glitchtip-config (D-18).

const DEFAULT = 'default';

export function currentUserView(body: unknown): View {
  const user = objectBody(body, 'the user');
  return {
    untrusted: { field: 'user', source: 'glitchtip-user' },
    text: () =>
      [
        `id: ${idText(user.id)}`,
        `email: ${fenced('user.email', user.email, 'glitchtip-user')}`,
        `name: ${fenced('user.name', user.name ?? null, 'glitchtip-user')}`,
        `date joined: ${day(user.dateJoined)}`,
        `last login: ${user.lastLogin == null ? 'never' : day(user.lastLogin)}`,
        `superuser: ${yesNo(user.isSuperuser)}`,
        `active: ${yesNo(user.isActive)}`,
        `password sign-in: ${yesNo(user.hasPasswordAuth)}`,
        ...identityLines(user.identities),
        ...optionLines(user.options),
      ].join('\n'),
    json: () => userProjection(user),
  };
}

export function userEmailsView(body: unknown): View {
  const emails = listBody(body, 'the e-mail list');
  return {
    untrusted: { field: 'emails', source: 'glitchtip-user' },
    text: () => {
      if (emails.length === 0) return 'No e-mail addresses on the current user.';
      return [`${emails.length} e-mail address(es):`, ...emails.map(emailLine)].join('\n');
    },
    json: () => ({ emails: emails.map(emailProjection) }),
  };
}

function identityLines(identities: unknown): string[] {
  if (!Array.isArray(identities)) return [`identities: ${GAP} (not a list in the response)`];
  if (identities.length === 0) return ['identities: none'];
  return [
    `identities: ${identities.length}`,
    ...identities.map((identity) => {
      if (!isFields(identity)) return `  - ${GAP}`;
      const provider = fenced('identity.provider', identity.provider, 'glitchtip-config');
      const email = fenced('identity.email', identity.email, 'glitchtip-user');
      return `  - ${provider} ${email}`;
    }),
  ];
}

function optionLines(options: unknown): string[] {
  if (!isFields(options)) return [`options: ${GAP} (missing from the response)`];
  return [
    `timezone: ${fenced('user.timezone', options.timezone ?? null, 'glitchtip-user', DEFAULT)}`,
    `language: ${fenced('user.language', options.language ?? null, 'glitchtip-user', DEFAULT)}`,
    `24-hour clock: ${options.clock24Hours == null ? DEFAULT : yesNo(options.clock24Hours)}`,
    `theme: ${fenced('user.theme', options.preferredTheme ?? null, 'glitchtip-user', DEFAULT)}`,
    `stacktrace order: ${stacktraceOrder(options.stacktraceOrder)}`,
  ];
}

// Its meaning is [Unknown] upstream; the raw number is shown, never interpreted.
function stacktraceOrder(value: unknown): string {
  if (value == null) return DEFAULT;
  const n = numberField(value);
  return n === undefined ? GAP : String(n);
}

function emailLine(entry: unknown): string {
  if (!isFields(entry)) return `- ${GAP}`;
  const email = fenced('user.email', entry.email, 'glitchtip-user', EM_DASH);
  return `- ${email}  primary: ${yesNo(entry.isPrimary)}  verified: ${yesNo(entry.isVerified)}`;
}

function userProjection(user: Fields) {
  return {
    id: jsonString(user.id) ?? jsonNumber(user.id),
    email: jsonString(user.email),
    name: jsonString(user.name),
    dateJoined: jsonString(user.dateJoined),
    lastLogin: jsonString(user.lastLogin),
    isSuperuser: jsonBoolean(user.isSuperuser),
    isActive: jsonBoolean(user.isActive),
    hasPasswordAuth: jsonBoolean(user.hasPasswordAuth),
    identities: Array.isArray(user.identities) ? user.identities.map(identityProjection) : null,
    options: isFields(user.options) ? optionsProjection(user.options) : null,
  };
}

function identityProjection(identity: unknown) {
  if (!isFields(identity)) return null;
  return { provider: jsonString(identity.provider), email: jsonString(identity.email) };
}

function optionsProjection(options: Fields) {
  return {
    timezone: jsonString(options.timezone),
    language: jsonString(options.language),
    clock24Hours: booleanField(options.clock24Hours) ?? null,
    preferredTheme: jsonString(options.preferredTheme),
    stacktraceOrder: jsonNumber(options.stacktraceOrder),
  };
}

function emailProjection(entry: unknown) {
  if (!isFields(entry)) return null;
  return {
    email: jsonString(entry.email),
    primary: jsonBoolean(entry.isPrimary),
    verified: jsonBoolean(entry.isVerified),
  };
}

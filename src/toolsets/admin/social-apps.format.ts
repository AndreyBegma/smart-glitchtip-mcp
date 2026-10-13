import type { View } from '../../format/tool-output';
import {
  fenced,
  GAP,
  isFields,
  jsonNumber,
  jsonString,
  listBody,
  numberField,
} from './admin.values';

// An organization's SSO apps (spec "list_social_apps"). The projection is an
// allowlist: a `clientSecret`, `secret`, `token` or any unknown key never
// reaches either rendering, even if a response carried one. Names and URLs
// are set by an organization manager, fenced with source glitchtip-config
// (D-18). The client ID is public by OIDC design.

export function socialAppsView(body: unknown, org: string): View {
  const apps = listBody(body, 'the SSO app list');
  return {
    untrusted: { field: 'social_apps', source: 'glitchtip-config' },
    text: () => {
      if (apps.length === 0) return `No SSO apps in ${org}.`;
      return [`${apps.length} SSO app(s) in ${org}:`, ...apps.flatMap(appLines)].join('\n');
    },
    json: () => ({ organization: org, socialApps: apps.map(appProjection) }),
  };
}

function appLines(app: unknown): string[] {
  if (!isFields(app)) return [`- ${GAP}`];
  const field = (name: string, value: unknown) =>
    `  ${name}: ${fenced(`social_app.${name.replace(/ /g, '_')}`, value, 'glitchtip-config')}`;
  return [
    `- SSO app ${idText(app.id)}: ${fenced('social_app.name', app.name, 'glitchtip-config')}`,
    field('provider', app.provider),
    field('brand', app.brand),
    field('server URL', app.serverUrl),
    field('login URL', app.loginUrl),
    field('callback URL', app.callbackUrl),
    field('client ID', app.clientID),
  ];
}

function idText(value: unknown): string {
  const id = numberField(value);
  return id === undefined ? GAP : String(id);
}

function appProjection(app: unknown) {
  if (!isFields(app)) return null;
  return {
    id: jsonNumber(app.id),
    name: jsonString(app.name),
    provider: jsonString(app.provider),
    brand: jsonString(app.brand),
    serverUrl: jsonString(app.serverUrl),
    loginUrl: jsonString(app.loginUrl),
    callbackUrl: jsonString(app.callbackUrl),
    clientID: jsonString(app.clientID),
  };
}

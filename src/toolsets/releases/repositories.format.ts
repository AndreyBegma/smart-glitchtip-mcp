import { withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';
import { capText, flatten, withFencedTrailer } from './releases.format';

type Repository = components['schemas']['RepositorySchema'];

function providerText(provider: Repository['provider']): string {
  return provider && typeof provider.name === 'string' ? provider.name : '—';
}

// status and provider.name are table-column-sized in practice, but GlitchTip does not
// constrain either to a fixed set server-side, so they are fenced like name/url rather than
// put through table()'s cell cut, which would risk cutting a fence mid-tag (orchestrator
// review of #20 nit).
function repositoryTable(repos: readonly Repository[]): string {
  return withFencedTrailer(
    repos,
    [
      { header: 'id', value: (r) => r.id },
      { header: 'created', value: (r) => r.dateCreated },
    ],
    (r) => {
      const name = untrusted('name', capText(flatten(r.name ?? '')), 'glitchtip-config');
      const url = r.url ? `  ${untrusted('url', capText(flatten(r.url)), 'glitchtip-config')}` : '';
      const status = untrusted('status', capText(flatten(r.status ?? '')), 'glitchtip-config');
      const provider = providerText(r.provider);
      const providerFenced =
        provider === '—'
          ? '—'
          : untrusted('provider', capText(flatten(provider)), 'glitchtip-config');
      return `${name}${url}  status: ${status}  provider: ${providerFenced}`;
    },
  );
}

function repositoryProjection(r: Repository) {
  return {
    id: r.id,
    name: r.name,
    url: r.url ?? null,
    status: r.status,
    provider: providerText(r.provider) === '—' ? null : providerText(r.provider),
    dateCreated: r.dateCreated,
  };
}

export function repositoryListView(org: string, page: Page<Repository>): View {
  const repositories = page.items;
  return {
    untrusted: { field: 'repositories', source: 'glitchtip-config' },
    text: () => {
      if (repositories.length === 0) return `No repositories in ${org}.`;
      return withCursor(repositoryTable(repositories), page.nextCursor);
    },
    json: () => ({
      repositories: repositories.map(repositoryProjection),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function repositoryCreatedView(org: string, repo: Repository): View {
  const summary = `Registered a repository in ${org}.`;
  return {
    untrusted: { field: 'repositories', source: 'glitchtip-config' },
    text: () => `${summary}\n${repositoryTable([repo])}`,
    json: () => ({ result: summary, ...repositoryProjection(repo) }),
  };
}

#!/usr/bin/env node
// Refreshes docs/reference/glitchtip-openapi.json from a live instance.
// Usage: GLITCHTIP_URL=https://glitchtip.example.com bun run api:sync
// The schema endpoint is public; no token is sent.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIMEOUT_MS = 30_000;
const SNAPSHOT = resolve(
  import.meta.dirname,
  '..',
  '..',
  'docs',
  'reference',
  'glitchtip-openapi.json',
);

const base = process.env.GLITCHTIP_URL;
if (!base) {
  console.error('api:sync needs GLITCHTIP_URL (the instance to read the schema from).');
  process.exit(1);
}

const url = new URL('/api/openapi.json', base);
const response = await fetch(url, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
if (!response.ok) {
  console.error(`api:sync: ${url.origin} answered ${response.status}.`);
  process.exit(1);
}
const schema = await response.json();
writeFileSync(SNAPSHOT, `${JSON.stringify(schema, null, 2)}\n`);
console.error(
  `api:sync: wrote ${SNAPSHOT} (GlitchTip ${schema.info?.version ?? 'unknown version'}).`,
);

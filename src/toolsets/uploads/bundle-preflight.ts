import { untrusted } from '../../format/untrusted';
import { UploadError } from './upload.error';
import type { UploadFile } from './upload-path';
import { extractSmallEntry, readZipEntries } from './zip-directory';

// Local checks run before any request. They catch what GlitchTip would
// otherwise reject with an empty 400 (ProGuard) or drop silently in a
// background task (artifact bundles).

const PROGUARD_ENTRY =
  /^proguard\/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.txt$/;
const MAX_PROGUARD_ENTRIES = 1000;
const MANIFEST = 'manifest.json';

/** Refuses a ProGuard zip unless it holds 1–1000 entries, each `proguard/<uuid>.txt`. */
export async function checkProguardZip(file: UploadFile): Promise<number> {
  const entries = await readZipEntries(file);
  const shown = JSON.stringify(file.given);
  if (entries.length === 0 || entries.length > MAX_PROGUARD_ENTRIES) {
    throw new UploadError(
      `${shown} holds ${entries.length} entries; a ProGuard zip holds 1 to ${MAX_PROGUARD_ENTRIES}.`,
    );
  }
  const stray = entries.find((entry) => !PROGUARD_ENTRY.test(entry.name));
  if (stray) {
    throw new UploadError(
      `${shown} contains ${untrusted('entry', stray.name, 'external')}; every entry must be named proguard/<uuid>.txt.`,
    );
  }
  return entries.length;
}

/** What an artifact bundle's manifest says, as far as the upload needs it. */
export interface BundleManifest {
  readonly org: string | undefined;
  readonly release: string | undefined;
  readonly files: number;
  readonly debugIds: number;
}

/**
 * Reads the bundle's manifest.json and checks what can be checked without
 * knowing the organization: `release` must match, `files` must be a
 * non-empty object, and something must be matchable to an event.
 */
export async function readBundleManifest(
  file: UploadFile,
  release: string | undefined,
): Promise<BundleManifest> {
  const shown = JSON.stringify(file.given);
  const manifests = (await readZipEntries(file)).filter((e) => e.name === MANIFEST);
  if (manifests.length === 0) throw new UploadError(`${shown} has no manifest.json at its root.`);
  // This reader and GlitchTip's zipfile would pick different copies (first vs last).
  if (manifests.length > 1) {
    throw new UploadError(`${shown} has more than one manifest.json; build it again.`);
  }
  const [entry] = manifests;
  const manifest = parseManifest(shown, await extractSmallEntry(file, entry));
  if (manifest.release !== release) {
    throw new UploadError(
      `The bundle's manifest names release ${shownValue(manifest.release)}, not ${release === undefined ? '(none)' : JSON.stringify(release)}: GlitchTip would drop it silently.`,
    );
  }
  if (release === undefined && manifest.debugIds === 0) {
    throw new UploadError(
      'Nothing in this bundle could ever be matched to an event: pass `release`, or build with debug ids.',
    );
  }
  return manifest;
}

/** The manifest's `org` must be the organization the bundle is uploaded to. */
export function checkBundleOrganization(manifest: BundleManifest, org: string): void {
  if (manifest.org === org) return;
  throw new UploadError(
    `The bundle's manifest names organization ${shownValue(manifest.org)}, not ${org}: GlitchTip would drop it silently.`,
  );
}

function parseManifest(shown: string, bytes: Buffer): BundleManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new UploadError(`${shown}: manifest.json is not valid JSON.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UploadError(`${shown}: manifest.json is not a JSON object.`);
  }
  const { org, release, files } = value as Record<string, unknown>;
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new UploadError(`${shown}: manifest.json has no \`files\` object.`);
  }
  const records = Object.values(files);
  if (records.length === 0) throw new UploadError(`${shown}: manifest.json lists no files.`);
  return {
    org: optionalString(shown, 'org', org),
    release: optionalString(shown, 'release', release),
    files: records.length,
    debugIds: records.filter(hasDebugId).length,
  };
}

function optionalString(shown: string, key: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  throw new UploadError(`${shown}: manifest.json \`${key}\` is not a string.`);
}

function hasDebugId(record: unknown): boolean {
  const headers = (record as { headers?: unknown } | null)?.headers;
  if (typeof headers !== 'object' || headers === null) return false;
  return Object.entries(headers).some(
    ([name, value]) =>
      name.toLowerCase() === 'debug-id' && typeof value === 'string' && value !== '',
  );
}

/** A manifest value, read from a local zip the build tooling produced (D-18). */
function shownValue(value: string | undefined): string {
  return value === undefined ? '(none)' : untrusted('manifest', value, 'external');
}

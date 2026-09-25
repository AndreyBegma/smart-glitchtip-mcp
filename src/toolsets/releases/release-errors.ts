import { GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { flatten } from './releases.format';

/**
 * Rewrites a 404 on a release-scoped call into a message naming the version,
 * the organization and — when the call was project-scoped — the project
 * (spec §Errors: "Release <version> was not found in <org>[ for project
 * <slug>]."). Every other error passes through unchanged.
 */
export async function callForRelease<T>(
  call: Promise<T>,
  org: string,
  version: string,
  project?: string,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      const where = project ? `${org} for project ${project}` : org;
      throw new GlitchTipError(
        'not_found',
        `Release ${version} was not found in ${where}.`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}

/**
 * Rewrites a 404 on a release-file call into a message naming the file and
 * the release (spec §Errors: "File <id> was not found in release
 * <version>.").
 */
export async function callForReleaseFile<T>(
  call: Promise<T>,
  version: string,
  fileId: number,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.kind === 'not_found') {
      throw new GlitchTipError(
        'not_found',
        `File ${fileId} was not found in release ${version}.`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}

/**
 * Rewrites a 409 on repository creation into GlitchTip's own duplicate-name
 * wording (spec §Errors: "A repository named <name> already exists in
 * <org>."). Every other error passes through unchanged.
 */
export async function callForRepositoryCreate<T>(
  call: Promise<T>,
  org: string,
  name: string,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof GlitchTipError && err.status === 409) {
      throw new GlitchTipError(
        'invalid',
        `A repository named ${flatten(name)} already exists in ${org}.`,
        err.status,
        err.detail,
      );
    }
    throw err;
  }
}

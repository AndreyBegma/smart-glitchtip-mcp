import type { CallToolResult } from '@modelcontextprotocol/server';
import { Inject } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { type McpContext, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { ToolOutput } from '../../format/tool-output';
import type { GlitchTipClient } from '../../glitchtip/glitchtip.client';
import { InstanceResolver } from '../../glitchtip/instance.resolver';
import { formatParam, mutation, organizationParam } from '../../mcp/tool-params';
import { GlitchTipTools } from '../../mcp/toolset.decorators';
import { checkBundleOrganization, checkProguardZip, readBundleManifest } from './bundle-preflight';
import { type Assemble, CHUNK_TIMEOUT_MS, UPLOAD_SCOPES, uploadInChunks } from './chunk-upload';
import { UploadError } from './upload.error';
import { resolveUploadPath, type UploadFile } from './upload-path';
import { bundleUploadView, debugFileUploadView, proguardUploadView } from './uploads.format';
import { pathParam, projectParam, UNTRUSTED_NAMES_SENTENCE } from './uploads.params';
import {
  assembleStateSchema,
  atStep,
  difAssembleReplySchema,
  expectShape,
  proguardReplySchema,
  unexpectedResponse,
} from './uploads.schemas';

// Registered only when GLITCHTIP_READ_ONLY=false (D-07), and the whole
// toolset only in stdio mode with an upload root (D-22, see config.ts).

/** GlitchTip's limit on the single ProGuard POST (`dsyms`, v6.2.6). */
const PROGUARD_MAX_BYTES = 32 * 1024 * 1024;
const SLUG = /^[A-Za-z0-9_-]+$/;

const uploadDebugFileArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  path: pathParam,
  debug_id: z
    .string()
    .regex(/^[0-9A-Fa-f-]{32,42}$/, 'must be a UUID or a Breakpad debug id')
    .optional()
    .describe('Debug id (UUID or Breakpad id); GlitchTip reads it from the file if omitted.'),
  name: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !value.includes('/'), 'name must not contain /')
    .optional()
    .describe("Name to store the file under; defaults to the file's own name."),
  format: formatParam,
});

const uploadProguardMappingArgs = z.object({
  organization: organizationParam,
  project: projectParam,
  path: pathParam,
  format: formatParam,
});

const uploadArtifactBundleArgs = z.object({
  organization: organizationParam,
  path: pathParam,
  release: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !value.includes('/'), 'release must not contain /')
    .optional()
    .describe("Release version to bind the bundle to; must equal the manifest's `release`."),
  projects: z
    .array(z.string().regex(SLUG, 'must be a project slug'))
    .max(20)
    .refine((slugs) => new Set(slugs).size === slugs.length, 'projects must not repeat a slug')
    .default([])
    .describe('Project slugs to associate, sent as given (0–20, unique).'),
  format: formatParam,
});

@GlitchTipTools()
export class UploadsMutations {
  constructor(
    private readonly instances: InstanceResolver,
    private readonly output: ToolOutput,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Tool({
    name: 'upload_debug_file',
    description:
      'Upload one native debug information file (the DWARF file inside a dSYM, an ELF with ' +
      'debug info, a PDB, a Breakpad .sym) from the local upload directory to a project, so its ' +
      'crashes symbolicate. Large files are sent in chunks. Scope: project:write, project:admin ' +
      'or project:releases. ' +
      UNTRUSTED_NAMES_SENTENCE,
    parameters: uploadDebugFileArgs,
    annotations: {
      title: 'Upload debug file',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async uploadDebugFile(
    @Payload() args: z.infer<typeof uploadDebugFileArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    return this.withFile(args.path, this.config.uploads.maxBytes, async (file) => {
      const glitchtip = this.instances.connect(ctx.getRawRequest());
      const org = await glitchtip.organization(args.organization);
      const name = args.name ?? file.name;
      const assemble = difAssembler(glitchtip.client, org, args.project, name, args.debug_id);
      const outcome = await uploadInChunks(glitchtip.client, org, file, 'debug_files', assemble);
      return this.output.render(
        args.format,
        debugFileUploadView(outcome, name),
        'upload_debug_file',
      );
    });
  }

  @Tool({
    name: 'upload_proguard_mapping',
    description:
      'Upload a zip of ProGuard/R8 mapping files to a project. Each entry must be named ' +
      "`proguard/<uuid>.txt`, where the uuid is the mapping's ProGuard UUID from the build. " +
      'At most 32 MiB. Scope: project:write, project:admin or project:releases. ' +
      UNTRUSTED_NAMES_SENTENCE,
    parameters: uploadProguardMappingArgs,
    annotations: {
      title: 'Upload ProGuard mapping',
      ...mutation({ destructive: false, idempotent: true }),
    },
  })
  async uploadProguardMapping(
    @Payload() args: z.infer<typeof uploadProguardMappingArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    const cap = Math.min(this.config.uploads.maxBytes, PROGUARD_MAX_BYTES);
    return this.withFile(args.path, cap, async (file) => {
      await checkProguardZip(file);
      const bytes = Buffer.alloc(file.size);
      if ((await file.read(bytes, 0)) !== file.size) {
        throw new UploadError(
          'The file changed during upload; run the tool again once it is stable.',
        );
      }
      const glitchtip = this.instances.connect(ctx.getRawRequest());
      const org = await glitchtip.organization(args.organization);
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)]), file.name);
      const step = 'ProGuard upload';
      const reply = await atStep(
        step,
        glitchtip.client.call<unknown>(
          {
            name: 'upload ProGuard mapping',
            scopes: UPLOAD_SCOPES,
            resource: 'Project',
            id: args.project,
            org,
          },
          (api) =>
            api.POST('/api/0/projects/{organization_slug}/{project_slug}/files/dsyms/', {
              params: { path: { organization_slug: org, project_slug: args.project } },
              body: form as never,
            }),
          { timeoutMs: CHUNK_TIMEOUT_MS },
        ),
      );
      const mappings = expectShape(proguardReplySchema, reply, step);
      return this.output.render(
        args.format,
        proguardUploadView(mappings),
        'upload_proguard_mapping',
      );
    });
  }

  @Tool({
    name: 'upload_artifact_bundle',
    description:
      'Upload a source-map artifact bundle (a zip with a manifest.json, as built by Sentry ' +
      'tooling) for an organization, optionally bound to a release, so minified JavaScript ' +
      'stack traces resolve. The release is created if it does not exist. Scope: project:write, ' +
      'project:admin or project:releases. ' +
      UNTRUSTED_NAMES_SENTENCE,
    parameters: uploadArtifactBundleArgs,
    annotations: {
      title: 'Upload artifact bundle',
      ...mutation({ destructive: false, idempotent: false }),
    },
  })
  async uploadArtifactBundle(
    @Payload() args: z.infer<typeof uploadArtifactBundleArgs>,
    @Ctx() ctx: McpContext,
  ): Promise<CallToolResult> {
    return this.withFile(args.path, this.config.uploads.maxBytes, async (file) => {
      const manifest = await readBundleManifest(file, args.release);
      const glitchtip = this.instances.connect(ctx.getRawRequest());
      const org = await glitchtip.organization(args.organization);
      checkBundleOrganization(manifest, org);
      const assemble = bundleAssembler(glitchtip.client, org, args.projects, args.release);
      const outcome = await uploadInChunks(
        glitchtip.client,
        org,
        file,
        'artifact_bundles',
        assemble,
      );
      return this.output.render(
        args.format,
        bundleUploadView(outcome, manifest, args.release),
        'upload_artifact_bundle',
      );
    });
  }

  /** Opens `path` under the upload root, runs `use`, and always closes it. */
  private async withFile<T>(
    path: string,
    maxBytes: number,
    use: (file: UploadFile) => Promise<T>,
  ): Promise<T> {
    const { root } = this.config.uploads;
    // Configuration never registers this toolset without a root; this is the backstop.
    if (root === undefined) throw new UploadError('GLITCHTIP_UPLOAD_ROOT is not set.');
    const capName =
      maxBytes < this.config.uploads.maxBytes
        ? "GlitchTip's 32 MiB ProGuard limit"
        : 'GLITCHTIP_UPLOAD_MAX_BYTES';
    const file = await resolveUploadPath(path, { root, maxBytes, capName });
    try {
      return await use(file);
    } finally {
      await file.close();
    }
  }
}

function difAssembler(
  client: GlitchTipClient,
  org: string,
  project: string,
  name: string,
  debugId: string | undefined,
): Assemble {
  const step = 'assemble';
  return async (checksum, chunks) => {
    const reply = await atStep(
      step,
      client.call<unknown>(
        {
          name: 'assemble debug file',
          scopes: UPLOAD_SCOPES,
          resource: 'Project',
          id: project,
          org,
        },
        (api) =>
          api.POST('/api/0/projects/{organization_slug}/{project_slug}/files/difs/assemble/', {
            params: { path: { organization_slug: org, project_slug: project } },
            body: { [checksum]: { name, debug_id: debugId, chunks: [...chunks] } },
          }),
      ),
    );
    const state = expectShape(difAssembleReplySchema, reply, step)[checksum];
    if (!state) throw unexpectedResponse(step);
    return state;
  };
}

function bundleAssembler(
  client: GlitchTipClient,
  org: string,
  projects: readonly string[],
  release: string | undefined,
): Assemble {
  const step = 'assemble';
  return async (checksum, chunks) => {
    const reply = await atStep(
      step,
      client.call<unknown>(
        {
          name: 'assemble artifact bundle',
          scopes: UPLOAD_SCOPES,
          resource: 'Organization',
          id: org,
        },
        (api) =>
          api.POST('/api/0/organizations/{organization_slug}/artifactbundle/assemble/', {
            params: { path: { organization_slug: org } },
            body: { checksum, chunks: [...chunks], projects: [...projects], version: release },
          }),
      ),
    );
    return expectShape(assembleStateSchema, reply, step);
  };
}

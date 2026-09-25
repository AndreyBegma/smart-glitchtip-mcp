import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AppConfig, loadConfig } from '../config/config';
import { TOOLSET_NAMES, type ToolsetDefinition, type ToolsetName } from '../toolsets/toolset';
import { selectToolsets, TOOLSETS } from './toolset.registry';

describe('toolset registry (acceptance 15)', () => {
  it('covers exactly the known toolset names, once each', () => {
    expect(TOOLSETS.map((t) => t.name)).toEqual([...TOOLSET_NAMES]);
  });

  it('has a src/toolsets/<name>/index.ts for every name', () => {
    const dirs = readdirSync(join(__dirname, '..', 'toolsets'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([...TOOLSET_NAMES].sort());
  });

  it('organizations is available', () => {
    expect(TOOLSETS.find((t) => t.name === 'organizations')?.available).toBe(true);
  });

  // The general rule is "every available toolset has a read tool" (a mistaken
  // empty `read` must still fail this). `ingest` is the one deliberate
  // exception: both its tools are writes (send_test_event,
  // send_test_security_report), by the spec's own design.
  const WRITE_ONLY = new Set<ToolsetName>(['ingest']);

  it('every available toolset contributes at least one read tool, except the write-only exemption', () => {
    for (const toolset of TOOLSETS) {
      if (!toolset.available) continue;
      if (WRITE_ONLY.has(toolset.name)) {
        expect(toolset.read, toolset.name).toEqual([]);
        expect(toolset.write.length, toolset.name).toBeGreaterThan(0);
      } else {
        expect(toolset.read.length, toolset.name).toBeGreaterThan(0);
      }
    }
  });

  it('a write-only toolset (ingest) contributes nothing in read-only mode', () => {
    const ingest = TOOLSETS.find((t) => t.name === 'ingest');
    expect(ingest?.read).toEqual([]);
    expect(ingest?.write.length).toBeGreaterThan(0);
    const readOnly = selectToolsets(config({ readOnly: true }));
    for (const write of ingest?.write ?? []) {
      expect(readOnly.controllers).not.toContain(write);
    }
  });

  it('every not-yet-available toolset contributes no controllers', () => {
    for (const toolset of TOOLSETS) {
      if (!toolset.available) {
        expect(toolset.read, toolset.name).toEqual([]);
        expect(toolset.write, toolset.name).toEqual([]);
      }
    }
  });

  it('never selects write controllers in read-only mode', () => {
    const readOnly = selectToolsets(config({ readOnly: true }));
    const readWrite = selectToolsets(config({ readOnly: false }));
    for (const toolset of TOOLSETS) {
      for (const write of toolset.write) {
        expect(readOnly.controllers).not.toContain(write);
        expect(readWrite.controllers).toContain(write);
      }
    }
  });

  it('selects nothing from a disabled toolset', () => {
    expect(selectToolsets(config({ toolsets: [] }))).toEqual({ controllers: [], unavailable: [] });
  });
});

describe('writeEnabled (BUG-20260925-006 acceptance 9, gate: registration)', () => {
  class ReadTools {}
  class WriteTools {}
  const definition = (writeEnabled?: ToolsetDefinition['writeEnabled']): ToolsetDefinition => ({
    name: 'api_request',
    read: [ReadTools],
    write: [WriteTools],
    available: true,
    writeEnabled,
  });
  const enabled = { toolsets: ['api_request'] as ToolsetName[] };

  it('contributes no write controllers when it returns false, even with readOnly: false', () => {
    const selection = selectToolsets(config({ ...enabled, readOnly: false }), [
      definition(() => false),
    ]);
    expect(selection.controllers).toEqual([ReadTools]);
  });

  it('cannot register writes in read-only mode, even when it returns true', () => {
    const selection = selectToolsets(config({ ...enabled, readOnly: true }), [
      definition(() => true),
    ]);
    expect(selection.controllers).toEqual([ReadTools]);
  });

  it('sees the whole configuration', () => {
    const seen: AppConfig[] = [];
    const cfg = config({ ...enabled, readOnly: false });
    const selection = selectToolsets(cfg, [
      definition((c) => {
        seen.push(c);
        return c.responseBudget === cfg.responseBudget;
      }),
    ]);
    expect(seen).toEqual([cfg]);
    expect(selection.controllers).toEqual([ReadTools, WriteTools]);
  });

  it('leaves a toolset without it unchanged', () => {
    const selection = selectToolsets(config({ ...enabled, readOnly: false }), [definition()]);
    expect(selection.controllers).toEqual([ReadTools, WriteTools]);
  });
});

function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    ...loadConfig({ GLITCHTIP_URL: 'https://g.test' }),
    toolsets: [...TOOLSET_NAMES],
    ...overrides,
  };
}

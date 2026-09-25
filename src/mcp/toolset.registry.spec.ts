import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLSET_NAMES } from '../toolsets/toolset';
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

  it('every available toolset contributes at least one read tool', () => {
    for (const toolset of TOOLSETS) {
      if (toolset.available) expect(toolset.read.length, toolset.name).toBeGreaterThan(0);
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
    const readOnly = selectToolsets([...TOOLSET_NAMES], true);
    const readWrite = selectToolsets([...TOOLSET_NAMES], false);
    for (const toolset of TOOLSETS) {
      for (const write of toolset.write) {
        expect(readOnly.controllers).not.toContain(write);
        expect(readWrite.controllers).toContain(write);
      }
    }
  });

  it('selects nothing from a disabled toolset', () => {
    expect(selectToolsets([], false)).toEqual({ controllers: [], unavailable: [] });
  });
});

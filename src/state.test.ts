import { describe, it, expect, beforeEach } from 'vitest';
import { loadLocalConfig } from './state';
import { DEFAULT_GROUPS } from './config';

const CONFIG_KEY = 'crtl-config';

describe('loadLocalConfig', () => {
  beforeEach(() => localStorage.clear());

  it('returns the seed defaults when storage is empty', () => {
    const c = loadLocalConfig();
    expect(c.groups).toEqual(DEFAULT_GROUPS);
    expect(c.iconCache).toEqual({});
    expect(typeof c.version).toBe('number');
  });

  it('backfills missing fields from an older/partial stored shape', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ groups: [{ group: 'G', entries: [] }] }));
    const c = loadLocalConfig();
    expect(c.groups).toEqual([{ group: 'G', entries: [] }]); // kept
    expect(Array.isArray(c.homeProbes)).toBe(true);          // backfilled from defaults
    expect(c.iconCache).toEqual({});                          // backfilled
    expect(typeof c.version).toBe('number');                 // backfilled
  });

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem(CONFIG_KEY, '{ not valid json');
    expect(loadLocalConfig().groups).toEqual(DEFAULT_GROUPS);
  });

  it('coerces a corrupt non-array `groups` back to defaults (no render crash)', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ groups: 'not-an-array', homeProbes: 42 }));
    const c = loadLocalConfig();
    expect(c.groups).toEqual(DEFAULT_GROUPS);
    expect(Array.isArray(c.homeProbes)).toBe(true);
  });
});

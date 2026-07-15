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

  it('coerces colorBlind to a strict boolean (defaults off)', () => {
    expect(loadLocalConfig().colorBlind).toBe(false);            // absent -> off
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ colorBlind: 'yes' }));
    expect(loadLocalConfig().colorBlind).toBe(false);            // truthy junk -> off
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ colorBlind: true }));
    expect(loadLocalConfig().colorBlind).toBe(true);             // real true kept
  });

  it('drops null/non-object groups, entries, links, and probes (hostile payload)', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      groups: [null, 'x', 7, {
        group: 'G',
        entries: [null, [], { name: 'E', icon: 'bi:x', check: false, links: [null, { label: 'L', url: 'https://a' }, 7] }]
      }],
      homeProbes: ['https://ok', null, 5]
    }));
    const c = loadLocalConfig();
    expect(c.groups).toEqual([{
      group: 'G',
      entries: [{ name: 'E', icon: 'bi:x', check: false, links: [{ label: 'L', url: 'https://a' }] }]
    }]);
    expect(c.homeProbes).toEqual(['https://ok']);
  });

  it('coerces non-string icons and drops non-string icon-cache values (no iconUri crash)', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      groups: [{ group: 'G', entries: [{ name: 'E', icon: 5, check: false, links: [] }] }],
      iconCache: { 'bi:ok': 'data:image/svg+xml;base64,AAAA', 'bi:bad': 123, 'bi:worse': null }
    }));
    const c = loadLocalConfig();
    expect(c.groups[0].entries[0].icon).toBe('');            // renders the fallback icon
    expect(c.iconCache).toEqual({ 'bi:ok': 'data:image/svg+xml;base64,AAAA' });
  });
});

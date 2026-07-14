import { describe, it, expect, beforeEach } from 'vitest';
import { migrateStorage } from './migrate';

beforeEach(() => localStorage.clear());

describe('migrateStorage', () => {
  it('renames legacy startpage-* keys to crtl-* and drops the old ones', () => {
    localStorage.setItem('startpage-config', '{"v":1}');
    localStorage.setItem('startpage-theme', 'dark');
    localStorage.setItem('startpage-sync-base', '123');

    migrateStorage();

    expect(localStorage.getItem('crtl-config')).toBe('{"v":1}');
    expect(localStorage.getItem('crtl-theme')).toBe('dark');
    expect(localStorage.getItem('crtl-sync-base')).toBe('123');
    expect(localStorage.getItem('startpage-config')).toBeNull();
    expect(localStorage.getItem('startpage-theme')).toBeNull();
    expect(localStorage.getItem('startpage-sync-base')).toBeNull();
  });

  it('never clobbers a value already written under the crtl-* key', () => {
    localStorage.setItem('startpage-config', 'OLD');
    localStorage.setItem('crtl-config', 'NEW');

    migrateStorage();

    expect(localStorage.getItem('crtl-config')).toBe('NEW');       // kept
    expect(localStorage.getItem('startpage-config')).toBeNull();   // still cleaned up
  });

  it('no-ops when there is nothing to migrate', () => {
    migrateStorage();
    expect(localStorage.length).toBe(0);
  });
});

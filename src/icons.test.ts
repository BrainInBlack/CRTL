import { describe, it, expect } from 'vitest';
import { biKey, parseSvgRef } from './icons';

describe('biKey', () => {
  it('canonicalizes every bi form to bi:<name>', () => {
    expect(biKey('house-fill')).toBe('bi:house-fill');   // bare
    expect(biKey('bi-house-fill')).toBe('bi:house-fill'); // dash prefix
    expect(biKey('bi:house-fill')).toBe('bi:house-fill'); // already canonical
  });
});

describe('parseSvgRef', () => {
  it('a bare svg: name resolves across all brand sets', () => {
    expect(parseSvgRef('svg:gitea')).toEqual({ sets: ['simple-icons', 'cbi'], name: 'gitea' });
  });

  it('an svg:set/name pins to that one set', () => {
    expect(parseSvgRef('svg:cbi/proxmox')).toEqual({ sets: ['cbi'], name: 'proxmox' });
  });
});

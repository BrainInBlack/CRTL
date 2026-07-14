import { describe, it, expect } from 'vitest';
import { isInternal, orderLinks } from './probes';
import type { Link } from './types';

describe('isInternal', () => {
  it('treats .home and .local hosts as internal', () => {
    expect(isInternal('https://nas.home')).toBe(true);
    expect(isInternal('http://printer.local')).toBe(true);
  });

  it('treats RFC1918 ranges as internal', () => {
    expect(isInternal('http://10.0.0.1')).toBe(true);
    expect(isInternal('http://192.168.1.5:8080')).toBe(true);
    expect(isInternal('http://172.16.0.1')).toBe(true);
    expect(isInternal('http://172.31.255.255')).toBe(true);
  });

  it('excludes loopback and public hosts', () => {
    expect(isInternal('http://127.0.0.1')).toBe(false);
    expect(isInternal('http://localhost')).toBe(false);
    expect(isInternal('https://example.com')).toBe(false);
    expect(isInternal('http://172.32.0.1')).toBe(false); // just outside the 16-31 block
    expect(isInternal('http://11.0.0.1')).toBe(false);
  });

  it('returns false for an unparseable URL', () => {
    expect(isInternal('not a url')).toBe(false);
    expect(isInternal('')).toBe(false);
  });
});

describe('orderLinks', () => {
  const links: Link[] = [
    { label: 'IP', url: 'http://192.168.1.1' },
    { label: 'Public', url: 'https://example.com' },
    { label: 'DNS', url: 'https://svc.home' },
  ];

  it('keeps original order at Home', () => {
    expect(orderLinks(links, false).map(l => l.label)).toEqual(['IP', 'Public', 'DNS']);
  });

  it('puts external links first when Away, stable within each group', () => {
    expect(orderLinks(links, true).map(l => l.label)).toEqual(['Public', 'IP', 'DNS']);
  });

  it('does not mutate the input array', () => {
    const before = links.map(l => l.label);
    orderLinks(links, true);
    expect(links.map(l => l.label)).toEqual(before);
  });
});

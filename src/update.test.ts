import { describe, it, expect, vi, afterEach } from 'vitest';
import { isNewer, parseRelease, autoCheckForUpdate, checkForUpdate, setAutoCheck } from './update';
import { APP_VERSION } from './build';

const REL = 'https://github.com/BrainInBlack/CRTL/releases';

describe('isNewer', () => {
  it('compares X.Y.Z numerically, with or without a v prefix', () => {
    expect(isNewer('v1.6.0', '1.5.0')).toBe(true);
    expect(isNewer('1.10.0', '1.9.9')).toBe(true);  // not a string compare
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('v1.5.0', '1.5.0')).toBe(false);
    expect(isNewer('1.4.9', '1.5.0')).toBe(false);
  });

  it('treats anything but a plain X.Y.Z as not newer', () => {
    expect(isNewer('v2.0.0-beta.1', '1.5.0')).toBe(false);
    expect(isNewer('latest', '1.5.0')).toBe(false);
    expect(isNewer('', '1.5.0')).toBe(false);
  });
});

describe('parseRelease', () => {
  it('links the CRTL.html asset, built from the tag', () => {
    expect(parseRelease({ tag_name: 'v1.6.0', assets: [{ name: 'CRTL.html', browser_download_url: 'https://evil.example/x' }] }))
      .toEqual({ version: '1.6.0', url: `${REL}/download/v1.6.0/CRTL.html` });
  });

  it('falls back to the release page without the asset', () => {
    expect(parseRelease({ tag_name: 'v1.6.0', assets: [] }))
      .toEqual({ version: '1.6.0', url: `${REL}/tag/v1.6.0` });
  });

  it('rejects odd tags, drafts, prereleases and garbage', () => {
    expect(parseRelease({ tag_name: 'v1.6.0/../../x', assets: [] })).toBeNull();
    expect(parseRelease({ tag_name: 'v1.6.0', draft: true })).toBeNull();
    expect(parseRelease({ tag_name: 'v1.6.0', prerelease: true })).toBeNull();
    expect(parseRelease({ tag_name: 7 })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('v1.6.0')).toBeNull();
  });
});

describe('update checks', () => {
  const [maj] = APP_VERSION.split('.').map(Number);
  const newer = `v${maj + 1}.0.0`;
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('does nothing on startup unless opted in', async () => {
    const f = respond({ tag_name: newer, assets: [] });
    vi.stubGlobal('fetch', f);
    expect(await autoCheckForUpdate()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('checks once, then reuses the cached result within a day', async () => {
    setAutoCheck(true);
    const f = respond({ tag_name: newer, assets: [{ name: 'CRTL.html' }] });
    vi.stubGlobal('fetch', f);
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail.version);
    window.addEventListener('update-available', on);
    expect((await autoCheckForUpdate())?.version).toBe(`${maj + 1}.0.0`);
    expect((await autoCheckForUpdate())?.version).toBe(`${maj + 1}.0.0`);
    window.removeEventListener('update-available', on);
    expect(f).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
  });

  it('reports current as null and surfaces failures on a manual check', async () => {
    vi.stubGlobal('fetch', respond({ tag_name: `v${APP_VERSION}`, assets: [] }));
    expect(await checkForUpdate()).toBeNull();
    vi.stubGlobal('fetch', respond({}, 403));
    await expect(checkForUpdate()).rejects.toThrow(/rate limit/);
  });

  it('stays silent when the startup check fails', async () => {
    setAutoCheck(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await autoCheckForUpdate()).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { errMsg, safeUrl } from './util';

describe('safeUrl', () => {
  it('passes through http/https/mailto', () => {
    expect(safeUrl('http://192.168.1.1')).toBe('http://192.168.1.1');
    expect(safeUrl('https://svc.example.com/path?q=1')).toBe('https://svc.example.com/path?q=1');
    expect(safeUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(safeUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com'); // scheme match is case-insensitive
  });

  it('blocks script-bearing and non-navigable schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JavaScript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
    expect(safeUrl('file:///etc/passwd')).toBe('');
  });

  it('rejects non-absolute / garbage input', () => {
    expect(safeUrl('service.example.com')).toBe(''); // bare host, no scheme
    expect(safeUrl('/relative/path')).toBe('');
    expect(safeUrl('')).toBe('');
  });
});

describe('errMsg', () => {
  it('uses a truthy .message (Error and DOMException), else String', () => {
    expect(errMsg(new Error('boom'))).toBe('boom');
    expect(errMsg(new DOMException('aborted', 'AbortError'))).toBe('aborted'); // no "AbortError: " prefix
    expect(errMsg('plain string')).toBe('plain string');
    expect(errMsg(new Error(''))).toBe('Error'); // empty message -> String(err)
    expect(errMsg(null)).toBe('null');
  });
});

import { describe, it, expect } from 'vitest';
import { isPrivateIp, validateExternalUrl } from '../ssrf.js';

describe('SSRF Protection - isPrivateIp', () => {
  it('identifies loopback addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.10.20.30')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('identifies RFC 1918 private IPv4 addresses', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.254.1.10')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.254')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('192.168.0.254')).toBe(true);
  });

  it('identifies cloud metadata / link-local addresses', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('169.254.1.1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
  });

  it('identifies carrier-grade NAT, multicast, broadcast, and invalid IPs', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isPrivateIp('224.0.0.1')).toBe(true);
    expect(isPrivateIp('255.255.255.255')).toBe(true);
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });

  it('allows public IPv4 addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });
});

describe('SSRF Protection - validateExternalUrl', () => {
  it('rejects non-http/https protocols', async () => {
    await expect(validateExternalUrl('ftp://example.com/file')).rejects.toThrow(/Unsupported protocol/);
    await expect(validateExternalUrl('file:///etc/passwd')).rejects.toThrow(/Unsupported protocol/);
    await expect(validateExternalUrl('gopher://127.0.0.1')).rejects.toThrow(/Unsupported protocol/);
  });

  it('rejects localhost and private domains', async () => {
    await expect(validateExternalUrl('http://localhost:3000/')).rejects.toThrow(/prohibited/);
    await expect(validateExternalUrl('http://test.localhost/api')).rejects.toThrow(/prohibited/);
    await expect(validateExternalUrl('http://internal.service.local/')).rejects.toThrow(/prohibited/);
  });

  it('rejects direct private IPs in URL', async () => {
    await expect(validateExternalUrl('http://127.0.0.1:8080/')).rejects.toThrow(/prohibited/);
    await expect(validateExternalUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/prohibited/);
    await expect(validateExternalUrl('http://10.0.0.1/admin')).rejects.toThrow(/prohibited/);
    await expect(validateExternalUrl('http://192.168.1.1/setup')).rejects.toThrow(/prohibited/);
  });

  it('accepts valid public URLs', async () => {
    const parsed = await validateExternalUrl('https://example.com/news/1');
    expect(parsed.hostname).toBe('example.com');
  });
});

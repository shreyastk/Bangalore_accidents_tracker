import dns from 'dns/promises';
import net from 'net';

/**
 * Checks whether an IP address string is a private, loopback, link-local,
 * multicast, or reserved address (IPv4 and IPv6).
 */
export function isPrivateIp(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return true;
  const cleaned = ipStr.trim();
  const kind = net.isIP(cleaned);
  if (!kind) return true; // Not a valid IP

  if (kind === 4) {
    const parts = cleaned.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [o0, o1, o2, o3] = parts;

    // 0.0.0.0/8 (current network)
    if (o0 === 0) return true;
    // 10.0.0.0/8 (private)
    if (o0 === 10) return true;
    // 100.64.0.0/10 (carrier-grade NAT)
    if (o0 === 100 && (o1 >= 64 && o1 <= 127)) return true;
    // 127.0.0.0/8 (loopback)
    if (o0 === 127) return true;
    // 169.254.0.0/16 (link-local, cloud metadata)
    if (o0 === 169 && o1 === 254) return true;
    // 172.16.0.0/12 (private)
    if (o0 === 172 && (o1 >= 16 && o1 <= 31)) return true;
    // 192.0.0.0/24 (IETF protocol assignments)
    if (o0 === 192 && o1 === 0 && o2 === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (o0 === 192 && o1 === 0 && o2 === 2) return true;
    // 192.88.99.0/24 (6to4 relay)
    if (o0 === 192 && o1 === 88 && o2 === 99) return true;
    // 192.168.0.0/16 (private)
    if (o0 === 192 && o1 === 168) return true;
    // 198.18.0.0/15 (benchmark)
    if (o0 === 198 && (o1 === 18 || o1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (o0 === 198 && o1 === 51 && o2 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (o0 === 203 && o1 === 0 && o2 === 113) return true;
    // 224.0.0.0/4 (multicast)
    if (o0 >= 224 && o0 <= 239) return true;
    // 240.0.0.0/4 (reserved) & 255.255.255.255
    if (o0 >= 240) return true;

    return false;
  }

  if (kind === 6) {
    const lower = cleaned.toLowerCase();

    // IPv4-mapped IPv6 (::ffff:192.168.1.1 or ::ffff:c0a8:0101)
    if (lower.startsWith('::ffff:')) {
      const remainder = lower.slice(7);
      if (remainder.includes('.')) {
        return isPrivateIp(remainder);
      }
      // Hex representation
      const hexParts = remainder.split(':');
      if (hexParts.length === 2) {
        const p1 = parseInt(hexParts[0], 16);
        const p2 = parseInt(hexParts[1], 16);
        const ipv4 = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
        return isPrivateIp(ipv4);
      }
    }

    // Loopback
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique local (fc00::/7 -> fc.. or fd..)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local (fe80::/10 -> fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(lower)) return true;
    // Multicast (ff00::/8)
    if (lower.startsWith('ff')) return true;
    // Discard prefix (100::/64)
    if (lower.startsWith('100:')) return true;
    // Documentation prefix (2001:db8::/32)
    if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return true;

    return false;
  }

  return true;
}

/**
 * Validates a target URL against SSRF threats.
 * Throws an Error if the URL is invalid, non-HTTP/HTTPS, or resolves to a private IP.
 */
export async function validateExternalUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('A valid URL string is required');
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol '${parsed.protocol}'. Only http: and https: are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost aliases and special domains
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.arpa')
  ) {
    throw new Error(`Access to local domain '${hostname}' is prohibited`);
  }

  // If hostname is already an IP literal, validate directly
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Access to private IP '${hostname}' is prohibited`);
    }
    return parsed;
  }

  // Resolve hostname via DNS
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (dnsErr) {
    throw new Error(`DNS resolution failed for host '${hostname}': ${dnsErr.message}`);
  }

  if (!records || records.length === 0) {
    throw new Error(`No DNS records found for host '${hostname}'`);
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error(`Host '${hostname}' resolves to private address '${record.address}'`);
    }
  }

  return parsed;
}

/**
 * Performs a safe fetch request with SSRF validation, redirect inspection,
 * timeout, and size limits.
 */
export async function safeFetch(urlString, options = {}, maxRedirects = 3) {
  const parsed = await validateExternalUrl(urlString);
  const timeoutMs = options.timeoutMs || 8000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions = {
      ...options,
      signal: controller.signal,
      redirect: 'manual'
    };
    delete fetchOptions.timeoutMs;
    delete fetchOptions.maxBytes;

    const response = await fetch(parsed.href, fetchOptions);

    // Handle redirects by re-validating the next target
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (maxRedirects <= 0) {
        throw new Error('Too many redirects');
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect response missing Location header');
      }
      const nextUrl = new URL(location, parsed.href).href;
      clearTimeout(timer);
      return safeFetch(nextUrl, options, maxRedirects - 1);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads response text with an enforced byte size limit to prevent memory exhaustion DoS.
 */
export async function readSafeResponseText(response, maxBytes = 5 * 1024 * 1024) {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Response body exceeds maximum size limit of ${maxBytes} bytes`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Response body exceeds maximum size limit of ${maxBytes} bytes`);
  }

  return Buffer.from(arrayBuffer).toString('utf8');
}

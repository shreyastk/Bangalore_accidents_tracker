/**
 * Unit tests for requireAdmin middleware (role-based access control)
 *
 * **Validates: Requirements 6.5, 6.6, 4.4**
 *
 * Tests role claim verification, 12-hour session duration enforcement,
 * and proper HTTP status codes for insufficient permissions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

// Test secret for signing JWTs
const TEST_JWT_SECRET = 'test-supabase-jwt-secret-for-unit-tests';

/** Helper: Create a valid HS256 JWT */
function createJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Replicates the validateJwt middleware from server/index.js
 */
function createValidateJwt(secret) {
  return function validateJwt(req, res, next) {
    const auth = req.headers.authorization || '';

    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing authentication credentials' });
    }

    const token = auth.slice(7);

    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      const signingInput = `${headerB64}.${payloadB64}`;
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');

      const sigBuf = Buffer.from(signatureB64, 'base64url');
      const expectedBuf = Buffer.from(expectedSig, 'base64url');

      if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      let payload;
      try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      } catch {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      if (payload.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (now > payload.exp + 30) {
          return res.status(401).json({ error: 'Authentication failed' });
        }
      }

      req.jwtPayload = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
}

/**
 * Replicates the requireAdmin middleware from server/index.js
 */
function requireAdmin(req, res, next) {
  const payload = req.jwtPayload;

  // Check role claim matches "admin"
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: 'insufficient permissions' });
  }

  // Enforce 12-hour maximum session duration based on iat (issued at)
  if (payload.iat) {
    const now = Math.floor(Date.now() / 1000);
    const maxSessionSeconds = 12 * 3600; // 12 hours
    if (now - payload.iat > maxSessionSeconds) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  }

  next();
}

describe('requireAdmin Middleware', () => {
  let app;

  beforeAll(() => {
    app = express();
    const validateJwt = createValidateJwt(TEST_JWT_SECRET);
    // Chain: validateJwt -> requireAdmin -> handler
    app.get('/admin-route', validateJwt, requireAdmin, (req, res) => {
      res.json({ ok: true, payload: req.jwtPayload });
    });
  });

  describe('Role claim verification (Req 6.5, 6.6)', () => {
    it('allows access when role is "admin"', async () => {
      const payload = {
        sub: 'user-123',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 403 with "insufficient permissions" when role is "user"', async () => {
      const payload = {
        sub: 'user-456',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient permissions');
    });

    it('returns 403 with "insufficient permissions" when role claim is missing', async () => {
      const payload = {
        sub: 'user-789',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient permissions');
    });

    it('returns 403 with "insufficient permissions" when role is "authenticated"', async () => {
      const payload = {
        sub: 'user-101',
        role: 'authenticated',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient permissions');
    });

    it('returns 403 with "insufficient permissions" when role is empty string', async () => {
      const payload = {
        sub: 'user-102',
        role: '',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient permissions');
    });

    it('returns 403 with "insufficient permissions" when role is null', async () => {
      const payload = {
        sub: 'user-103',
        role: null,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient permissions');
    });
  });

  describe('12-hour maximum session duration (Req 4.4)', () => {
    it('allows access when token was issued less than 12 hours ago', async () => {
      const payload = {
        sub: 'admin-1',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000) - (6 * 3600), // 6 hours ago
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('allows access when token was issued exactly 12 hours ago (boundary)', async () => {
      const payload = {
        sub: 'admin-2',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000) - (12 * 3600), // exactly 12 hours ago
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('rejects token issued more than 12 hours ago with 401', async () => {
      const payload = {
        sub: 'admin-3',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000) - (13 * 3600), // 13 hours ago
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication failed');
    });

    it('rejects token issued 24 hours ago', async () => {
      const payload = {
        sub: 'admin-4',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000) - (24 * 3600), // 24 hours ago
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication failed');
    });

    it('allows access when iat claim is missing (no duration check)', async () => {
      const payload = {
        sub: 'admin-5',
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('allows access when token was just issued', async () => {
      const payload = {
        sub: 'admin-6',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000), // just now
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('Integration with validateJwt (combined middleware chain)', () => {
    it('returns 401 when no Authorization header (validateJwt rejects first)', async () => {
      const res = await request(app).get('/admin-route');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('missing authentication credentials');
    });

    it('returns 401 when token has invalid signature (validateJwt rejects first)', async () => {
      const payload = {
        sub: 'admin-7',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, 'wrong-secret');

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication failed');
    });

    it('returns 403 when token is valid but role is not admin', async () => {
      const payload = {
        sub: 'user-regular',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app).get('/admin-route').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient permissions');
    });
  });
});

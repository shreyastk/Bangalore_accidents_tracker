/**
 * Unit tests for GET /api/reports/mine endpoint
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * Tests JWT authentication, querying user's reports, status mapping,
 * ordering, and error handling.
 */
import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const TEST_JWT_SECRET = 'test-jwt-secret-for-user-reports';

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

/** Replicates validateJwt middleware for isolated testing */
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

function createValidToken(sub = 'user-123') {
  const payload = { sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  return createJwt(payload, TEST_JWT_SECRET);
}

/**
 * Creates a test Express app with the GET /api/reports/mine endpoint
 * that uses a mock Supabase client.
 */
function createUserReportsApp(mockSupabase) {
  const app = express();
  app.use(express.json());
  const validateJwt = createValidateJwt(TEST_JWT_SECRET);

  app.get('/api/reports/mine', validateJwt, async (req, res) => {
    try {
      const userId = req.jwtPayload.sub;

      const { data, error } = await mockSupabase
        .from('accidents')
        .select('id, title, location, area, severity, accident_date, status, description')
        .eq('reporter_id', userId)
        .order('accident_date', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch reports' });
      }

      const reports = (data || []).map(report => ({
        id: report.id,
        title: report.title,
        location: report.location,
        area: report.area,
        severity: report.severity,
        date: report.accident_date,
        status: report.status === 'active' ? 'verified'
              : report.status === 'hidden' ? 'rejected'
              : report.status || 'pending',
        description: report.description
      }));

      return res.json(reports);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }
  });

  return app;
}

/** Helper: create a chainable mock Supabase that returns given data */
function createMockSupabase(returnData, returnError = null) {
  const orderFn = vi.fn().mockResolvedValue({ data: returnData, error: returnError });
  const eqFn = vi.fn().mockReturnValue({ order: orderFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });

  return {
    from: fromFn,
    _mocks: { fromFn, selectFn, eqFn, orderFn }
  };
}

describe('GET /api/reports/mine', () => {
  describe('Authentication (Req 8.1)', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const mockSupabase = createMockSupabase([]);
      const app = createUserReportsApp(mockSupabase);

      const res = await request(app).get('/api/reports/mine');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('missing authentication credentials');
    });

    it('returns 401 when Authorization header has invalid token', async () => {
      const mockSupabase = createMockSupabase([]);
      const app = createUserReportsApp(mockSupabase);

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(401);
    });

    it('returns 401 when token is expired beyond clock skew', async () => {
      const mockSupabase = createMockSupabase([]);
      const app = createUserReportsApp(mockSupabase);
      const payload = { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 120 };
      const token = createJwt(payload, TEST_JWT_SECRET);

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('Query behavior (Req 8.1)', () => {
    it('queries accidents table with correct reporter_id from JWT sub', async () => {
      const mockSupabase = createMockSupabase([]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken('user-abc-789');

      await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(mockSupabase._mocks.fromFn).toHaveBeenCalledWith('accidents');
      expect(mockSupabase._mocks.eqFn).toHaveBeenCalledWith('reporter_id', 'user-abc-789');
      expect(mockSupabase._mocks.orderFn).toHaveBeenCalledWith('accident_date', { ascending: false });
    });

    it('returns empty array when user has no reports', async () => {
      const mockSupabase = createMockSupabase([]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('Status mapping (Req 8.2)', () => {
    it('maps "active" status to "verified"', async () => {
      const mockSupabase = createMockSupabase([
        { id: '1', title: 'Test', location: 'MG Road', area: 'Central', severity: 'minor', accident_date: '2024-01-15', status: 'active', description: 'A verified report' }
      ]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body[0].status).toBe('verified');
    });

    it('maps "hidden" status to "rejected"', async () => {
      const mockSupabase = createMockSupabase([
        { id: '2', title: 'Test', location: 'BTM', area: 'South', severity: 'serious', accident_date: '2024-02-10', status: 'hidden', description: 'A rejected report' }
      ]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body[0].status).toBe('rejected');
    });

    it('keeps "pending" status as "pending"', async () => {
      const mockSupabase = createMockSupabase([
        { id: '3', title: 'Test', location: 'Hebbal', area: 'North', severity: 'fatal', accident_date: '2024-03-01', status: 'pending', description: 'A pending report' }
      ]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body[0].status).toBe('pending');
    });

    it('defaults to "pending" when status is null/undefined', async () => {
      const mockSupabase = createMockSupabase([
        { id: '4', title: 'Test', location: 'Indiranagar', area: 'East', severity: 'minor', accident_date: '2024-04-01', status: null, description: 'No status report' }
      ]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body[0].status).toBe('pending');
    });
  });

  describe('Response format (Req 8.1, 8.2)', () => {
    it('returns reports with all expected fields', async () => {
      const mockSupabase = createMockSupabase([
        {
          id: '10',
          title: 'User Report: MG Road',
          location: 'MG Road near Trinity Circle',
          area: 'Central Bangalore',
          severity: 'serious',
          accident_date: '2024-01-15',
          status: 'pending',
          description: 'A collision at the junction'
        }
      ]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const report = res.body[0];
      expect(report).toHaveProperty('id', '10');
      expect(report).toHaveProperty('title', 'User Report: MG Road');
      expect(report).toHaveProperty('location', 'MG Road near Trinity Circle');
      expect(report).toHaveProperty('area', 'Central Bangalore');
      expect(report).toHaveProperty('severity', 'serious');
      expect(report).toHaveProperty('date', '2024-01-15');
      expect(report).toHaveProperty('status', 'pending');
      expect(report).toHaveProperty('description', 'A collision at the junction');
    });

    it('returns multiple reports in the response', async () => {
      const mockSupabase = createMockSupabase([
        { id: '1', title: 'Report 1', location: 'Loc 1', area: 'Area 1', severity: 'minor', accident_date: '2024-03-01', status: 'active', description: 'Desc 1' },
        { id: '2', title: 'Report 2', location: 'Loc 2', area: 'Area 2', severity: 'serious', accident_date: '2024-02-01', status: 'pending', description: 'Desc 2' },
        { id: '3', title: 'Report 3', location: 'Loc 3', area: 'Area 3', severity: 'fatal', accident_date: '2024-01-01', status: 'hidden', description: 'Desc 3' }
      ]);
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].status).toBe('verified');
      expect(res.body[1].status).toBe('pending');
      expect(res.body[2].status).toBe('rejected');
    });
  });

  describe('Error handling', () => {
    it('returns 500 when database query fails', async () => {
      const mockSupabase = createMockSupabase(null, { message: 'DB connection failed' });
      const app = createUserReportsApp(mockSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch reports');
    });

    it('returns 500 when an unexpected exception occurs', async () => {
      // Create a mock that throws an exception
      const throwingSupabase = {
        from: vi.fn(() => { throw new Error('Unexpected error'); })
      };
      const app = createUserReportsApp(throwingSupabase);
      const token = createValidToken();

      const res = await request(app)
        .get('/api/reports/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch reports');
    });
  });
});

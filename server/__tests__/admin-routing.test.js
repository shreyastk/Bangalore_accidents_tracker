/**
 * Property-based test for Admin Discreteness (Correctness Property 3)
 *
 * **Validates: Requirements 4.1, 4.2**
 *
 * Property: For any slug ≠ ADMIN_SLUG, the route GET /manage-:slug returns 404.
 *           Direct GET /admin.html always returns 404.
 *           Only the correct slug returns 200 and serves the admin page.
 */
import { describe, it, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real ADMIN_SLUG from the environment (used in production)
const ADMIN_SLUG = 'bat-ctrl-x7k9m2p4w8';

// Generator for URL-safe slug strings using array + join approach
const urlSafeChars = 'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('');
const urlSafeSlug = fc.array(
  fc.constantFrom(...urlSafeChars),
  { minLength: 1, maxLength: 40 }
).map(arr => arr.join('')).filter(s => s !== ADMIN_SLUG);

// Generator for slugs of the exact same length as ADMIN_SLUG
const sameLengthSlug = fc.array(
  fc.constantFrom(...urlSafeChars),
  { minLength: ADMIN_SLUG.length, maxLength: ADMIN_SLUG.length }
).map(arr => arr.join('')).filter(s => s !== ADMIN_SLUG);

/**
 * Creates a minimal Express app that replicates the admin routing logic
 * from server/index.js without needing Supabase or other external deps.
 */
function createAdminApp(adminSlug) {
  const app = express();
  const frontendDir = path.join(__dirname, '..', '..', 'Frontend');

  // Block direct access to /admin.html (must be before static middleware)
  app.get('/admin.html', (_req, res) => {
    res.status(404).send('Not Found');
  });

  // Serve admin panel only at secret URL /manage-{ADMIN_SLUG}
  app.get('/manage-:slug', (req, res) => {
    const requestSlug = req.params.slug || '';
    const expectedSlug = adminSlug;

    // Use timing-safe comparison to prevent timing attacks
    if (!expectedSlug || requestSlug.length !== expectedSlug.length) {
      return res.status(404).send('Not Found');
    }

    const requestBuf = Buffer.from(requestSlug, 'utf8');
    const expectedBuf = Buffer.from(expectedSlug, 'utf8');

    if (!crypto.timingSafeEqual(requestBuf, expectedBuf)) {
      return res.status(404).send('Not Found');
    }

    res.sendFile(path.join(frontendDir, 'admin.html'));
  });

  // Serve static files (like the real server does after the admin routes)
  app.use(express.static(frontendDir));

  return app;
}

describe('Admin Discreteness - Property Tests', () => {
  const app = createAdminApp(ADMIN_SLUG);

  fcTest.prop([urlSafeSlug])(
    'any URL-safe slug ≠ ADMIN_SLUG returns 404 on GET /manage-:slug',
    async (randomSlug) => {
      const res = await request(app).get(`/manage-${randomSlug}`);
      expect(res.status).toBe(404);
    }
  );

  fcTest.prop([sameLengthSlug])(
    'slugs of same length as ADMIN_SLUG but different content return 404',
    async (samelenSlug) => {
      const res = await request(app).get(`/manage-${samelenSlug}`);
      expect(res.status).toBe(404);
    }
  );

  fcTest.prop(
    [fc.stringMatching(/^[a-z0-9\-]{1,30}$/).filter(s => s !== ADMIN_SLUG)]
  )(
    'alphanumeric slugs ≠ ADMIN_SLUG return 404',
    async (randomSlug) => {
      const res = await request(app).get(`/manage-${randomSlug}`);
      expect(res.status).toBe(404);
    }
  );

  it('direct /admin.html always returns 404', async () => {
    const res = await request(app).get('/admin.html');
    expect(res.status).toBe(404);
  });

  it('correct slug returns 200 and serves admin page', async () => {
    const res = await request(app).get(`/manage-${ADMIN_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('html');
  });

  it('empty slug returns 404', async () => {
    const res = await request(app).get('/manage-');
    expect(res.status).toBe(404);
  });
});

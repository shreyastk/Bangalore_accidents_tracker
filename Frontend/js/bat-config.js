/**
 * Bangalore Accidents Tracker — client config.
 * apiBase: URL of the running Node/Express API (server/index.js).
 * When running on serverless static hosting (Cloudflare Workers, GitHub Pages),
 * pages automatically fall back to Supabase REST and local datasets.
 *
 * supabaseUrl: Your Supabase project URL.
 * supabaseAnonKey: Your Supabase anon/public key.
 */
window.BAT_CONFIG = (function () {
  if (window.BAT_API_BASE) {
    return {
      apiBase: window.BAT_API_BASE.replace(/\/$/, ''),
      supabaseUrl: 'https://xcjzfifybnzocyjlktpo.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjanpmaWZ5Ym56b2N5amxrdHBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzU4NzUsImV4cCI6MjA5NDYxMTg3NX0.HL63wV69Awlp_JkbdQKsXkfnaxAvz8_HwwYuYGJksQ8',
    };
  }

  const hostname = window.location.hostname || '';
  const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
  let apiBase = '';

  if (isLocalDev) {
    apiBase = window.location.port === '3000' ? window.location.origin.replace(/\/$/, '') : 'http://localhost:3000';
  } else if (hostname.endsWith('.workers.dev') || hostname.endsWith('.pages.dev') || hostname.endsWith('.github.io')) {
    // Static Cloudflare Workers / Pages hosting without Node backend
    apiBase = '';
  } else if (window.location.origin && window.location.origin !== 'null') {
    // EC2 instance (e.g. http://18.61.100.36) or custom domain
    apiBase = window.location.origin.replace(/\/$/, '');
  }

  return {
    apiBase,
    supabaseUrl: 'https://xcjzfifybnzocyjlktpo.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjanpmaWZ5Ym56b2N5amxrdHBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzU4NzUsImV4cCI6MjA5NDYxMTg3NX0.HL63wV69Awlp_JkbdQKsXkfnaxAvz8_HwwYuYGJksQ8',
  };
})();

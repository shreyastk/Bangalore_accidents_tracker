/**
 * Bangalore Accidents Tracker — client config.
 * apiBase: URL of the running Node/Express API (server/index.js).
 * No map token required — the dashboard uses Leaflet + OpenStreetMap (free).
 *
 * supabaseUrl: Your Supabase project URL (from Project Settings > API).
 * supabaseAnonKey: Your Supabase anon/public key (from Project Settings > API).
 */
window.BAT_CONFIG = (function () {
  // Determine the API base. If this page is being served by the BAT Express
  // server itself (the default flow), use the same origin so that localhost
  // vs 127.0.0.1 never causes a CORS block. Otherwise fall back to the API URL.
  const isApiServer =
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    window.location.port === '3000';

  return {
    apiBase: isApiServer ? window.location.origin.replace(/\/$/, '') : 'http://localhost:3000',
    supabaseUrl: 'https://xcjzfifybnzocyjlktpo.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjanpmaWZ5Ym56b2N5amxrdHBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzU4NzUsImV4cCI6MjA5NDYxMTg3NX0.HL63wV69Awlp_JkbdQKsXkfnaxAvz8_HwwYuYGJksQ8',
  };
})();

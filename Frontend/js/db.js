/**
 * db.js — Data Layer Abstraction for Bangalore Accidents Tracker
 * 
 * This file provides data operations for the dashboard.
 * Data is fetched from Supabase via the API server.
 * Falls back to local accident_data.json when API is offline.
 */

(function () {
  'use strict';

  const CFG = window.BAT_CONFIG || {};
  const API_BASE = (CFG.apiBase || '').replace(/\/$/, '');

  // ─── LOCAL STORAGE KEY (user reports only) ────────────────────────────────
  const KEYS = {
    USER_REPORTS: 'bat_user_reports',
  };

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function getStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }

  // ─── ACCIDENTS (DATA LAYER) ───────────────────────────────────────────────
  function getAccidents(filters = {}) {
    // This function returns locally cached data for quick access.
    // The dashboard-app.js handles async API/JSON loading.
    let data = getStorage(KEYS.USER_REPORTS);
    if (filters.severity && filters.severity !== 'all') {
      data = data.filter(a => a.severity === filters.severity);
    }
    if (filters.area && filters.area !== 'all') {
      data = data.filter(a => a.area === filters.area);
    }
    if (filters.dateFrom) {
      data = data.filter(a => a.date >= filters.dateFrom);
    }
    if (filters.dateTo) {
      data = data.filter(a => a.date <= filters.dateTo);
    }
    return data;
  }

  function addAccident(accidentData) {
    // Legacy function kept for backward compatibility.
    // New reports should use the POST /api/reports endpoint instead.
    const reports = getStorage(KEYS.USER_REPORTS);
    const newReport = {
      id: 'usr_acc_' + Date.now(),
      ...accidentData,
      source: 'user',
      verified: false,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    reports.push(newReport);
    localStorage.setItem(KEYS.USER_REPORTS, JSON.stringify(reports));
    return { success: true, report: newReport };
  }

  function getUserReports(userId) {
    const reports = getStorage(KEYS.USER_REPORTS);
    return reports.filter(r => r.reportedBy === userId);
  }

  function getHotspots() {
    // Returns empty - dashboard-app.js computes hotspots from API data
    return [];
  }

  function getStats() {
    // Returns empty - dashboard-app.js computes stats from API data
    return { total: 0, fatal: 0, serious: 0, minor: 0, areas: 0 };
  }

  // ─── EXPORT (data functions only — auth is handled by supabase-auth.js) ──
  window.DB = {
    getAccidents,
    addAccident,
    getUserReports,
    getHotspots,
    getStats,
  };
})();

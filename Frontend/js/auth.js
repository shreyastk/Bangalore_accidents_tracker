/* ─────────────────────────────────────────────────────────────────────────
   auth.js — Authentication logic for Bangalore Accidents Tracker
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /** Redirect to login page if user is not authenticated */
  function requireAuth(redirectTo = 'login.html') {
    if (!window.DB.isLoggedIn()) {
      const current = window.location.pathname.split('/').pop();
      window.location.href = redirectTo + '?returnTo=' + current;
    }
  }

  /** Update the navigation bar to show correct auth state */
  function updateNavAuth() {
    const session = window.DB.getSession();
    const navAuthLinks = document.getElementById('nav-auth-links');
    if (!navAuthLinks) return;

    if (session) {
      navAuthLinks.innerHTML = `
        <div style="display: flex; gap: 12px; align-items: center;">
          <a href="profile.html" class="nav-link">
          <span class="nav-avatar">${session.name.charAt(0).toUpperCase()}</span>
          <span>${session.name.split(' ')[0]}</span>
        </a>
        <a href="#" class="btn btn-outline btn-sm" id="logout-btn">Logout</a>
        </div>
      `;
      document.getElementById('logout-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.DB.logout();
        window.location.href = 'index.html';
      });
    } else {
      navAuthLinks.innerHTML = `
        <div style="display: flex; gap: 12px; align-items: center;">
          <a href="login.html" class="btn btn-outline btn-sm">Login</a>
        <a href="login.html?tab=register" class="btn btn-primary btn-sm">Sign Up</a>
        </div>
      `;
    }
  }

  window.Auth = { requireAuth, updateNavAuth };
})();

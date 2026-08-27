// nav-active.js
// Ensure the correct nav link has the `active` class based on current page
(function () {
  'use strict';

  function setActiveNav() {
    var path = window.location.pathname.split('/').pop() || 'index.html';
    // Normalize trailing query strings
    path = path.split('?')[0];

    var selectors = ['#nav-links a', '.topbar-links a', '.nav-links a'];
    var links = [];
    selectors.forEach(function (s) {
      document.querySelectorAll(s).forEach(function (el) { links.push(el); });
    });

    links.forEach(function (a) {
      try { a.classList.remove('active'); } catch (e) {}
      var href = a.getAttribute('href') || '';
      var hrefFile = href.split('/').pop().split('?')[0];
      if (!hrefFile) return;
      if (hrefFile === path) {
        a.classList.add('active');
      }
      // treat root / as index.html
      if ((path === '' || path === '/') && (hrefFile === 'index.html' || href === '/')) {
        a.classList.add('active');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', setActiveNav);

  // Close the mobile menu when a nav link is tapped
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('nav-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        toggle.classList.toggle('open');
      });
    }
    document.querySelectorAll('#nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        var links = document.getElementById('nav-links');
        if (links) links.classList.remove('open');
        if (toggle) toggle.classList.remove('open');
      });
    });
  });
})();

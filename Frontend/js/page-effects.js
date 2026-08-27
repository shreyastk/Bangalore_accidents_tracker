/* Shared interaction polish: progressive on-scroll reveals and nav elevation. */
(function () {
  'use strict';

  var revealSelector = [
    '.section-head', '.page-head', '.stats-grid > *', '.hospital-stats > *',
    '.hotspots-list > *', '.features-grid > *', '.cta-banner',
    '.hospital-grid > *', '.alerts-list > *', '.trends-page .card',
    '.report-header', '.steps', '.report-form-panel', '.report-map-panel',
    '.sidebar-card', '.stats-strip', '.map-area'
  ].join(',');

  function prepare(root) {
    (root || document).querySelectorAll(revealSelector).forEach(function (element, index) {
      if (element.dataset.revealReady) return;
      element.dataset.revealReady = 'true';
      element.classList.add('scroll-reveal');
      element.style.setProperty('--reveal-delay', Math.min((index % 4) * 70, 210) + 'ms');
      observer.observe(element);
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -36px' });

  function updateNavigation() {
    var nav = document.getElementById('main-nav');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 18);
  }

  document.documentElement.classList.add('has-scroll-reveal');
  document.addEventListener('DOMContentLoaded', function () {
    prepare(document);
    updateNavigation();
    window.addEventListener('scroll', updateNavigation, { passive: true });
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(revealSelector)) prepare(node.parentElement);
          prepare(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
}());

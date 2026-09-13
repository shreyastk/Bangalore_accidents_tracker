(function () {
  const languages = {
    en: { label: 'English', home: 'Home', dashboard: 'Dashboard', report: 'Report', emergency: 'SOS Emergency', civic: 'Civic Action', phrases: {} },
    hi: { label: 'हिन्दी', home: 'होम', dashboard: 'डैशबोर्ड', report: 'रिपोर्ट करें', emergency: 'आपातकाल SOS', civic: 'नागरिक कार्रवाई', phrases: { 'Accident Map':'दुर्घटना मानचित्र', 'Filters':'फ़िल्टर', 'Apply':'लागू करें', 'Reset':'रीसेट', 'Share this view':'यह दृश्य साझा करें', 'Road risk outlook':'सड़क जोखिम संकेत', 'Report Accident':'दुर्घटना रिपोर्ट करें', 'View Live Map':'लाइव मानचित्र देखें', 'Emergency assistance':'आपातकालीन सहायता', 'Call 112':'112 कॉल करें', 'Call 108 Ambulance':'108 एम्बुलेंस कॉल करें', 'Civic Action Tracker':'नागरिक कार्रवाई ट्रैकर', 'Flag a safety issue':'सुरक्षा समस्या दर्ज करें' } },
    kn: { label: 'ಕನ್ನಡ', home: 'ಮುಖಪುಟ', dashboard: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್', report: 'ವರದಿ ಮಾಡಿ', emergency: 'ತುರ್ತು SOS', civic: 'ನಾಗರಿಕ ಕ್ರಮ', phrases: { 'Accident Map':'ಅಪಘಾತ ನಕ್ಷೆ', 'Filters':'ಶೋಧಕಗಳು', 'Apply':'ಅನ್ವಯಿಸಿ', 'Reset':'ಮರುಹೊಂದಿಸಿ', 'Share this view':'ಈ ನೋಟ ಹಂಚಿಕೊಳ್ಳಿ', 'Road risk outlook':'ರಸ್ತೆ ಅಪಾಯ ಸೂಚನೆ', 'Report Accident':'ಅಪಘಾತ ವರದಿ ಮಾಡಿ', 'View Live Map':'ಲೈವ್ ನಕ್ಷೆ ನೋಡಿ', 'Emergency assistance':'ತುರ್ತು ಸಹಾಯ', 'Call 112':'112 ಕರೆ ಮಾಡಿ', 'Call 108 Ambulance':'108 ಆಂಬುಲೆನ್ಸ್ ಕರೆ ಮಾಡಿ', 'Civic Action Tracker':'ನಾಗರಿಕ ಕ್ರಮ ಟ್ರ್ಯಾಕರ್', 'Flag a safety issue':'ಸುರಕ್ಷತಾ ಸಮಸ್ಯೆ ದಾಖಲಿಸಿ' } }
  };
  function translate(lang) {
    const t = languages[lang] || languages.en;
    localStorage.setItem('bat-language', lang);
    document.documentElement.lang = lang;
    document.querySelectorAll('a[href="index.html"]').forEach(el => { if (!el.querySelector('img')) el.textContent = t.home; });
    document.querySelectorAll('a[href="dashboard.html"]').forEach(el => { if (!el.querySelector('img')) el.textContent = t.dashboard; });
    document.querySelectorAll('a[href="report.html"]').forEach(el => { if (!el.querySelector('img')) el.textContent = t.report; });
    document.querySelectorAll('a[href="emergency.html"]').forEach(el => { if (!el.querySelector('img')) el.textContent = t.emergency; });
    document.querySelectorAll('a[href="civic.html"]').forEach(el => { if (!el.querySelector('img')) el.textContent = t.civic; });
    document.querySelectorAll('[data-bat-i18n]').forEach(el => { el.textContent = t.phrases[el.dataset.batI18n] || el.dataset.batI18n; });
    document.querySelectorAll('h1,h2,h3,button,.card-label,.heat-label').forEach(el => {
      if (el.children.length || !el.textContent.trim()) return;
      const original = el.dataset.batI18n || el.textContent.trim();
      el.dataset.batI18n = original;
      if (t.phrases[original]) el.textContent = t.phrases[original];
      else if (lang === 'en') el.textContent = original;
    });
  }
  function mount() {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Choose language');
    select.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;padding:8px;border-radius:8px;border:1px solid #94a3b8;background:#fff;color:#0f172a';
    Object.entries(languages).forEach(([key, value]) => { const option = document.createElement('option'); option.value = key; option.textContent = value.label; select.appendChild(option); });
    select.value = localStorage.getItem('bat-language') || 'en';
    select.addEventListener('change', () => translate(select.value));
    document.body.appendChild(select); translate(select.value);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

(function () {
  const api = (window.BAT_CONFIG?.apiBase || '').replace(/\/$/, ''); let point = null;
  const status = document.getElementById('status'), send = document.getElementById('send'), photo = document.getElementById('photo'), preview = document.getElementById('preview'), result = document.getElementById('result');
  function message(text, error = false) { status.textContent = text; status.className = error ? 'danger' : 'status'; }
  document.getElementById('location').addEventListener('click', () => {
    if (!navigator.geolocation) return message('Location is unavailable in this browser. Call 112 or 108.', true);
    message('Locating…'); navigator.geolocation.getCurrentPosition(pos => { point = { lat: pos.coords.latitude, lng: pos.coords.longitude }; message(`Location ready (accuracy about ${Math.round(pos.coords.accuracy)} m).`); send.disabled = false; }, () => message('Location could not be obtained. Call 112 or 108.', true), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
  photo.addEventListener('change', () => { const file = photo.files[0]; if (!file) return; if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { photo.value = ''; return message('Use an image smaller than 10 MB.', true); } preview.src = URL.createObjectURL(file); preview.hidden = false; });
  send.addEventListener('click', async () => {
    if (!point) return; send.disabled = true; message('Uploading alert…');
    try {
      const file = photo.files[0]; let photo_url = null;
      if (file) {
        const client = window.supabase; if (!client) throw new Error('Photo upload is unavailable. You can still send a location-only alert.');
        const session = await window.SupabaseAuthClient?.getSession?.();
        if (!session?.user?.id) throw new Error('Sign in to include a photo, or remove it to send a location-only alert.');
        const path = `${session.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const upload = await client.storage.from('report-proofs').upload(path, file, { contentType: file.type, upsert: false }); if (upload.error) throw upload.error;
        photo_url = client.storage.from('report-proofs').getPublicUrl(path).data.publicUrl;
      }
      const response = await fetch(`${api}/api/emergency`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo_url, lat: point.lat, lng: point.lng }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Alert failed');
      result.innerHTML = `<h2>Alert sent</h2><p>Estimated severity: <strong>${data.severity || 'unknown'}</strong>. ${data.description || ''}</p><h3>Nearby hospitals</h3>${(data.hospitals || []).map(h => `<div class="hospital"><strong>${h.name}</strong><br>${Number(h.distance_km).toFixed(1)} km away ${h.phone ? `· <a href="tel:${h.phone}">Call hospital</a>` : ''}</div>`).join('')}`;
      message('Nearby hospitals have been alerted. Keep emergency services informed.');
    } catch (err) { message(err.message, true); send.disabled = false; }
  });
})();

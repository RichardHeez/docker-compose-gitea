import { $, api, countryOptions, me, nav, qs, safeNext, showMsg } from './common.js';
nav(null);
const next = safeNext(qs('next'));
$('#loginLink').href = `/login?next=${encodeURIComponent(next)}`;
$('#country').innerHTML = countryOptions(navigator.language?.split('-')[1] || 'BE');
me().then((m) => { if (m.user) location.href = next; });
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target); const btn = e.target.querySelector('button'); btn.disabled = true;
  try {
    await api('/api/signup', { name: f.get('name'), email: f.get('email'), password: f.get('password'), church: f.get('church'), country: f.get('country'), acceptTerms: !!f.get('acceptTerms') });
    location.href = next;
  } catch (err) { showMsg($('#msg'), err.message); btn.disabled = false; }
};

import { $, api, me, nav, qs, safeNext, showMsg } from './common.js';
nav(null);
const next = safeNext(qs('next'));
$('#signupLink').href = `/signup?next=${encodeURIComponent(next)}`;
me().then((m) => { if (m.user) location.href = next; });
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target); const btn = e.target.querySelector('button'); btn.disabled = true;
  try { await api('/api/login', { email: f.get('email'), password: f.get('password') }); location.href = next; }
  catch (err) { showMsg($('#msg'), err.message); btn.disabled = false; }
};
$('#forgot').onclick = (e) => { e.preventDefault(); location.href = '/reset'; };

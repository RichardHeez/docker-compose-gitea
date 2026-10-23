import { $, api, esc, me, nav, qs, showMsg } from './common.js';
const m = await me(); nav(m.user);
if (!m.user) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
$('#org').innerHTML = (m.orgs || []).map((o) => `<option value="${o.id}">${esc(o.name)} (${o.plan})</option>`).join('');
const lookup = async () => {
  const code = $('#code').value.trim().toUpperCase(); $('#device').textContent = '';
  if (code.length < 9) return;
  try { const d = await api(`/api/device/lookup?code=${encodeURIComponent(code)}`); $('#device').textContent = `Computer: ${d.name}${d.platform ? ` (${d.platform})` : ''}`; }
  catch (e) { $('#device').textContent = e.message; }
};
$('#code').value = (qs('code') || '').toUpperCase(); lookup();
$('#code').oninput = () => { const v = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); $('#code').value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v; lookup(); };
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/device/approve', { user_code: $('#code').value.trim().toUpperCase(), org_id: $('#org').value });
    $('#form').innerHTML = '<h1>Connected ✓</h1><p class="muted">Go back to F8 on the computer — it will finish signing in by itself in a few seconds.</p><a class="btn" href="/account">My account</a>';
  } catch (err) { showMsg($('#msg'), err.message); }
};

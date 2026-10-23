import { $, api, esc, me, nav, qs, showMsg } from './common.js';
const token = qs('token') || '';
const back = encodeURIComponent(`/invite?token=${token}`);
const m = await me(); nav(m.user);
try {
  const inv = await api(`/api/invites/${encodeURIComponent(token)}`);
  $('#title').textContent = `Join ${inv.church}`;
  $('#text').textContent = `You’re invited as ${inv.role === 'admin' ? 'an admin' : 'an operator'} for ${inv.church}. This invitation is for ${inv.email}.`;
  if (!m.user) $('#actions').innerHTML = `<a class="btn primary" href="/signup?next=${back}">Create an account</a><a class="btn" href="/login?next=${back}">Sign in</a>`;
  else {
    $('#actions').innerHTML = `<button class="btn primary" id="accept">Join ${esc(inv.church)}</button>`;
    $('#accept').onclick = async () => { try { const r = await api('/api/invites/accept', { token }); location.href = `/account?org=${r.org}`; } catch (e) { showMsg($('#msg'), e.message); } };
  }
} catch (e) { $('#title').textContent = 'Invitation'; showMsg($('#msg'), e.message); }

import { $, api, nav, qs, showMsg } from './common.js';
nav(null);
const token = qs('token');
if (!token) { // ask for the email first
  $('#title').textContent = 'Forgot your password?'; $('#emailRow').hidden = false; $('#pwRow').hidden = true; $('#go').textContent = 'Email me a link';
}
$('#form').onsubmit = async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try {
    if (!token) { await api('/api/password/forgot', { email: f.get('email') }); showMsg($('#msg'), 'If that email has an account, a link is on its way. Check your inbox (and spam).', 'ok'); }
    else { await api('/api/password/reset', { token, password: f.get('password') }); location.href = '/account'; }
  } catch (err) { showMsg($('#msg'), err.message); }
};

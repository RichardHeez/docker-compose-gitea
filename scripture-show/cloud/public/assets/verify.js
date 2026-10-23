import { $, api, nav, qs, showMsg } from './common.js';
nav(null);
api('/api/verify', { token: qs('token') || '' })
  .then(() => { $('h1').textContent = 'Email confirmed ✓'; })
  .catch((e) => { $('h1').textContent = 'Could not confirm'; showMsg($('#msg'), e.message); });

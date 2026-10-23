// Shared helpers for F8 Cloud pages.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const qs = (k) => new URLSearchParams(location.search).get(k);

export async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status });
  return j;
}

let toastTimer;
export function toast(text, err = false) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); }
  t.textContent = text; t.classList.toggle('err', err); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

export function showMsg(el, text, kind = 'err') { el.className = `msg ${kind}`; el.textContent = text; el.hidden = !text; }

// Only follow "next" links inside this site.
export const safeNext = (n, fallback = '/account') => (n && n.startsWith('/') && !n.startsWith('//') ? n : fallback);

export async function me() { try { return await api('/api/me'); } catch { return { user: null }; } }

export function nav(user) {
  const n = $('nav.top'); if (!n) return;
  n.innerHTML = `<a class="brand" href="/"><span class="mark">✦</span> F8 <span class="muted small hide-sm">Scripture Presenter</span></a><span class="sp"></span>
    <a class="link" href="/#pricing">Pricing</a>
    ${user ? `${user.admin ? '<a class="link" href="/admin">Admin</a>' : ''}<a class="btn sm" href="/account">My account</a>` : '<a class="link" href="/login">Sign in</a><a class="btn primary sm" href="/signup">Start free</a>'}`;
}

export const money = (minor, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
export const date = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const COUNTRIES = [['BE', 'Belgium'], ['NL', 'Netherlands'], ['FR', 'France'], ['DE', 'Germany'], ['LU', 'Luxembourg'], ['GB', 'United Kingdom'], ['IE', 'Ireland'],
  ['ES', 'Spain'], ['IT', 'Italy'], ['PT', 'Portugal'], ['US', 'United States'], ['CA', 'Canada'], ['GH', 'Ghana'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['ZA', 'South Africa'],
  ['CI', 'Côte d’Ivoire'], ['CM', 'Cameroon'], ['CD', 'DR Congo'], ['UG', 'Uganda'], ['TZ', 'Tanzania'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'], ['', 'Other']];
export const countryOptions = (sel = '') => COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${n}</option>`).join('');

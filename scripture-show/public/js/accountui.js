// Console: F8 account (sign in this computer, see the church's plan, upgrade).
let C; let last = '';
const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const PLAN = { free: 'Free', pro: 'Pro', ministry: 'Ministry' };

export function onState(s) {
  const a = s?.account; if (!a) return;
  const key = JSON.stringify(a); if (key === last) return; last = key;
  const $ = C.$;
  const tl = document.getElementById('tlBox'); if (tl) tl.hidden = a.mode === 'licensed' && !a.features?.includes('timelines');
  $('#acctCard').hidden = a.mode !== 'licensed';
  if (a.mode !== 'licensed') return;
  $('#acctPlan').textContent = PLAN[a.plan] || a.plan; $('#acctPlan').className = `plan-tag ${a.plan}`;
  const lines = [];
  if (a.signedIn) lines.push(`Signed in for <b>${C.esc(a.church)}</b>. ${a.validUntil ? `Works offline until ${fmt(a.validUntil)} — checks in by itself when online.` : ''}`);
  else lines.push('Not signed in — this computer uses the <b>Free</b> plan: 2 screens and a small F8 mark on the screens.');
  if (a.plan === 'free') lines.push('Pro unlocks 8 screens, NDI, recording & streaming, AI and Twi voice, Planning Center, edge blending and more.');
  if (a.sub?.status === 'trialing') lines.push(`Free trial until ${fmt(a.sub.until)}.`);
  if (a.error) lines.push(`<span class="warn">${C.esc(a.error)}</span>`);
  $('#acctText').innerHTML = lines.join('<br>');
  $('#acctSignIn').hidden = a.signedIn; $('#acctSignOut').hidden = !a.signedIn; $('#acctRefresh').hidden = !a.signedIn;
  $('#acctUpgrade').hidden = a.plan !== 'free' && a.signedIn; $('#acctUpgrade').textContent = a.signedIn ? 'Upgrade' : 'Plans & prices';
  const p = a.pending;
  $('#acctCode').hidden = !p;
  if (p) $('#acctCode').innerHTML = `On your phone or computer open <a href="${C.esc(p.verify_url)}" target="_blank" rel="noopener">${C.esc(p.verify_url.replace(/\?.*$/, ''))}</a> and enter<div class="code">${C.esc(p.user_code)}</div><span class="muted small">Waiting for approval…</span>`;
}

export function init(deps) {
  C = deps; const { $ } = C;
  const run = async (path) => { try { C.onState?.(); return await C.postJson(path, {}); } catch (e) { C.toast(e.message, true); return null; } };
  $('#acctSignIn').onclick = async () => { const r = await run('/api/account/signin'); if (r?.pending) window.open(r.pending.verify_url, '_blank', 'noopener'); };
  $('#acctSignOut').onclick = () => { if (confirm('Sign this computer out of the church account? It goes back to the Free plan.')) run('/api/account/signout'); };
  $('#acctRefresh').onclick = async () => { const r = await run('/api/account/refresh'); if (r) C.toast(`Plan: ${PLAN[r.plan] || r.plan}`); };
  $('#acctUpgrade').onclick = () => { const a = C.getS()?.account; if (a) window.open(a.signedIn ? a.accountUrl : a.pricingUrl, '_blank', 'noopener'); };
}

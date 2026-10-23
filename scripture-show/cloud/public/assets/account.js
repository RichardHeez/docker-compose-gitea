import { $, $$, api, countryOptions, date, esc, me, money, nav, qs, showMsg, toast } from './common.js';

let M = await me();
if (!M.user) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
nav(M.user);
const plans = await api('/api/plans');
let orgId = qs('org') && M.orgs.some((o) => o.id === qs('org')) ? qs('org') : M.orgs[0]?.id;
let cycle = 'month'; let O = null;

function banner() {
  const b = $('#banner'); let html = '';
  if (qs('paid')) html = '<div class="msg ok">Thank you! Your payment went through — the plan is active. F8 computers pick it up within a few minutes.</div>';
  else if (qs('cancelled')) html = '<div class="msg warn">Payment was cancelled — nothing was charged.</div>';
  else if (qs('payfail')) html = '<div class="msg err">We could not confirm that payment. If money left your account, contact us with the reference.</div>';
  if (!M.user.verified) html += '<div class="msg warn" style="margin-top:8px">Please confirm your email — we sent you a link. <a href="#" id="resend">Send again</a></div>';
  b.innerHTML = html; b.hidden = !html;
  $('#resend')?.addEventListener('click', async (e) => { e.preventDefault(); await api('/api/verify/resend', {}); toast('Sent — check your inbox'); });
}

function planText() {
  const s = O.subscription; const p = O.limits;
  if (!s || O.plan === 'free') return `Free plan: ${p.outputs} output screens, ${p.devices} computer, ${p.seats} team members, and a small F8 mark on the screens.${s?.status === 'expired' ? ' Your prepaid plan has ended — renew below.' : ''}`;
  const name = plans.plans[O.plan].name;
  if (s.provider === 'stripe') {
    if (s.status === 'trialing') return `${name} free trial until ${date(s.trialEnd)}. Your card is charged after that unless you cancel.`;
    if (s.status === 'past_due') return `${name} — the last card payment failed. Update the card under “Manage card billing” to keep ${name}.`;
    return `${name}, paid by card, ${s.cancelAtPeriodEnd ? `ends on ${date(s.periodEnd)} (cancelled)` : `renews on ${date(s.periodEnd)}`}.`;
  }
  if (s.provider === 'manual') return `${name} until ${date(s.periodEnd)}.`;
  return `${name}, prepaid with Mobile Money until ${date(s.periodEnd)}. Pay again any time to add more time.`;
}

function renderBuy() {
  const manager = ['owner', 'admin'].includes(O.org.role);
  const card = O.subscription?.provider === 'stripe' && ['active', 'trialing', 'past_due'].includes(O.subscription.status);
  $('#portal').hidden = !(manager && O.org.hasStripe);
  $('#upgrade').hidden = !manager || card;
  if (!manager || card) return;
  $('#buyPlans').innerHTML = ['pro', 'ministry'].map((id) => {
    const p = plans.plans[id]; const eur = plans.prices.eur[id][cycle]; const ghs = plans.prices.ghs[id][cycle];
    return `<div class="card plan ${id === 'pro' ? 'best' : ''}"><div class="row between"><h3>${p.name}</h3><span class="muted small">${p.outputs} screens · ${p.devices} computers · ${p.seats} people</span></div>
      <span class="muted small">${esc(p.blurb)}</span>
      ${plans.providers.stripe ? `<button class="btn primary" data-buy="${id}" data-p="stripe">${O.org.trialUsed ? '' : `Try ${plans.trialDays} days free · then `}${money(eur, 'EUR')}/${cycle} — Card / Bancontact / SEPA</button>` : ''}
      ${plans.providers.paystack ? `<button class="btn momo" data-buy="${id}" data-p="paystack">📱 Pay ${money(ghs, plans.paystackCurrency)} for a ${cycle} — Mobile Money</button>` : ''}
      ${!plans.providers.stripe && !plans.providers.paystack ? '<span class="muted small">Online payment is not switched on yet.</span>' : ''}</div>`;
  }).join('');
}

async function load() {
  O = await api(`/api/orgs/${orgId}`);
  history.replaceState(null, '', `/account?org=${orgId}`);
  const manager = ['owner', 'admin'].includes(O.org.role);
  $('#orgPick').innerHTML = M.orgs.map((o) => `<option value="${o.id}" ${o.id === orgId ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  $('#orgPick').hidden = M.orgs.length < 2;
  $('#orgName').textContent = O.org.name;
  $('#planTag').textContent = plans.plans[O.plan].name; $('#planTag').className = `tag ${O.plan}`;
  $('#planText').textContent = planText();
  renderBuy();
  $('#paymentsBox').hidden = !O.payments.length;
  $('#payments').innerHTML = `<tr><th>Date</th><th>Plan</th><th>Paid with</th><th>Amount</th></tr>${O.payments.map((p) => `<tr><td>${date(p.paid_at)}</td><td>${esc(plans.plans[p.plan]?.name || p.plan)} · ${p.interval}</td><td>${esc(p.channel === 'mobile_money' ? 'Mobile Money' : p.provider === 'stripe' ? 'Card / bank' : p.channel || p.provider)}</td><td>${money(Number(p.amount), p.currency)}</td></tr>`).join('')}`;
  $('#devCount').textContent = `${O.devices.length} of ${O.limits.devices}`;
  $('#devices').innerHTML = O.devices.length ? `<tr><th>Computer</th><th class="hide-sm">Added</th><th>Last seen</th><th></th></tr>${O.devices.map((d) => `<tr><td>${esc(d.name)} <span class="muted small">${esc(d.platform)}</span></td><td class="hide-sm">${date(d.created_at)}</td><td>${date(d.last_seen_at)}</td><td>${manager ? `<button class="btn ghost sm" data-revoke="${d.id}">Remove</button>` : ''}</td></tr>`).join('')}` : '<tr><td class="muted">No computers yet.</td></tr>';
  $('#seatCount').textContent = `${O.members.length + O.invites.length} of ${O.limits.seats}`;
  $('#members').innerHTML = `<tr><th>Name</th><th>Role</th><th></th></tr>${O.members.map((u) => `<tr><td>${esc(u.name || u.email)}<br><span class="muted small">${esc(u.email)}</span></td>
    <td>${manager && u.id !== M.user.id ? `<select data-role="${u.id}" style="width:auto">${['owner', 'admin', 'operator'].map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>` : esc(u.role)}</td>
    <td>${manager && u.id !== M.user.id ? `<button class="btn ghost sm" data-remove="${u.id}">Remove</button>` : ''}</td></tr>`).join('')}`;
  $('#inviteForm').hidden = !manager;
  $('#invites').innerHTML = O.invites.length ? `<tr><th>Invited</th><th>Role</th><th></th></tr>${O.invites.map((i) => `<tr><td>${esc(i.email)}</td><td>${esc(i.role)}</td><td><button class="btn ghost sm" data-uninvite="${i.id}">Cancel</button></td></tr>`).join('')}` : '';
  $('#churchCard').hidden = !manager;
  $('#orgForm').name.value = O.org.name; $('#orgCountry').innerHTML = countryOptions(O.org.country);
  $('#meText').textContent = `Signed in as ${M.user.email}.`;
  banner();
}

const act = async (fn, okText) => { try { await fn(); if (okText) toast(okText); await load(); } catch (e) { toast(e.message, true); } };
$('#orgPick').onchange = () => { orgId = $('#orgPick').value; load(); };
$('#addOrg').onclick = async () => { const name = prompt('Name of the church'); if (!name) return; const r = await api('/api/orgs', { name, country: O?.org.country || '' }).catch((e) => toast(e.message, true)); if (r) { M = await me(); orgId = r.id; load(); } };
$$('#cycle button').forEach((b) => { b.onclick = () => { cycle = b.dataset.v; $$('#cycle button').forEach((x) => x.classList.toggle('on', x === b)); renderBuy(); }; });
$('#buyPlans').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-buy]'); if (!b) return; b.disabled = true;
  try { const r = await api(`/api/orgs/${orgId}/checkout`, { plan: b.dataset.buy, interval: cycle, provider: b.dataset.p }); location.href = r.url; }
  catch (err) { toast(err.message, true); b.disabled = false; }
});
$('#portal').onclick = async () => { try { location.href = (await api(`/api/orgs/${orgId}/portal`, {})).url; } catch (e) { toast(e.message, true); } };
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.revoke && confirm('Remove this computer? F8 on it goes back to the Free plan.')) act(() => api(`/api/orgs/${orgId}/devices/${t.dataset.revoke}/revoke`, {}), 'Computer removed');
  if (t.dataset.remove && confirm('Remove this person from the team?')) act(() => api(`/api/orgs/${orgId}/members/${t.dataset.remove}`, { remove: true }), 'Removed');
  if (t.dataset.uninvite) act(() => api(`/api/orgs/${orgId}/invites/${t.dataset.uninvite}/cancel`, {}), 'Invitation cancelled');
});
document.addEventListener('change', (e) => { if (e.target.dataset.role) act(() => api(`/api/orgs/${orgId}/members/${e.target.dataset.role}`, { role: e.target.value }), 'Role changed'); });
$('#inviteForm').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); act(async () => { await api(`/api/orgs/${orgId}/invites`, { email: f.get('email'), role: f.get('role') }); e.target.reset(); }, 'Invitation sent'); };
$('#orgForm').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); act(async () => { await api(`/api/orgs/${orgId}`, { name: f.get('name'), country: f.get('country') }); M = await me(); }, 'Saved'); };
$('#pwForm').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api('/api/me/password', { current: f.get('current'), password: f.get('password') }); e.target.reset(); toast('Password changed'); } catch (err) { toast(err.message, true); } };
$('#logout').onclick = async () => { await api('/api/logout', {}); location.href = '/'; };
$('#deleteMe').onclick = async () => {
  const pw = prompt('This deletes your login. Churches where you are the only owner are deleted too. Type your password to confirm:');
  if (!pw) return;
  try { await api('/api/me/delete', { password: pw }); location.href = '/'; } catch (e) { toast(e.message, true); }
};
if (orgId) load(); else $('#orgName').textContent = 'No church yet';

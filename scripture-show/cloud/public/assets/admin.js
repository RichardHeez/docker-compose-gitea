import { $, api, date, esc, me, money, nav, toast } from './common.js';
const m = await me(); nav(m.user);
if (!m.user?.admin) { document.querySelector('.layout').innerHTML = '<p class="msg err">Admins only.</p>'; throw new Error('not admin'); }
const s = await api('/api/admin/stats');
$('#stats').innerHTML = [['Churches', s.churches], ['Users', s.users], ['Pro', s.byPlan.pro], ['Ministry', s.byPlan.ministry], ['On trial', s.trialing],
  ['Computers', s.devices], ['New users (30 days)', s.signups30], ['Monthly income (€)', money(s.mrr.eur, 'EUR')], ['Monthly income ($)', money(s.mrr.usd, 'USD')], ['Monthly income (MoMo)', money(s.mrr.ghs, 'GHS')]]
  .map(([k, v]) => `<div class="card"><b>${esc(v)}</b><span class="muted small">${k}</span></div>`).join('');
async function search() {
  const r = await api(`/api/admin/orgs?q=${encodeURIComponent($('#q').value)}`);
  $('#orgs').innerHTML = `<tr><th>Church</th><th>Owner</th><th>Plan</th><th class="hide-sm">Paid by</th><th class="hide-sm">Until</th><th>PCs</th></tr>${r.orgs.map((o) => `<tr data-id="${o.id}" style="cursor:pointer">
    <td>${esc(o.name)} <span class="muted small">${esc(o.country)}</span><br><span class="muted small">${date(o.created_at)}</span></td><td class="small">${esc(o.owners || '')}</td>
    <td><span class="tag ${o.effective}">${o.effective}</span> ${o.status ? `<span class="muted small">${esc(o.status)}</span>` : ''}</td><td class="hide-sm">${esc({ stripe: 'Card / bank', paystack: 'Mobile Money', manual: 'By hand' }[o.provider] || '')}</td><td class="hide-sm">${date(o.current_period_end)}</td><td>${o.devices}</td></tr>`).join('')}`;
}
$('#q').oninput = search; search();
$('#orgs').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { $('#grant').org.value = tr.dataset.id; $('#grant').until.focus(); } };
$('#grant').onsubmit = async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try { await api(`/api/admin/orgs/${f.get('org')}/grant`, { plan: f.get('plan'), until: f.get('until') }); toast('Saved'); search(); } catch (err) { toast(err.message, true); }
};

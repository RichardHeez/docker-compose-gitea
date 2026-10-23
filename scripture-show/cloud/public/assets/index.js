import { $, $$, api, esc, me, money, nav } from './common.js';
let cycle = 'month', cur = 'eur', info = null;
const FEATURE_NAMES = { ndi: 'NDI output for vMix/OBS', record: 'Recording', stream: 'Live streaming (1080p/4K)', ai: 'AI verse detection', khaya: 'Twi/Akan voice (Khaya)',
  pco: 'Planning Center import', stock: 'Free motion library search', aiMotion: 'AI motion maker', timelines: 'Song timelines', edgeBlend: 'Edge blending & masks', remote: 'Phone remote', designer: 'Slide designer' };
function render() {
  const { plans, prices, trialDays } = info;
  $('#plans').innerHTML = ['free', 'pro', 'ministry'].map((id) => {
    const p = plans[id]; const pr = prices[cur]?.[id]?.[cycle];
    const price = id === 'free' ? `${cur === 'eur' ? '€0' : 'GH₵0'}` : money(pr, cur === 'eur' ? 'EUR' : 'GHS');
    const per = id === 'free' ? 'for ever' : `per ${cycle}`;
    const list = [`${p.outputs} output screens`, `${p.devices} computer${p.devices > 1 ? 's' : ''}`, `${p.seats} team members`,
      ...(id === 'free' ? ['Voice to verse (browser)', 'Songs, slides, motion backgrounds', 'Small “F8” mark on screens'] : ['Everything in F8:', ...p.features.map((f) => FEATURE_NAMES[f])])];
    return `<div class="card plan ${id === 'pro' ? 'best' : ''}"><div class="row between"><h3>${esc(p.name)}</h3>${id === 'pro' ? '<span class="tag pro">Most churches</span>' : ''}</div>
      <span class="muted small">${esc(p.blurb)}</span><div class="price">${price} <small>${per}</small></div>
      <ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <a class="btn ${id === 'pro' ? 'primary' : ''}" href="/signup">${id === 'free' ? 'Start free' : cur === 'eur' ? `Try ${trialDays} days free` : 'Start, then pay with MoMo'}</a></div>`;
  }).join('');
  $('#priceNote').textContent = cur === 'eur'
    ? 'Pay by card, Bancontact or SEPA Direct Debit. Renews automatically; cancel any time. VAT may apply.'
    : 'Pay with MTN MoMo, Telecel Cash, AirtelTigo Money or card. Prepaid — we remind you before it ends; nothing is taken automatically.';
}
$$('#cycle button').forEach((b) => { b.onclick = () => { cycle = b.dataset.v; $$('#cycle button').forEach((x) => x.classList.toggle('on', x === b)); render(); }; });
$$('#cur button').forEach((b) => { b.onclick = () => { cur = b.dataset.v; $$('#cur button').forEach((x) => x.classList.toggle('on', x === b)); render(); }; });
me().then((m) => nav(m.user));
api('/api/plans').then((p) => { info = p; render(); });

/* ===================== My Rental – Customer portal ===================== */
const sb = makeClient(false);            // no persistent Supabase auth session for customers
const KEY = 'rental_customer_token';
const PAY_TONE = { 'UNPAID': 'red', 'PARTIALLY PAID': 'orange', 'PAID': 'green' };
const itemUrl = p => p ? sb.storage.from('item-images').getPublicUrl(p).data.publicUrl : PLACEHOLDER;
let timer = null;

function showLogin(msg = '') {
  clearInterval(timer);
  $('#appView').hidden = true; $('#loginView').hidden = false;
  $('#loginMsg').textContent = msg; $('#configWarn').hidden = configured;
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (!configured) { $('#loginMsg').textContent = 'The app is not configured yet (js/config.js).'; return; }
  f.cid.value = f.cid.value.trim().toUpperCase();
  if (!validate(f, {
    cid: v => !v ? 'Customer ID is required.' : !/^CUS-\d{4,}$/.test(v) ? 'Enter your ID like CUS-0001.' : '',
    pin: (v, el) => !el.value ? 'PIN is required.' : !/^\d{6}$/.test(el.value) ? 'PIN must be exactly 6 digits.' : ''
  })) return;
  await withBusy($('#loginBtn'), async () => {
    try {
      const { data, error } = await sb.rpc('customer_login', { p_customer_number: f.cid.value, p_pin: f.pin.value });
      if (error) throw error;
      if (!data.ok) { $('#loginMsg').textContent = data.message; f.pin.value = ''; return; }
      sessionStorage.setItem(KEY, data.token); f.pin.value = '';
      await load();
    } catch (err) { $('#loginMsg').textContent = friendlyError(err); }
  });
});

$('#logoutBtn').addEventListener('click', async () => {
  const t = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
  if (t) { try { await sb.rpc('customer_logout', { p_token: t }); } catch { /* ignore */ } }
  showLogin();
});
$('#refreshBtn').addEventListener('click', () => load(true));

async function load(manual = false) {
  const token = sessionStorage.getItem(KEY);
  if (!token) return showLogin();
  const body = $('#portalBody');
  if (!$('#loginView').hidden || manual || !body.innerHTML) { $('#loginView').hidden = true; $('#appView').hidden = false; if (!body.innerHTML) body.innerHTML = loading(); }
  try {
    const { data, error } = await sb.rpc('customer_dashboard', { p_token: token });
    if (error) throw error;
    if (!data.ok) { sessionStorage.removeItem(KEY); return showLogin(data.message); }
    render(data);
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
  } catch (e) {
    if (!body.innerHTML || body.querySelector('.spinner')) body.innerHTML = '';
    body.insertAdjacentHTML('afterbegin', `<div class="warn">${esc(friendlyError(e))}</div>`);
  }
}

function render(d) {
  const c = d.customer;
  const payments = d.payments || [];
  const first = d.rentals[0];
  if (first) setTz(first.billing_policy_snapshot?.timezone);
  $('#portalBody').innerHTML = `
    <div class="card"><div class="profile"><span class="avatar xl">${esc(initials(c.full_name))}</span>
      <div><h2 style="margin:0">${esc(c.full_name)}</h2><div>Customer ID: <b>${esc(c.customer_number)}</b></div><div class="muted">Phone: ${esc(c.phone_masked)}</div></div></div></div>
    ${!d.rentals.length ? `<div class="card">${empty('You have no rentals yet.')}</div>` : d.rentals.map(r => rentalCard(r, payments.filter(p => p.rental_id === r.id))).join('')}
    <p class="muted" style="text-align:center;font-size:12px">Amounts are calculated by the shop's system and update automatically. You cannot change them here.</p>`;
}

function rentalCard(r, pays) {
  const active = r.rental_status === 'ACTIVE';
  const tz = r.billing_policy_snapshot?.timezone;
  const status = !active ? badge('RETURNED', 'gray') : r.is_overdue ? badge('OVERDUE', 'red') : badge('ACTIVE', 'blue');
  return `<div class="card">
    <div class="rent-head"><img src="${esc(itemUrl(r.item_image_path || r.item_thumb_path))}" alt="${esc(r.item_name)}" loading="lazy" onerror="this.onerror=null;this.src=PLACEHOLDER">
      <div><small>${esc(r.item_number)}</small><h2 style="margin:0">${esc(r.item_name)}</h2><div>${money(r.agreed_daily_price)} per day</div><div>${status} ${badge(r.payment_status, PAY_TONE[r.payment_status] || 'gray')}</div></div></div>
    <div class="kv">
      <div><span>Rental start date</span><b>${fmtDate(r.start_date)}</b></div>
      <div><span>Expected return</span><b>${fmtDate(r.expected_return_date)}</b></div>
      <div><span>${active ? 'Current date' : 'Returned on'}</span><b>${active ? fmtDate(todayIn(tz)) : fmtDateTime(r.actual_return_date)}</b></div>
      <div><span>Chargeable days</span><b>${r.chargeable_days}</b></div>
      <div><span>Daily rate</span><b>${money(r.agreed_daily_price)}</b></div>
      <div><span>${active ? 'Current rental amount' : 'Final rental amount'}</span><b>${money(r.total_charges)}</b></div>
      <div><span>Amount paid</span><b>${money(r.total_paid)}</b></div>
      <div><span>Outstanding balance</span><b class="${r.balance > 0 ? 'neg' : ''}">${money(r.balance)}</b></div>
      <div><span>Status</span><b>${active ? (r.is_overdue ? 'OVERDUE' : 'ACTIVE') : 'RETURNED'}</b></div></div>
    <div class="calc">${r.chargeable_days} day${r.chargeable_days === 1 ? '' : 's'} × ${money(r.agreed_daily_price)} = <b>${money(r.total_charges)}</b><br><small>${esc(policyText(r.billing_policy_snapshot))}</small></div>
    ${pays.length ? `<h3>Payments</h3><div class="table-wrap"><table class="tbl" style="min-width:420px"><thead><tr><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${pays.map(p => `<tr><td>${fmtDateTime(p.payment_date)}</td><td>${esc(p.payment_method)}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<small>No payments recorded yet.</small>'}
  </div>`;
}

if (!configured) showLogin(); else if (sessionStorage.getItem(KEY)) load(); else showLogin();

/* ===================== Power Tools – My Rental (customer) ===================== */
const sb = makeClient(false);            // customers never get a Supabase auth session
const KEY = 'power_tools_customer_id';
const PAY_TONE = { 'UNPAID': 'red', 'PARTIALLY PAID': 'orange', 'PAID': 'green' };
const itemUrl = p => p ? sb.storage.from('item-images').getPublicUrl(p).data.publicUrl : PLACEHOLDER;
const geoSupported = 'geolocation' in navigator;

let current = null, lastData = null, refreshTimer = null;
let sharing = false, sendTimer = null, lastSentAt = null, statusNote = '';

/* ---------- views ---------- */
function hideAll() { ['loginView', 'gateView', 'appView'].forEach(id => $('#' + id).hidden = true); }
function showLogin(msg = '') {
  stopSharing(); clearInterval(refreshTimer); hideAll();
  $('#loginView').hidden = false; $('#loginMsg').textContent = msg; $('#configWarn').hidden = configured;
}
function showGate(data, msg = '') {
  hideAll(); $('#gateView').hidden = false;
  $('#gateWho').textContent = `${data.customer.full_name} (${data.customer.customer_number})`;
  $('#gateMsg').textContent = msg;
}
function showApp() { hideAll(); $('#appView').hidden = false; }
function logout() {
  localStorage.removeItem(KEY); current = null; lastData = null;
  $('#portalBody').innerHTML = ''; showLogin();
}

/* ---------- location ---------- */
const getPosition = () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
function geoMessage(err) {
  switch (err && err.code) {
    case 1: return 'Location permission was denied. Allow location for this site in your browser settings, then try again.';
    case 2: return 'Your location could not be determined. Turn on GPS / location services and try again.';
    case 3: return 'Getting your location took too long. Move to an open area and try again.';
    default: return 'Could not get your location.';
  }
}
async function sendPosition(pos) {
  try {
    const { data, error } = await sb.rpc('report_location', { p_customer_number: current, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy });
    if (!error && data && data.ok) { lastSentAt = new Date(); statusNote = ''; } else { statusNote = 'Could not send your location to the shop. Check your internet connection.'; }
  } catch { statusNote = 'Could not send your location to the shop. Check your internet connection.'; }
  updateStatus();
}
function ping() { navigator.geolocation.getCurrentPosition(sendPosition, onGeoError, { enableHighAccuracy: true, timeout: 25000, maximumAge: 20000 }); }
function onGeoError(err) {
  if (err.code === 1) { stopSharing(); if (lastData) showGate(lastData, geoMessage(err)); }
  else { statusNote = geoMessage(err); updateStatus(); }
}
function startSharing() {
  if (sharing) return;
  sharing = true; sendTimer = setInterval(ping, 60000);
}
function stopSharing() { clearInterval(sendTimer); sendTimer = null; sharing = false; }
function updateStatus() {
  const el = $('#locStatus'); if (!el) return;
  const t = lastSentAt ? lastSentAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ }) : '—';
  el.innerHTML = `📍 <b>Location sharing is ON</b> · last sent: ${esc(t)}<br><small>Shared with the shop only while this page is open and while you have an active rental.</small>${statusNote ? `<br><span class="error-text">${esc(statusNote)}</span>` : ''}`;
}
// Already agreed before and the browser still allows it -> no need to ask again
async function tryAutoStart(data) {
  if (!geoSupported || !window.isSecureContext) return false;
  const loc = data && data.location ? data.location : {};
  if (!loc.consented) return false;
  try { const st = await navigator.permissions.query({ name: 'geolocation' }); if (st.state !== 'granted') return false; } catch { return false; }
  try { const pos = await getPosition(); await sendPosition(pos); startSharing(); return true; } catch { return false; }
}

$('#gateAllow').addEventListener('click', async () => {
  const msg = $('#gateMsg'); msg.textContent = '';
  if (!$('#gateConsent').checked) { msg.textContent = 'Please tick the box to agree before continuing.'; return; }
  if (!geoSupported) { msg.textContent = 'This browser does not support location access.'; return; }
  if (!window.isSecureContext) { msg.textContent = 'Location needs a secure (https) connection.'; return; }
  await withBusy($('#gateAllow'), async () => {
    try {
      const pos = await getPosition();
      const { data, error } = await sb.rpc('accept_location_consent', { p_customer_number: current });
      if (error) throw error;
      if (!data || !data.ok) { msg.textContent = (data && data.message) || 'Could not save your consent.'; return; }
      await sendPosition(pos); startSharing();
      $('#gateConsent').checked = false;
      await load(current, false);
    } catch (err) { msg.textContent = err && typeof err.code === 'number' && err.code <= 3 && !err.message?.includes('Failed') ? geoMessage(err) : friendlyError(err); }
  });
});
$('#gateLogout').addEventListener('click', logout);

/* ---------- login ---------- */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (!configured) { $('#loginMsg').textContent = 'The app is not configured yet (js/config.js).'; return; }
  f.cid.value = f.cid.value.trim().toUpperCase();
  if (!validate(f, { cid: v => !v ? 'Customer ID is required.' : !/^CUS-\d{4,}$/.test(v) ? 'Enter your ID like CUS-0001.' : '' })) return;
  await withBusy($('#loginBtn'), async () => {
    try {
      $('#loginMsg').textContent = '';
      if (await load(f.cid.value, true)) localStorage.setItem(KEY, f.cid.value);
    } catch (err) { $('#loginMsg').textContent = friendlyError(err); }
  });
});
$('#logoutBtn').addEventListener('click', logout);
$('#refreshBtn').addEventListener('click', () => { if (current) load(current, false).catch(e => toast(friendlyError(e), 'error')); });

/* ---------- load / render ---------- */
// returns true when the Customer ID is valid (dashboard or consent screen shown)
async function load(customerNumber, fromLogin) {
  const { data, error } = await sb.rpc('customer_dashboard', { p_customer_number: customerNumber });
  if (error) throw error;
  if (!data || !data.ok) {
    const msg = (data && data.message) || 'Customer ID not found. Please check it and try again.';
    if (fromLogin) { $('#loginMsg').textContent = msg; return false; }
    localStorage.removeItem(KEY); showLogin(msg); return false;
  }

  // Make sure these keys exist so nothing downstream reads from undefined
  data.rentals  = data.rentals  || [];
  data.payments = data.payments || [];
  data.location = data.location || { required: false, consented: false };

  current = customerNumber; lastData = data;

  if (data.location.required) {
    if (!sharing && !await tryAutoStart(data)) { showGate(data); startRefresh(); return true; }
  } else {
    stopSharing();
  }
  showApp(); render(data); startRefresh();
  return true;
}
function startRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (!document.hidden && !$('#appView').hidden && current) load(current, false).catch(() => { }); }, 60000);
}

function render(d) {
  const c = d.customer, payments = d.payments || [];
  if (d.rentals[0]) setTz(d.rentals[0].billing_policy_snapshot?.timezone);
  $('#portalBody').innerHTML = `
    <div class="card"><div class="profile"><span class="avatar xl">${esc(initials(c.full_name))}</span>
      <div><h2 style="margin:0">${esc(c.full_name)}</h2><div>Customer ID: <b>${esc(c.customer_number)}</b></div><div class="muted">Phone: ${esc(c.phone_masked)}</div></div></div></div>
    ${(d.location && d.location.required) ? '<div class="calc" id="locStatus"></div>' : ''}
    ${!d.rentals.length ? `<div class="card">${empty('You have no rentals yet.')}</div>` : d.rentals.map(r => rentalCard(r, payments.filter(p => p.rental_id === r.id))).join('')}
    <p class="muted" style="text-align:center;font-size:12px">Amounts are calculated automatically by the shop's system. You cannot change them here.</p>`;
  updateStatus();
}

function rentalCard(r, pays) {
  const active = r.rental_status === 'ACTIVE';
  const pol = r.billing_policy_snapshot || {};
  const status = !active ? badge('RETURNED', 'gray') : r.is_overdue ? badge('OVERDUE', 'red') : badge('ACTIVE', 'blue');
  return `<div class="card">
    <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Rental ${esc(r.rental_number)}</h2><div>${status} ${badge(r.payment_status, PAY_TONE[r.payment_status] || 'gray')}</div></div>
    ${r.items.map(i => `<div class="rent-head" style="margin-bottom:10px"><img src="${esc(itemUrl(i.image_path || i.thumb_path))}" alt="${esc(i.item_name)}" loading="lazy" onerror="this.onerror=null;this.src=PLACEHOLDER">
      <div><small>${esc(i.item_number)}</small><b>${esc(i.item_name)}</b><div>${money(i.price)} per day</div></div></div>`).join('')}
    <div class="kv">
      <div><span>Rental start date</span><b>${fmtDate(r.start_date)}</b></div>
      <div><span>${active ? 'Return by' : 'Returned on'}</span><b>${active ? `${fmtDate(r.start_date)}, ${fmtHour(pol.closing_hour ?? 21)}` : fmtDateTime(r.actual_return_date)}</b></div>
      ${active ? `<div><span>Current date</span><b>${fmtDate(todayIn(pol.timezone))}</b></div>` : ''}
      <div><span>Chargeable days</span><b>${r.chargeable_days}</b>${r.days_adjusted ? badge('ADJUSTED BY SHOP', 'orange') : ''}</div>
      <div><span>Daily rate (all items)</span><b>${money(r.daily_total)}</b></div>
      <div><span>${active ? 'Current rental amount' : 'Final rental amount'}</span><b>${money(r.total_charges)}</b></div>
      <div><span>Amount paid</span><b>${money(r.total_paid)}</b></div>
      <div><span>Outstanding balance</span><b class="${r.balance > 0 ? 'neg' : ''}">${money(r.balance)}</b></div></div>
    <div class="calc">${r.chargeable_days} day${r.chargeable_days === 1 ? '' : 's'} × ${money(r.daily_total)} = <b>${money(r.total_charges)}</b><br><small>${esc(policyText(pol))}</small></div>
    ${pays.length ? `<h3>Payments</h3><div class="table-wrap"><table class="tbl" style="min-width:420px"><thead><tr><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${pays.map(p => `<tr><td>${fmtDateTime(p.payment_date)}</td><td>${esc(p.payment_method)}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<small>No payments recorded yet.</small>'}
  </div>`;
}

(async function start() {
  const saved = localStorage.getItem(KEY);
  if (!configured || !saved) return showLogin();
  try { await load(saved, false); } catch (e) { showLogin(friendlyError(e)); }
})();
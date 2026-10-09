/* ===================== Rental Management – Admin ===================== */
const sb = makeClient(true);
const PAGE = 10;
const METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'];
const ITEM_BUCKET = 'item-images', CUST_BUCKET = 'customer-photos';
const S = { signed: new Map(), settings: null };
const content = $('#content');
const PAY_TONE = { 'UNPAID': 'red', 'PARTIALLY PAID': 'orange', 'PAID': 'green' };
const AVAIL_TONE = { Available: 'green', Rented: 'blue', Maintenance: 'orange' };

/* ---------- images ---------- */
const itemUrl = p => p ? sb.storage.from(ITEM_BUCKET).getPublicUrl(p).data.publicUrl : PLACEHOLDER;
const imgTag = (p, alt = '') => `<img src="${esc(itemUrl(p))}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src=PLACEHOLDER">`;

async function signPhotos(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(p => p && !(S.signed.get(p) && S.signed.get(p).exp > now)))];
  if (!need.length) return;
  const { data, error } = await sb.storage.from(CUST_BUCKET).createSignedUrls(need, 3600);
  if (!error && data) data.forEach(d => { if (d.signedUrl) S.signed.set(d.path, { url: d.signedUrl, exp: now + 55 * 60e3 }); });
}
const custUrl = p => (S.signed.get(p) || {}).url || '';
function avatar(name, path, cls = '') {
  const u = custUrl(path);
  return u ? `<img class="avatar ${cls}" src="${esc(u)}" alt="">` : `<span class="avatar ${cls}">${esc(initials(name))}</span>`;
}

async function putImage(bucket, path, blob) {
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw error;
}
async function uploadImage(bucket, folder, file, { maxSide = 1024, thumb = false } = {}) {
  const id = crypto.randomUUID(), uploaded = [];
  try {
    const path = `${folder}/${id}.jpg`;
    await putImage(bucket, path, await compressImage(file, maxSide, 0.8)); uploaded.push(path);
    let thumbPath = null;
    if (thumb) { thumbPath = `${folder}/${id}_t.jpg`; await putImage(bucket, thumbPath, await compressImage(file, 320, 0.7)); uploaded.push(thumbPath); }
    return { path, thumbPath, uploaded };
  } catch (e) {
    if (uploaded.length) await sb.storage.from(bucket).remove(uploaded);
    throw new Error('Image upload failed: ' + friendlyError(e));
  }
}
const removeFiles = (bucket, paths) => paths.length ? sb.storage.from(bucket).remove(paths).catch(() => { }) : null;

/* ---------- auth ---------- */
function showLogin(msg = '') {
  $('#appView').hidden = true; $('#loginView').hidden = false;
  $('#loginMsg').textContent = msg; $('#configWarn').hidden = configured;
}
async function enter(user) {
  const { data, error } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (error || !data) { await sb.auth.signOut(); showLogin(error ? friendlyError(error) : 'This account is not an authorised administrator.'); return; }
  const { data: set } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if (set) { S.settings = set; setTz(set.timezone); }
  $('#loginView').hidden = true; $('#appView').hidden = false;
  $('#adminEmail').textContent = user.email;
  route();
}
async function boot() {
  if (!configured) { showLogin(); return; }
  sb.auth.onAuthStateChange(ev => {
    if (ev === 'PASSWORD_RECOVERY') openNewPassword(true);
    if (ev === 'SIGNED_OUT') showLogin();
  });
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enter(session.user); else showLogin();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (!configured) { $('#loginMsg').textContent = 'Configure js/config.js first.'; return; }
  if (!validate(f, {
    email: v => !v ? 'Email is required.' : !EMAIL_RE.test(v) ? 'Enter a valid email address.' : '',
    password: (v, el) => !el.value ? 'Password is required.' : el.value.length < 6 ? 'Password must be at least 6 characters.' : ''
  })) return;
  await withBusy($('#loginBtn'), async () => {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) throw error;
      f.password.value = '';
      await enter(data.user);
    } catch (err) {
      $('#loginMsg').textContent = /invalid login/i.test(err.message) ? 'Incorrect email or password.' : friendlyError(err);
    }
  });
});
$('#forgotBtn').addEventListener('click', async () => {
  const f = $('#loginForm');
  if (!validate(f, { email: v => !v ? 'Enter your email above first.' : !EMAIL_RE.test(v) ? 'Enter a valid email address.' : '' })) return;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    $('#loginMsg').style.color = '#14733c';
    $('#loginMsg').textContent = 'If this email belongs to an admin, a reset link has been sent.';
  } catch (err) { $('#loginMsg').style.color = ''; $('#loginMsg').textContent = friendlyError(err); }
});
$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); S.signed.clear(); showLogin(); });
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

function openNewPassword(recovery = false) {
  const m = openModal(recovery ? 'Set a new password' : 'Change password', `<form novalidate>
    ${fieldHtml('New password (min 8 characters)', 'pw1', '<input type="password" name="pw1" autocomplete="new-password">')}
    ${fieldHtml('Confirm new password', 'pw2', '<input type="password" name="pw2" autocomplete="new-password">')}
    <button class="btn btn-primary btn-block">UPDATE PASSWORD</button></form>`);
  const f = $('form', m.body);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(f, {
      pw1: (v, el) => el.value.length < 8 ? 'Use at least 8 characters.' : '',
      pw2: (v, el) => el.value !== f.pw1.value ? 'Passwords do not match.' : ''
    })) return;
    await withBusy($('button', f), async () => {
      try { const { error } = await sb.auth.updateUser({ password: f.pw1.value }); if (error) throw error; toast('Password updated.', 'success'); m.close(); }
      catch (err) { toast(friendlyError(err), 'error'); }
    });
  });
}

/* ---------- router ---------- */
const PAGES = { dashboard: pageDashboard, items: pageItems, customers: pageCustomers, rentals: pageRentals, payments: pagePayments, reports: pageReports, settings: pageSettings };
async function route() {
  const name = (location.hash || '#dashboard').slice(1);
  const fn = PAGES[name] || pageDashboard;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.page === (PAGES[name] ? name : 'dashboard')));
  $('#sidebar').classList.remove('open');
  content.innerHTML = loading();
  try { await fn(); } catch (e) { handleFatal(e); }
}
function handleFatal(e) {
  const msg = friendlyError(e);
  if (/session has expired/.test(msg)) { sb.auth.signOut(); showLogin(msg); return; }
  content.innerHTML = `<div class="card error-card"><h3>Something went wrong</h3><p>${esc(msg)}</p><button class="btn btn-primary" onclick="route()">Retry</button></div>`;
}
window.addEventListener('hashchange', route);

document.addEventListener('click', e => {
  const r = e.target.closest('[data-rental]'); if (r && !e.target.closest('button')) return openRental(r.dataset.rental);
  const c = e.target.closest('[data-customer]'); if (c) return openCustomer(c.dataset.customer);
  const i = e.target.closest('[data-item]'); if (i) return openItem(i.dataset.item);
});

/* ---------- shared tables ---------- */
const statusBadge = r => r.rental_status === 'RETURNED' ? badge('RETURNED', 'gray') : r.is_overdue ? badge('OVERDUE', 'red') : badge('ACTIVE', 'blue');
const payBadge = r => badge(r.payment_status, PAY_TONE[r.payment_status] || 'gray');
function rentalsTable(rows) {
  if (!rows.length) return empty('No rentals found.');
  return `<div class="table-wrap"><table class="tbl clickable"><thead><tr><th>Customer</th><th>Item</th><th>Daily</th><th>Given</th><th>Expected return</th><th>Amount</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.map(r => `
    <tr data-rental="${r.id}">
      <td><div class="who">${avatar(r.customer_name, r.customer_photo_path)}<div><b>${esc(r.customer_name)}</b><small>${esc(r.customer_number)}</small></div></div></td>
      <td><b>${esc(r.item_name)}</b><small>${esc(r.item_number)}</small></td>
      <td>${money(r.agreed_daily_price)}</td><td>${fmtDate(r.start_date)}</td><td>${fmtDate(r.expected_return_date)}</td>
      <td>${money(r.total_charges)}</td><td class="${r.balance > 0 ? 'neg' : ''}">${money(r.balance)}</td>
      <td>${statusBadge(r)}<br>${payBadge(r)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindPager(box, getPage, setPage, reload) {
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
    setPage(Number(b.dataset.page)); reload();
  });
}

/* ================= DASHBOARD ================= */
async function pageDashboard() {
  const [st, rec] = await Promise.all([
    sb.rpc('admin_stats'),
    sb.from('rental_summary').select('*').order('created_at', { ascending: false }).limit(8)
  ]);
  if (st.error) throw st.error; if (rec.error) throw rec.error;
  await signPhotos(rec.data.map(r => r.customer_photo_path));
  const s = st.data;
  const cards = [['Total Items', s.total_items, ''], ['Available Items', s.available_items, 'green'], ['Rented Items', s.rented_items, 'blue'],
    ['Total Customers', s.total_customers, ''], ['Active Rentals', s.active_rentals, 'blue'], ['Overdue Rentals', s.overdue_rentals, 'red'],
    ['Total Outstanding', money(s.outstanding), 'orange']];
  content.innerHTML = `<div class="page-head"><h1>Dashboard</h1><button class="btn btn-light" onclick="route()">↻ Refresh</button></div>
    <div class="stats">${cards.map(c => `<div class="stat ${c[2]}"><b>${esc(c[1])}</b><span>${c[0]}</span></div>`).join('')}</div>
    <div class="card"><h2>Recent rentals</h2>${rentalsTable(rec.data)}</div>`;
}

/* ================= ITEMS ================= */
const itemsQ = { q: '', status: '', page: 1 };
let itemsToken = 0;
async function pageItems() {
  content.innerHTML = `<div class="page-head"><h1>Items</h1><button class="btn btn-primary" id="addItem">+ Add Item</button></div>
    <div class="toolbar"><input type="search" id="iq" placeholder="Search by item name or number" value="${esc(itemsQ.q)}">
    <select id="is"><option value="">All availability</option>${['Available', 'Rented', 'Maintenance'].map(s => `<option ${itemsQ.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div id="itemsList"></div>`;
  $('#addItem').onclick = () => openItemForm();
  $('#iq').oninput = debounce(e => { itemsQ.q = e.target.value; itemsQ.page = 1; loadItems(); });
  $('#is').onchange = e => { itemsQ.status = e.target.value; itemsQ.page = 1; loadItems(); };
  bindPager($('#itemsList'), () => itemsQ.page, p => itemsQ.page = p, loadItems);
  await loadItems();
}
async function loadItems() {
  const box = $('#itemsList'); if (!box) return;
  const tok = ++itemsToken; box.innerHTML = loading();
  try {
    let q = sb.from('items').select('*', { count: 'exact' });
    const t = cleanQ(itemsQ.q); if (t) q = q.or(`item_name.ilike.%${t}%,item_number.ilike.%${t}%`);
    if (itemsQ.status) q = q.eq('availability_status', itemsQ.status);
    const from = (itemsQ.page - 1) * PAGE;
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (tok !== itemsToken) return;
    if (error) throw error;
    box.innerHTML = !data.length ? empty('No items found.') : `<div class="cards">${data.map(i => `
      <div class="item-card">${imgTag(i.thumb_path || i.image_path, i.item_name)}
        <div class="body"><small>${esc(i.item_number)}</small><b>${esc(i.item_name)}</b>
        <div>${money(i.rental_price_per_day)} / day</div><div>${badge(i.availability_status, AVAIL_TONE[i.availability_status])}</div>
        <div class="row"><button class="btn btn-light btn-sm" data-item="${i.id}">View</button><button class="btn btn-light btn-sm" data-edit-item="${i.id}">Edit</button></div></div></div>`).join('')}</div>` + pagerHtml(itemsQ.page, count, PAGE);
    $$('[data-edit-item]', box).forEach(b => b.onclick = async () => {
      const { data: it, error: er } = await sb.from('items').select('*').eq('id', b.dataset.editItem).single();
      if (er) return toast(friendlyError(er), 'error'); openItemForm(it);
    });
  } catch (e) { if (tok === itemsToken) box.innerHTML = `<div class="card error-card"><p>${esc(friendlyError(e))}</p><button class="btn btn-primary" onclick="loadItems()">Retry</button></div>`; }
}

async function openItem(id) {
  const m = openModal('Item details', loading(), { wide: true });
  try {
    const [i, h] = await Promise.all([
      sb.from('items').select('*').eq('id', id).single(),
      sb.from('rental_summary').select('*').eq('item_id', id).order('created_at', { ascending: false }).limit(10)]);
    if (i.error) throw i.error; if (h.error) throw h.error;
    const it = i.data;
    await signPhotos(h.data.map(r => r.customer_photo_path));
    m.body.innerHTML = `<div class="detail-head"><img class="big" style="width:200px;height:150px;object-fit:cover;border-radius:12px" src="${esc(itemUrl(it.image_path))}" onerror="this.onerror=null;this.src=PLACEHOLDER" alt="">
      <div><small>${esc(it.item_number)}</small><h2 style="margin:0">${esc(it.item_name)}</h2><div>${money(it.rental_price_per_day)} / day</div><div>${badge(it.availability_status, AVAIL_TONE[it.availability_status])}</div></div></div>
      <p>${esc(it.description || 'No description.')}</p>
      <div class="actions"><button class="btn btn-light" id="editFromView">Edit item</button></div>
      <h3>Rental history</h3>${rentalsTable(h.data)}`;
    $('#editFromView', m.body).onclick = () => { m.close(); openItemForm(it); };
  } catch (e) { m.body.innerHTML = `<p class="error-text">${esc(friendlyError(e))}</p>`; }
}

function openItemForm(item = null) {
  const editing = !!item, rented = editing && item.availability_status === 'Rented';
  const m = openModal(editing ? 'Edit item' : 'Add new item', `<form novalidate>
    ${fieldHtml('Item number', 'item_number', `<input name="item_number" readonly value="${editing ? esc(item.item_number) : ''}" placeholder="Generated automatically when saved (e.g. ITM-0001)">`)}
    ${fieldHtml('Item name *', 'item_name', `<input name="item_name" maxlength="100" value="${esc(item?.item_name || '')}" placeholder="e.g. Projector">`)}
    ${fieldHtml('Rental price per day (₹) *', 'price', `<input name="price" type="number" inputmode="decimal" step="0.01" min="0.01" value="${editing ? item.rental_price_per_day : ''}" placeholder="e.g. 200">`)}
    <div class="field"><span class="photo-label">Item photo</span>${photoPickerHtml('photo')}</div>
    ${fieldHtml('Description (optional)', 'description', `<textarea name="description" rows="3" maxlength="500">${esc(item?.description || '')}</textarea>`)}
    ${fieldHtml('Availability', 'status', rented ? '<input name="status" value="Rented" readonly>' : '<select name="status"><option>Available</option><option>Maintenance</option></select>')}
    ${rented ? '<small class="hint">This item is rented. Its status changes automatically when the rental is returned.</small>' : ''}
    <button class="btn btn-primary btn-block">${editing ? 'SAVE CHANGES' : 'SUBMIT ITEM'}</button></form>`);
  const f = $('form', m.body);
  if (!rented) f.status.value = item?.availability_status === 'Maintenance' ? 'Maintenance' : 'Available';
  const picker = bindPhotoPicker(f, 'photo', editing && item.image_path ? itemUrl(item.thumb_path || item.image_path) : '');

  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(f, {
      item_name: v => !v ? 'Item name is required.' : v.length < 2 ? 'Item name must be at least 2 characters.' : v.length > 100 ? 'Item name is too long.' : '',
      price: v => { if (!v) return 'Rental price is required.'; const n = Number(v); if (isNaN(n)) return 'Enter a valid number.'; if (n <= 0) return 'Price must be greater than zero.';
        if (n > 1000000) return 'Price is too high.'; if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'Use at most 2 decimal places.'; return ''; },
      description: v => v.length > 500 ? 'Description must be 500 characters or fewer.' : ''
    })) return;
    await withBusy($('button:not([type])', f) || f.querySelector('.btn-primary'), async () => {
      let up = null;
      try {
        let image_path = item?.image_path || null, thumb_path = item?.thumb_path || null;
        if (picker.file()) { up = await uploadImage(ITEM_BUCKET, 'items', picker.file(), { thumb: true }); image_path = up.path; thumb_path = up.thumbPath; }
        const payload = { item_name: f.item_name.value.trim(), description: f.description.value.trim() || null, rental_price_per_day: Number(f.price.value), image_path, thumb_path };
        if (!rented) payload.availability_status = f.status.value;
        const { error } = editing ? await sb.from('items').update(payload).eq('id', item.id) : await sb.from('items').insert(payload);
        if (error) throw error;
        if (up && editing) removeFiles(ITEM_BUCKET, [item.image_path, item.thumb_path].filter(Boolean));
        toast(editing ? 'Item updated.' : 'Item added to inventory.', 'success');
        m.close(); route();
      } catch (err) {
        if (up) removeFiles(ITEM_BUCKET, up.uploaded);
        toast(friendlyError(err), 'error');   // form stays open and filled in
      }
    });
  });
}

/* ================= CUSTOMERS ================= */
const custQ = { q: '', page: 1 };
let custToken = 0;
async function pageCustomers() {
  content.innerHTML = `<div class="page-head"><h1>Customers</h1><button class="btn btn-primary" id="addCust">+ Add Customer</button></div>
    <div class="toolbar"><input type="search" id="cq" placeholder="Search by name, Customer ID or phone" value="${esc(custQ.q)}"></div><div id="custList"></div>`;
  $('#addCust').onclick = () => openCustomerForm();
  $('#cq').oninput = debounce(e => { custQ.q = e.target.value; custQ.page = 1; loadCustomers(); });
  bindPager($('#custList'), () => custQ.page, p => custQ.page = p, loadCustomers);
  await loadCustomers();
}
async function loadCustomers() {
  const box = $('#custList'); if (!box) return;
  const tok = ++custToken; box.innerHTML = loading();
  try {
    let q = sb.from('customers').select('*', { count: 'exact' });
    const t = cleanQ(custQ.q); if (t) q = q.or(`full_name.ilike.%${t}%,customer_number.ilike.%${t}%,phone_number.ilike.%${t}%`);
    const from = (custQ.page - 1) * PAGE;
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (tok !== custToken) return;
    if (error) throw error;
    await signPhotos(data.map(c => c.photo_path));
    box.innerHTML = !data.length ? `<div class="card">${empty('No customers found.')}</div>` : `<div class="card"><div class="table-wrap"><table class="tbl clickable"><thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th>Registered</th></tr></thead><tbody>${data.map(c => `
      <tr data-customer="${c.id}"><td><div class="who">${avatar(c.full_name, c.photo_path)}<div><b>${esc(c.full_name)}</b><small>${esc(c.customer_number)}</small></div></div></td>
      <td>${esc(c.phone_number)}</td><td>${esc(c.address || '—')}</td><td>${fmtDate(dateIn(c.created_at))}</td></tr>`).join('')}</tbody></table></div>${pagerHtml(custQ.page, count, PAGE)}</div>`;
  } catch (e) { if (tok === custToken) box.innerHTML = `<div class="card error-card"><p>${esc(friendlyError(e))}</p><button class="btn btn-primary" onclick="loadCustomers()">Retry</button></div>`; }
}

/* rental fields shared by "Add customer" and "New rental" */
async function loadEligibleItems() {
  const { data, error } = await sb.from('items').select('id,item_number,item_name,rental_price_per_day,image_path,thumb_path').eq('availability_status', 'Available').order('item_name').limit(500);
  if (error) throw error; return data;
}
function rentalFieldsHtml(items, required) {
  return `${fieldHtml(required ? 'Select rental item *' : 'Select rental item (optional)', 'item_id',
    `<select name="item_id"><option value="">${required ? '— Select an item —' : '— No item for now —'}</option>${items.map(i => `<option value="${i.id}">${esc(i.item_number)} · ${esc(i.item_name)} (${money(i.rental_price_per_day)}/day)</option>`).join('')}</select>`)}
    ${items.length ? '' : '<small class="hint">No items are currently available for rent.</small>'}
    <div class="item-preview" data-role="preview" hidden></div>
    <div data-role="extra" hidden>
      <div class="grid2">${fieldHtml('Given date *', 'start_date', `<input type="date" name="start_date" value="${todayIn()}">`)}${fieldHtml('Expected return date *', 'expected_date', '<input type="date" name="expected_date">')}</div>
      ${fieldHtml('Agreed daily rental price (₹) *', 'price', '<input type="number" name="price" inputmode="decimal" step="0.01" min="0.01">')}
      <small class="hint">Copied from the item's current price and saved with this rental, so later price changes won't affect it.</small></div>`;
}
function bindRentalFields(f, items, onToggle) {
  const sel = f.elements.item_id;
  sel.addEventListener('change', () => {
    const it = items.find(i => i.id === sel.value);
    $('[data-role=preview]', f).hidden = !it; $('[data-role=extra]', f).hidden = !it;
    if (it) {
      $('[data-role=preview]', f).innerHTML = `${imgTag(it.thumb_path || it.image_path, it.item_name)}<div><small>${esc(it.item_number)}</small><b>${esc(it.item_name)}</b><div>${money(it.rental_price_per_day)} / day</div></div>`;
      f.elements.price.value = it.rental_price_per_day;
    }
    onToggle && onToggle(!!it);
  });
}
function rentalRules(f) {
  return {
    start_date: v => !v ? 'Given date is required.' : !validDate(v) ? 'Enter a valid date.' : '',
    expected_date: v => !v ? 'Expected return date is required.' : !validDate(v) ? 'Enter a valid date.' : (validDate(f.start_date.value) && v < f.start_date.value) ? 'Expected return cannot be before the given date.' : '',
    price: v => { if (!v) return 'Daily price is required.'; const n = Number(v); if (isNaN(n) || n <= 0) return 'Price must be greater than zero.'; if (n > 1000000) return 'Price is too high.'; if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'Use at most 2 decimal places.'; return ''; }
  };
}

async function openCustomerForm() {
  const m = openModal('Add customer', loading());
  let items;
  try { items = await loadEligibleItems(); } catch (e) { m.body.innerHTML = `<p class="error-text">${esc(friendlyError(e))}</p>`; return; }
  m.body.innerHTML = `<form novalidate>
    ${fieldHtml('Customer ID', 'customer_number', '<input name="customer_number" readonly placeholder="Generated automatically when saved (e.g. CUS-0001)">')}
    ${fieldHtml('Customer name *', 'full_name', '<input name="full_name" maxlength="100" autocomplete="off">')}
    ${fieldHtml('Phone number * (10-digit mobile)', 'phone', '<input name="phone" type="tel" inputmode="numeric" maxlength="16" placeholder="9876543210">')}
    ${fieldHtml('Address (optional)', 'address', '<textarea name="address" rows="2" maxlength="300"></textarea>')}
    <div class="field"><span class="photo-label">Customer photo (optional)</span>${photoPickerHtml('photo')}</div>
    ${rentalFieldsHtml(items, false)}
    <label class="check field"><input type="checkbox" name="consent"><span>The customer has agreed that their name, phone number, address and photo are stored for managing this rental.</span></label>
    <small class="field-error" data-error-for="consent"></small>
    <button class="btn btn-primary btn-block" id="custSubmit">CREATE CUSTOMER</button></form>`;
  const f = $('form', m.body), submit = $('#custSubmit', m.body);
  const picker = bindPhotoPicker(f, 'photo');
  bindRentalFields(f, items, has => submit.textContent = has ? 'CREATE CUSTOMER AND RENTAL' : 'CREATE CUSTOMER');

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const rules = {
      full_name: v => !v ? 'Customer name is required.' : !NAME_RE.test(v) ? 'Use letters only (2–100 characters).' : '',
      phone: v => !v ? 'Phone number is required.' : !PHONE_RE.test(normalizePhone(v)) ? 'Enter a valid 10-digit mobile number.' : '',
      address: v => v.length > 300 ? 'Address must be 300 characters or fewer.' : '',
      consent: (v, el) => el.checked ? '' : 'Customer consent is required.'
    };
    const hasItem = !!f.item_id.value;
    if (hasItem) Object.assign(rules, rentalRules(f));
    if (!validate(f, rules)) return;
    await withBusy(submit, async () => {
      let up = null;
      try {
        let photo_path = null;
        if (picker.file()) { up = await uploadImage(CUST_BUCKET, 'customers', picker.file(), { maxSide: 800 }); photo_path = up.path; }
        const { data, error } = await sb.rpc('register_customer', {
          p_name: f.full_name.value.trim(), p_phone: normalizePhone(f.phone.value), p_address: f.address.value.trim() || null, p_photo_path: photo_path,
          p_item_id: hasItem ? f.item_id.value : null, p_start: hasItem ? f.start_date.value : null,
          p_expected: hasItem ? f.expected_date.value : null, p_price: hasItem ? Number(f.price.value) : null });
        if (error) throw error;
        m.close(); route();
        showCredentials(data.customer_number, data.pin, data.rental);
      } catch (err) {
        if (up) removeFiles(CUST_BUCKET, up.uploaded);
        toast(friendlyError(err), 'error');   // form stays filled in
      }
    });
  });
}

function showCredentials(customerNumber, pin, rental) {
  const m = openModal('Customer created', `<p>${rental ? `Rental <b>${esc(rental.rental_number)}</b> was created and the item is now marked as rented.` : 'The customer was registered without a rental.'}</p>
    <p>Share these login details with the customer:</p>
    <small>Customer ID</small><div class="big-credential">${esc(customerNumber)}</div>
    <small>PIN (shown only once)</small><div class="big-credential">${esc(pin)}</div>
    <div class="warn">The PIN cannot be viewed again. If it is lost, open the customer and choose "Reset PIN".</div>
    <div class="actions"><button class="btn btn-primary" id="copyCred">Copy details</button><button class="btn btn-light" data-close>Done</button></div>`);
  $('#copyCred', m.body).onclick = async () => {
    try { await navigator.clipboard.writeText(`Customer ID: ${customerNumber}\nPIN: ${pin}`); toast('Copied.', 'success'); }
    catch { toast('Could not copy automatically. Please note the details down.', 'error'); }
  };
}

async function openCustomer(id) {
  const m = openModal('Customer details', loading(), { wide: true });
  try {
    const [c, r] = await Promise.all([
      sb.from('customers').select('*').eq('id', id).single(),
      sb.from('rental_summary').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(50)]);
    if (c.error) throw c.error; if (r.error) throw r.error;
    const cu = c.data; await signPhotos([cu.photo_path]);
    m.body.innerHTML = `<div class="detail-head">${avatar(cu.full_name, cu.photo_path, 'xl')}
      <div><small>${esc(cu.customer_number)}</small><h2 style="margin:0">${esc(cu.full_name)}</h2><div>${esc(cu.phone_number)}</div><div class="muted">${esc(cu.address || 'No address')}</div></div></div>
      <div class="actions"><button class="btn btn-primary" id="newRental">+ New rental</button><button class="btn btn-light" id="resetPin">Reset PIN</button></div>
      <h3>Rental history</h3>${rentalsTable(r.data)}`;
    $('#newRental', m.body).onclick = () => openNewRental(cu, () => { m.close(); route(); });
    $('#resetPin', m.body).onclick = async () => {
      if (!await confirmDialog(`Generate a new PIN for ${cu.full_name}? The old PIN will stop working and they will be logged out.`, 'Reset PIN')) return;
      try { const { data, error } = await sb.rpc('reset_customer_pin', { p_customer_id: cu.id }); if (error) throw error; showCredentials(cu.customer_number, data, null); }
      catch (e) { toast(friendlyError(e), 'error'); }
    };
  } catch (e) { m.body.innerHTML = `<p class="error-text">${esc(friendlyError(e))}</p>`; }
}

async function openNewRental(customer, done) {
  const m = openModal(`New rental – ${customer.full_name}`, loading());
  let items; try { items = await loadEligibleItems(); } catch (e) { m.body.innerHTML = `<p class="error-text">${esc(friendlyError(e))}</p>`; return; }
  m.body.innerHTML = `<form novalidate>${rentalFieldsHtml(items, true)}<button class="btn btn-primary btn-block">CREATE RENTAL</button></form>`;
  const f = $('form', m.body); bindRentalFields(f, items);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(f, { item_id: v => v ? '' : 'Please select an item.', ...rentalRules(f) })) return;
    await withBusy($('button', f), async () => {
      try {
        const { error } = await sb.rpc('create_rental', { p_customer_id: customer.id, p_item_id: f.item_id.value, p_start: f.start_date.value, p_expected: f.expected_date.value, p_price: Number(f.price.value) });
        if (error) throw error; toast('Rental created.', 'success'); m.close(); done();
      } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });
}

/* ================= RENTALS ================= */
const rentQ = { q: '', filter: '', page: 1 };
let rentToken = 0;
async function pageRentals() {
  const opts = [['', 'All rentals'], ['active', 'Active'], ['returned', 'Returned'], ['overdue', 'Overdue'], ['unpaid', 'Unpaid'], ['partial', 'Partially paid'], ['paid', 'Paid']];
  content.innerHTML = `<div class="page-head"><h1>Rentals</h1></div>
    <div class="toolbar"><input type="search" id="rq" placeholder="Customer ID, name, phone, item number or item name" value="${esc(rentQ.q)}">
    <select id="rf">${opts.map(o => `<option value="${o[0]}" ${rentQ.filter === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
    <div class="card" id="rentList"></div>`;
  $('#rq').oninput = debounce(e => { rentQ.q = e.target.value; rentQ.page = 1; loadRentals(); });
  $('#rf').onchange = e => { rentQ.filter = e.target.value; rentQ.page = 1; loadRentals(); };
  bindPager($('#rentList'), () => rentQ.page, p => rentQ.page = p, loadRentals);
  await loadRentals();
}
async function loadRentals() {
  const box = $('#rentList'); if (!box) return;
  const tok = ++rentToken; box.innerHTML = loading();
  try {
    let q = sb.from('rental_summary').select('*', { count: 'exact' });
    const t = cleanQ(rentQ.q);
    if (t) q = q.or(['customer_number', 'customer_name', 'phone_number', 'item_number', 'item_name', 'rental_number'].map(c => `${c}.ilike.%${t}%`).join(','));
    const F = rentQ.filter;
    if (F === 'active') q = q.eq('rental_status', 'ACTIVE'); else if (F === 'returned') q = q.eq('rental_status', 'RETURNED');
    else if (F === 'overdue') q = q.eq('is_overdue', true); else if (F === 'unpaid') q = q.eq('payment_status', 'UNPAID');
    else if (F === 'partial') q = q.eq('payment_status', 'PARTIALLY PAID'); else if (F === 'paid') q = q.eq('payment_status', 'PAID');
    const from = (rentQ.page - 1) * PAGE;
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (tok !== rentToken) return;
    if (error) throw error;
    await signPhotos(data.map(r => r.customer_photo_path));
    box.innerHTML = rentalsTable(data) + pagerHtml(rentQ.page, count, PAGE);
  } catch (e) { if (tok === rentToken) box.innerHTML = `<div class="error-card"><p>${esc(friendlyError(e))}</p><button class="btn btn-primary" onclick="loadRentals()">Retry</button></div>`; }
}

async function openRental(id) {
  const m = openModal('Rental details', loading(), { wide: true });
  try { await renderRental(m, id); } catch (e) { m.body.innerHTML = `<p class="error-text">${esc(friendlyError(e))}</p>`; }
}
async function renderRental(m, id) {
  const [r, p] = await Promise.all([
    sb.from('rental_summary').select('*').eq('id', id).single(),
    sb.from('payments').select('*').eq('rental_id', id).order('payment_date', { ascending: false })]);
  if (r.error) throw r.error; if (p.error) throw p.error;
  const x = r.data; await signPhotos([x.customer_photo_path]);
  const active = x.rental_status === 'ACTIVE';
  m.body.innerHTML = `
    <div class="detail-head">${avatar(x.customer_name, x.customer_photo_path, 'xl')}
      <div><small>${esc(x.customer_number)}</small><h2 style="margin:0">${esc(x.customer_name)}</h2><div>${esc(x.phone_number)}</div></div>
      <div style="margin-left:auto;display:flex;gap:12px;align-items:center">${imgTag(x.item_thumb_path || x.item_image_path, x.item_name).replace('<img', '<img class="big" style="width:96px;height:72px;object-fit:cover;border-radius:10px"')}
        <div><small>${esc(x.item_number)}</small><b>${esc(x.item_name)}</b></div></div></div>
    <div class="kv">
      <div><span>Rental no.</span><b>${esc(x.rental_number)}</b></div>
      <div><span>Daily rent</span><b>${money(x.agreed_daily_price)}</b></div>
      <div><span>Given date</span><b>${fmtDate(x.start_date)}</b></div>
      <div><span>Expected return</span><b>${fmtDate(x.expected_return_date)}</b></div>
      <div><span>${active ? 'Today' : 'Returned on'}</span><b>${active ? fmtDate(todayIn(x.billing_policy_snapshot?.timezone)) : fmtDateTime(x.actual_return_date)}</b></div>
      <div><span>Chargeable days</span><b>${x.chargeable_days}</b></div>
      <div><span>${active ? 'Current rental amount' : 'Final rental amount'}</span><b>${money(x.total_charges)}</b></div>
      <div><span>Amount paid</span><b>${money(x.total_paid)}</b></div>
      <div><span>Outstanding balance</span><b class="${x.balance > 0 ? 'neg' : ''}">${money(x.balance)}</b></div>
      <div><span>Rental status</span>${statusBadge(x)}</div>
      <div><span>Payment status</span>${payBadge(x)}</div></div>
    <div class="calc"><b>Calculation:</b> ${x.chargeable_days} day${x.chargeable_days === 1 ? '' : 's'} × ${money(x.agreed_daily_price)} = <b>${money(x.total_charges)}</b>
      ${active ? '(increases automatically each day until returned)' : '(charges stopped when the item was returned)'}<br><small>${esc(policyText(x.billing_policy_snapshot))}</small></div>
    <div class="actions">
      ${(x.balance > 0) ? '<button class="btn btn-primary" id="recPay">Record payment</button>' : ''}
      ${active ? '<button class="btn btn-danger" id="markRet">MARK AS RETURNED</button>' : ''}</div>
    <h3>Payment history</h3>
    ${!p.data.length ? empty('No payments recorded yet.') : `<div class="table-wrap"><table class="tbl"><thead><tr><th>Payment</th><th>Date</th><th>Method</th><th class="r">Amount</th><th>Notes</th><th></th></tr></thead><tbody>${p.data.map(y => `
      <tr style="${y.voided ? 'opacity:.6;text-decoration:line-through' : ''}"><td>${esc(y.payment_number)}</td><td>${fmtDateTime(y.payment_date)}</td><td>${esc(y.payment_method)}</td><td class="r">${money(y.amount)}</td>
      <td>${esc(y.notes || '')}${y.voided ? `<br>${badge('VOIDED', 'gray')} <small style="text-decoration:none">${esc(y.void_reason || '')}</small>` : ''}</td>
      <td>${y.voided ? '' : `<button class="btn btn-light btn-sm" data-void="${y.id}">Void</button>`}</td></tr>`).join('')}</tbody></table></div>`}`;

  const refresh = async () => { await renderRental(m, id); route(); };
  const pay = $('#recPay', m.body); if (pay) pay.onclick = () => openPaymentForm(x, refresh);
  const ret = $('#markRet', m.body);
  if (ret) ret.onclick = async () => {
    if (!await confirmDialog(`Mark ${x.item_name} (${x.item_number}) as returned by ${x.customer_name}? The final amount is calculated as of now, charges stop, and this cannot be undone.`, 'Mark as returned', true)) return;
    await withBusy(ret, async () => {
      try { const { error } = await sb.rpc('return_rental', { p_rental_id: id }); if (error) throw error; toast('Rental marked as returned.', 'success'); await refresh(); }
      catch (e) { toast(friendlyError(e), 'error'); }
    });
  };
  $$('[data-void]', m.body).forEach(b => b.onclick = () => voidPayment(b.dataset.void, refresh));
}

async function voidPayment(paymentId, done) {
  const reason = await promptDialog({ title: 'Void payment', label: 'Reason for correction *', okLabel: 'Void payment' });
  if (!reason) return;
  try { const { error } = await sb.rpc('void_payment', { p_payment_id: paymentId, p_reason: reason }); if (error) throw error; toast('Payment voided and logged.', 'success'); await done(); }
  catch (e) { toast(friendlyError(e), 'error'); }
}

function openPaymentForm(x, done) {
  const allow = !!x.billing_policy_snapshot?.allow_overpayment;
  const m = openModal('Record payment', `<form novalidate>
    <div class="summary-line">${esc(x.rental_number)} · ${esc(x.customer_name)} · Outstanding <b>${money(x.balance)}</b></div>
    ${fieldHtml('Amount (₹) *', 'amount', '<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="e.g. 200">')}
    ${fieldHtml('Payment method *', 'method', `<select name="method">${METHODS.map(s => `<option>${s}</option>`).join('')}</select>`)}
    ${fieldHtml('Notes (optional)', 'notes', '<textarea name="notes" rows="2" maxlength="300"></textarea>')}
    <button class="btn btn-primary btn-block">RECORD PAYMENT</button></form>`);
  const f = $('form', m.body);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(f, {
      amount: v => { if (!v) return 'Amount is required.'; const n = Number(v); if (isNaN(n) || n <= 0) return 'Amount must be greater than zero.';
        if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'Use at most 2 decimal places.'; if (!allow && n > Number(x.balance)) return `Amount cannot exceed the outstanding balance of ${money(x.balance)}.`; return ''; },
      method: v => METHODS.includes(v) ? '' : 'Choose a payment method.',
      notes: v => v.length > 300 ? 'Notes must be 300 characters or fewer.' : ''
    })) return;
    await withBusy($('button', f), async () => {
      try {
        const { error } = await sb.rpc('record_payment', { p_rental_id: x.id, p_amount: Number(f.amount.value), p_method: f.method.value, p_notes: f.notes.value.trim() || null });
        if (error) throw error; toast('Payment recorded.', 'success'); m.close(); await done();
      } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });
}

/* ================= PAYMENTS ================= */
const payQ = { page: 1 };
async function pagePayments() {
  content.innerHTML = `<div class="page-head"><h1>Payments</h1><button class="btn btn-primary" id="newPay">+ Record payment</button></div><div class="card" id="payList"></div>`;
  $('#newPay').onclick = pickRentalForPayment;
  bindPager($('#payList'), () => payQ.page, p => payQ.page = p, loadPayments);
  await loadPayments();
}
async function loadPayments() {
  const box = $('#payList'); if (!box) return;
  box.innerHTML = loading();
  try {
    const from = (payQ.page - 1) * PAGE;
    const { data, error, count } = await sb.from('payments')
      .select('*, rentals(id, rental_number, customers(customer_number, full_name), items(item_number, item_name))', { count: 'exact' })
      .order('payment_date', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    box.innerHTML = (!data.length ? empty('No payments recorded yet.') : `<div class="table-wrap"><table class="tbl"><thead><tr><th>Payment</th><th>Date</th><th>Customer</th><th>Item</th><th>Rental</th><th>Method</th><th class="r">Amount</th><th></th></tr></thead><tbody>${data.map(y => `
      <tr style="${y.voided ? 'opacity:.6' : ''}"><td>${esc(y.payment_number)}</td><td>${fmtDateTime(y.payment_date)}</td>
      <td><b>${esc(y.rentals?.customers?.full_name)}</b><small>${esc(y.rentals?.customers?.customer_number)}</small></td>
      <td>${esc(y.rentals?.items?.item_name)}<small>${esc(y.rentals?.items?.item_number)}</small></td>
      <td><a href="#" data-rental="${y.rentals?.id}" onclick="return false">${esc(y.rentals?.rental_number)}</a></td><td>${esc(y.payment_method)}</td>
      <td class="r" style="${y.voided ? 'text-decoration:line-through' : ''}">${money(y.amount)}</td>
      <td>${y.voided ? badge('VOIDED', 'gray') : `<button class="btn btn-light btn-sm" data-void="${y.id}">Void</button>`}</td></tr>`).join('')}</tbody></table></div>`) + pagerHtml(payQ.page, count, PAGE);
    $$('[data-void]', box).forEach(b => b.onclick = () => voidPayment(b.dataset.void, loadPayments));
  } catch (e) { box.innerHTML = `<div class="error-card"><p>${esc(friendlyError(e))}</p><button class="btn btn-primary" onclick="loadPayments()">Retry</button></div>`; }
}
async function pickRentalForPayment() {
  const m = openModal('Record payment', loading());
  try {
    const { data, error } = await sb.from('rental_summary').select('*').gt('balance', 0).order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    if (!data.length) { m.body.innerHTML = empty('No rentals have an outstanding balance.'); return; }
    m.body.innerHTML = `<form novalidate>${fieldHtml('Select rental *', 'rental', `<select name="rental"><option value="">— Select —</option>${data.map(r => `<option value="${r.id}">${esc(r.customer_name)} (${esc(r.customer_number)}) · ${esc(r.item_name)} · due ${money(r.balance)}</option>`).join('')}</select>`)}<button class="btn btn-primary btn-block">CONTINUE</button></form>`;
    const f = $('form', m.body);
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (!validate(f, { rental: v => v ? '' : 'Please select a rental.' })) return;
      const x = data.find(r => r.id === f.rental.value); m.close(); openPaymentForm(x, async () => { loadPayments(); });
    });
  } catch (e) { m.body.innerHTML = `<p class="error-text">${esc(friendlyError(e))}</p>`; }
}

/* ================= REPORTS ================= */
async function fetchAll(q) { const { data, error } = await q.limit(5000); if (error) throw error; return data; }
const RENTAL_COLS = [
  { key: 'rental_number', label: 'Rental' }, { key: 'customer_number', label: 'Customer ID' }, { key: 'customer_name', label: 'Customer' }, { key: 'phone_number', label: 'Phone' },
  { key: 'item_number', label: 'Item no.' }, { key: 'item_name', label: 'Item' }, { key: 'start_date', label: 'Given', type: 'date' }, { key: 'expected_return_date', label: 'Expected', type: 'date' },
  { key: 'returned_on', label: 'Returned' }, { key: 'agreed_daily_price', label: 'Daily', type: 'money' }, { key: 'chargeable_days', label: 'Days' },
  { key: 'total_charges', label: 'Charges', type: 'money' }, { key: 'total_paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' },
  { key: 'status', label: 'Status' }, { key: 'payment_status', label: 'Payment' }];
const rentalRows = rows => rows.map(r => ({ ...r, returned_on: r.actual_return_date ? dateIn(r.actual_return_date) : '', status: r.rental_status === 'RETURNED' ? 'RETURNED' : r.is_overdue ? 'OVERDUE' : 'ACTIVE' }));
async function paymentsInRange(from, to) {
  const data = await fetchAll(sb.from('payments').select('*, rentals(rental_number, customers(customer_number, full_name), items(item_number))')
    .eq('voided', false).gte('payment_date', addDays(from, -1)).lt('payment_date', addDays(to, 2)).order('payment_date'));
  return data.filter(p => { const d = dateIn(p.payment_date); return d >= from && d <= to; });
}
const REPORTS = {
  rented: { label: 'Currently rented items', run: async () => ({ cols: RENTAL_COLS, rows: rentalRows(await fetchAll(sb.from('rental_summary').select('*').eq('rental_status', 'ACTIVE').order('start_date'))) }) },
  available: { label: 'Available items', run: async () => ({ cols: [{ key: 'item_number', label: 'Item no.' }, { key: 'item_name', label: 'Item' }, { key: 'rental_price_per_day', label: 'Daily price', type: 'money' }],
    rows: await fetchAll(sb.from('items').select('*').eq('availability_status', 'Available').order('item_number')) }) },
  overdue: { label: 'Overdue rentals', run: async () => ({ cols: RENTAL_COLS, rows: rentalRows(await fetchAll(sb.from('rental_summary').select('*').eq('is_overdue', true).order('expected_return_date'))) }) },
  returned: { label: 'Items returned (date range)', range: true, run: async (from, to) => {
    const d = await fetchAll(sb.from('rental_summary').select('*').eq('rental_status', 'RETURNED').gte('actual_return_date', addDays(from, -1)).lt('actual_return_date', addDays(to, 2)).order('actual_return_date'));
    return { cols: RENTAL_COLS, rows: rentalRows(d.filter(r => { const x = dateIn(r.actual_return_date); return x >= from && x <= to; })) }; } },
  daily: { label: 'Daily collections (date range)', range: true, run: async (from, to) => {
    const g = {}; (await paymentsInRange(from, to)).forEach(p => { const d = dateIn(p.payment_date); g[d] = g[d] || { date: d, count: 0, total: 0 }; g[d].count++; g[d].total += Number(p.amount); });
    const rows = Object.values(g).sort((a, b) => a.date.localeCompare(b.date)); rows.push({ date: 'TOTAL', count: rows.reduce((s, r) => s + r.count, 0), total: rows.reduce((s, r) => s + r.total, 0) });
    return { cols: [{ key: 'date', label: 'Date' }, { key: 'count', label: 'Payments' }, { key: 'total', label: 'Collected', type: 'money' }], rows }; } },
  monthly: { label: 'Monthly collections (date range)', range: true, run: async (from, to) => {
    const g = {}; (await paymentsInRange(from, to)).forEach(p => { const d = dateIn(p.payment_date).slice(0, 7); g[d] = g[d] || { month: d, count: 0, total: 0 }; g[d].count++; g[d].total += Number(p.amount); });
    const rows = Object.values(g).sort((a, b) => a.month.localeCompare(b.month)); rows.push({ month: 'TOTAL', count: rows.reduce((s, r) => s + r.count, 0), total: rows.reduce((s, r) => s + r.total, 0) });
    return { cols: [{ key: 'month', label: 'Month' }, { key: 'count', label: 'Payments' }, { key: 'total', label: 'Collected', type: 'money' }], rows }; } },
  outstanding: { label: 'Outstanding customer balances', run: async () => {
    const d = await fetchAll(sb.from('rental_summary').select('customer_number,customer_name,phone_number,balance,total_charges,total_paid').gt('balance', 0)); const g = {};
    d.forEach(r => { const k = r.customer_number; g[k] = g[k] || { customer_number: k, customer_name: r.customer_name, phone_number: r.phone_number, rentals: 0, charges: 0, paid: 0, balance: 0 };
      g[k].rentals++; g[k].charges += Number(r.total_charges); g[k].paid += Number(r.total_paid); g[k].balance += Number(r.balance); });
    const rows = Object.values(g).sort((a, b) => b.balance - a.balance);
    return { cols: [{ key: 'customer_number', label: 'Customer ID' }, { key: 'customer_name', label: 'Customer' }, { key: 'phone_number', label: 'Phone' }, { key: 'rentals', label: 'Rentals' },
      { key: 'charges', label: 'Charges', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }], rows }; } },
  customer: { label: 'Customer rental history', ref: 'Customer ID (e.g. CUS-0001)', run: async (f, t, ref) => ({ cols: RENTAL_COLS, rows: rentalRows(await fetchAll(sb.from('rental_summary').select('*').ilike('customer_number', cleanQ(ref)).order('start_date', { ascending: false }))) }) },
  item: { label: 'Item rental history', ref: 'Item number (e.g. ITM-0001)', run: async (f, t, ref) => ({ cols: RENTAL_COLS, rows: rentalRows(await fetchAll(sb.from('rental_summary').select('*').ilike('item_number', cleanQ(ref)).order('start_date', { ascending: false }))) }) }
};
let lastReport = null;
async function pageReports() {
  const today = todayIn();
  content.innerHTML = `<div class="page-head"><h1>Reports</h1></div><div class="card"><form id="repForm" novalidate>
    <div class="grid2">${fieldHtml('Report', 'report', `<select name="report">${Object.entries(REPORTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>`)}
    <div data-role="ref" hidden>${fieldHtml('Reference', 'ref', '<input name="ref">')}</div></div>
    <div class="grid2" data-role="range">${fieldHtml('From', 'from', `<input type="date" name="from" value="${today.slice(0, 8)}01">`)}${fieldHtml('To', 'to', `<input type="date" name="to" value="${today}">`)}</div>
    <div class="actions"><button class="btn btn-primary" id="runRep">Run report</button><button type="button" class="btn btn-light" id="csvRep" disabled>Export CSV</button></div></form></div>
    <div class="card" id="repOut"><div class="empty">Choose a report and press “Run report”.</div></div>`;
  const f = $('#repForm');
  const sync = () => { const r = REPORTS[f.report.value]; $('[data-role=range]', f).hidden = !r.range; $('[data-role=ref]', f).hidden = !r.ref; if (r.ref) f.ref.placeholder = r.ref; };
  f.report.onchange = sync; sync(); lastReport = null;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const r = REPORTS[f.report.value];
    const rules = {};
    if (r.range) { rules.from = v => validDate(v) ? '' : 'Choose a start date.'; rules.to = v => !validDate(v) ? 'Choose an end date.' : (validDate(f.from.value) && v < f.from.value) ? 'End date cannot be before start date.' : ''; }
    if (r.ref) rules.ref = v => v ? '' : 'Enter a reference.';
    if (!validate(f, rules)) return;
    await withBusy($('#runRep'), async () => {
      try {
        const out = await r.run(f.from.value, f.to.value, f.ref.value.trim());
        lastReport = { name: f.report.value, ...out }; $('#csvRep').disabled = false;
        const fmt = (c, v) => c.type === 'money' ? money(v) : c.type === 'date' ? fmtDate(v) : esc(v ?? '');
        $('#repOut').innerHTML = !out.rows.length ? empty('No records for this report.') : `<p class="muted">${out.rows.length} row${out.rows.length === 1 ? '' : 's'}</p><div class="table-wrap"><table class="tbl"><thead><tr>${out.cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${out.rows.map(row => `<tr>${out.cols.map(c => `<td>${fmt(c, row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      } catch (err) { $('#repOut').innerHTML = `<p class="error-text">${esc(friendlyError(err))}</p>`; }
    });
  });
  $('#csvRep').onclick = () => { if (lastReport) downloadCSV(`${lastReport.name}-${todayIn()}.csv`, lastReport.cols, lastReport.rows); };
}

/* ================= SETTINGS ================= */
async function pageSettings() {
  const { data: s, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  let zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['Asia/Kolkata', 'UTC']; }
  if (!zones.includes(s.timezone)) zones.push(s.timezone);
  content.innerHTML = `<div class="page-head"><h1>Settings</h1></div>
    <div class="card"><h2>Billing policy</h2><div class="warn">Changes apply only to <b>new</b> rentals. Existing rentals keep the policy they were created with.</div>
    <form id="setForm" novalidate>
      ${fieldHtml('Business name', 'business_name', `<input name="business_name" maxlength="80" value="${esc(s.business_name)}">`)}
      ${fieldHtml('Business time zone', 'timezone', `<select name="timezone">${zones.map(z => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>`)}
      ${fieldHtml('Day-counting rule', 'billing_mode', `<select name="billing_mode"><option value="date_diff" ${s.billing_mode === 'date_diff' ? 'selected' : ''}>Return day not charged (7 Oct → 10 Oct = 3 days)</option><option value="inclusive" ${s.billing_mode === 'inclusive' ? 'selected' : ''}>Both days charged (7 Oct → 10 Oct = 4 days)</option></select>`)}
      ${fieldHtml('Minimum chargeable days', 'minimum_days', `<input name="minimum_days" type="number" min="0" max="30" step="1" value="${s.minimum_days}">`)}
      <label class="check field"><input type="checkbox" name="allow_overpayment" ${s.allow_overpayment ? 'checked' : ''}><span>Allow payments larger than the current outstanding balance (advance payments)</span></label>
      <button class="btn btn-primary">SAVE SETTINGS</button></form></div>
    <div class="card"><h2>Account</h2><button class="btn btn-light" id="chgPw">Change password</button></div>`;
  $('#chgPw').onclick = () => openNewPassword(false);
  const f = $('#setForm');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(f, {
      business_name: v => !v ? 'Business name is required.' : '',
      minimum_days: v => !/^\d+$/.test(v) || Number(v) > 30 ? 'Enter a whole number between 0 and 30.' : ''
    })) return;
    await withBusy($('button.btn-primary', f), async () => {
      try {
        const { error: er } = await sb.from('app_settings').update({ business_name: f.business_name.value.trim(), timezone: f.timezone.value, billing_mode: f.billing_mode.value,
          minimum_days: Number(f.minimum_days.value), allow_overpayment: f.allow_overpayment.checked }).eq('id', 1);
        if (er) throw er; setTz(f.timezone.value); toast('Settings saved.', 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });
}

boot();

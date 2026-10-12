/* ===== Shared helpers (admin + customer) ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let BUSINESS_TZ = 'Asia/Kolkata';
const setTz = t => { BUSINESS_TZ = t || 'Asia/Kolkata'; };
const cfg = window.APP_CONFIG || {};
const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/YOUR-PROJECT|YOUR-ANON/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));

function makeClient(persist) {
  return window.supabase.createClient(
    configured ? cfg.SUPABASE_URL : 'https://placeholder.supabase.co',
    configured ? cfg.SUPABASE_ANON_KEY : 'placeholder',
    { auth: { persistSession: persist, autoRefreshToken: persist, detectSessionInUrl: persist } }
  );
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const cleanQ = q => String(q || '').replace(/[%,()*\\"']/g, ' ').trim();

/* ---------- formatting ---------- */
const _inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = n => _inr.format(Number(n || 0));
const todayIn = (tz = BUSINESS_TZ) => new Date().toLocaleDateString('en-CA', { timeZone: tz });
const dateIn = (iso, tz = BUSINESS_TZ) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ });
}
const addDays = (ds, n) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 864e5).toISOString().slice(0, 10); };
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const badge = (t, tone) => `<span class="badge ${tone}">${esc(t)}</span>`;
const spinnerHtml = '<span class="spinner"></span>';
const loading = () => '<div class="center-pad"><span class="spinner big"></span></div>';
const empty = t => `<div class="empty">${esc(t)}</div>`;
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="100%" height="100%" fill="#e9edf5"/><text x="50%" y="50%" fill="#9aa5b8" font-family="sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">No image</text></svg>');

const fmtHour = h => { h = Number(h); return `${((h + 11) % 12) + 1}:00 ${h >= 12 ? 'PM' : 'AM'}`; };
function policyText(p) {
  p = p || {};
  const open = p.opening_hour ?? 9, close = p.closing_hour ?? 21;
  return `Shop hours ${fmtHour(open)} – ${fmtHour(close)}. Items must be returned by ${fmtHour(close)} on the given date. If not, another day's rent is added after ${fmtHour(close)} each day. Time zone: ${p.timezone || 'Asia/Kolkata'}.`;
}

/* ---------- errors ---------- */
function friendlyError(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || '');
  if (!navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(m))
    return 'Cannot reach the server. Check your internet connection and try again. Your entries have been kept.';
  if (/jwt expired|invalid jwt|jwt/i.test(m)) return 'Your session has expired. Please log in again.';
  if (/row-level security|permission denied/i.test(m)) return 'You are not authorised to do this.';
  if (/one_active_rental_per_item/i.test(m)) return 'This item is already assigned to an active rental.';
  if (/duplicate key|unique constraint/i.test(m)) return 'This record already exists.';
  if (/violates check constraint/i.test(m)) return 'Some values are not valid. Please review the form.';
  if (/violates foreign key/i.test(m)) return 'A related record no longer exists. Please refresh and try again.';
  return m || 'Something went wrong. Please try again.';
}

/* ---------- toast / modal ---------- */
function toast(msg, type = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 3500);
}

const modalStack = [];
function openModal(title, html, { wide = false } = {}) {
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Close">×</button></div><div class="modal-body">${html}</div></div>`;
  document.body.appendChild(el);
  document.body.classList.add('modal-open');
  const api = { el, body: $('.modal-body', el), close() { el.remove(); const i = modalStack.indexOf(api); if (i > -1) modalStack.splice(i, 1); if (!modalStack.length) document.body.classList.remove('modal-open'); } };
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); }); // backdrop click does NOT close (avoids losing typed data)
  modalStack.push(api);
  return api;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close(); });

function confirmDialog(message, okLabel = 'Confirm', danger = false) {
  return new Promise(res => {
    const m = openModal('Please confirm', `<p>${esc(message)}</p><div class="actions"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okLabel)}</button><button class="btn btn-light" data-no>Cancel</button></div>`);
    m.el.addEventListener('click', e => {
      if (e.target.closest('[data-ok]')) { m.close(); res(true); }
      else if (e.target.closest('[data-no],[data-close]')) { m.close(); res(false); }
    });
  });
}

function promptDialog({ title, label, okLabel = 'Submit', minLen = 5 }) {
  return new Promise(res => {
    const m = openModal(title, `<form novalidate>${fieldHtml(label, 'text', '<textarea name="text" rows="3" maxlength="300"></textarea>')}<div class="actions"><button class="btn btn-danger">${esc(okLabel)}</button><button type="button" class="btn btn-light" data-no>Cancel</button></div></form>`);
    const f = $('form', m.body);
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (!validate(f, { text: v => v.length < minLen ? `Please enter at least ${minLen} characters.` : '' })) return;
      m.close(); res(f.text.value.trim());
    });
    m.el.addEventListener('click', e => { if (e.target.closest('[data-no],[data-close]')) { m.close(); res(null); } });
  });
}

async function withBusy(btn, fn) {
  if (!btn || btn.disabled) return;
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = spinnerHtml + ' Please wait…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

/* ---------- forms / validation ---------- */
const fieldHtml = (label, name, control) =>
  `<div class="field"><label>${label}</label>${control}<small class="field-error" data-error-for="${name}"></small></div>`;

function clearErrors(form) {
  $$('.field-error', form).forEach(e => e.textContent = '');
  $$('.invalid', form).forEach(e => e.classList.remove('invalid'));
}
function setError(form, name, msg) {
  const el = form.elements[name];
  if (el && el.classList) el.classList.add('invalid');
  const s = form.querySelector(`[data-error-for="${name}"]`);
  if (s) s.textContent = msg;
}
function validate(form, rules) {
  clearErrors(form);
  let first = null;
  for (const [name, fn] of Object.entries(rules)) {
    const el = form.elements[name];
    if (!el) continue;
    const msg = fn(String(el.value ?? '').trim(), el);
    if (msg) { setError(form, name, msg); first = first || el; }
  }
  if (first) { first.focus && first.focus(); toast('Please fix the highlighted fields.', 'error'); }
  return !first;
}
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00Z'));
const normalizePhone = v => String(v || '').replace(/[\s\-()]/g, '').replace(/^(\+91|91|0)(?=[6-9]\d{9}$)/, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\s.'\-]{1,99}$/u;
const PHONE_RE = /^[6-9]\d{9}$/;

/* ---------- images ---------- */
async function compressImage(file, maxSide = 1024, quality = 0.8) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('This image could not be read. Please choose another photo.'); }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Image compression failed.')), 'image/jpeg', quality));
}

function photoPickerHtml(name) {
  return `<div class="photo-picker" data-picker="${name}">
    <div class="photo-preview"><img alt="Preview" hidden><span class="ph">No photo</span></div>
    <div class="photo-actions">
      <label class="btn btn-light btn-sm">Gallery<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="gallery"></label>
      <label class="btn btn-light btn-sm">Camera<input type="file" accept="image/*" capture="environment" hidden data-role="camera"></label>
      <button type="button" class="btn btn-ghost btn-sm" data-role="remove" hidden>Remove</button>
    </div>
    <small class="field-error" data-error-for="${name}"></small></div>`;
}
function bindPhotoPicker(form, name, existingUrl = '') {
  const root = form.querySelector(`[data-picker="${name}"]`);
  const img = $('img', root), ph = $('.ph', root), rm = $('[data-role=remove]', root), err = $('.field-error', root);
  let file = null;
  const show = url => { img.src = url || ''; img.hidden = !url; ph.hidden = !!url; rm.hidden = !file; };
  if (existingUrl) show(existingUrl);
  $$('input[type=file]', root).forEach(inp => inp.addEventListener('change', () => {
    const f = inp.files[0]; inp.value = ''; err.textContent = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) && !/^image\//.test(f.type)) { err.textContent = 'Please choose an image file (JPG, PNG or WebP).'; return; }
    if (f.size > 12 * 1024 * 1024) { err.textContent = 'This photo is larger than 12 MB. Please choose a smaller one.'; return; }
    file = f; show(URL.createObjectURL(f));
  }));
  rm.addEventListener('click', () => { file = null; show(existingUrl); });
  return { file: () => file };
}

/* ---------- misc ---------- */
function pagerHtml(page, total, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  return `<div class="pager"><span>${total} record${total === 1 ? '' : 's'}</span><div>
    <button class="btn btn-light btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Prev</button>
    <span>Page ${page} / ${pages}</span>
    <button class="btn btn-light btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button></div></div>`;
}
function downloadCSV(filename, columns, rows) {
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [columns.map(c => q(c.label)).join(','), ...rows.map(r => columns.map(c => q(r[c.key])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

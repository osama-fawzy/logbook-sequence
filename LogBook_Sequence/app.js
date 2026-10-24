'use strict';

/* ==========================================================================
   Logbook Sequence - standalone app (no server, no database)
   - Name + mobile are registered once and kept on the phone.
   - The form is turned into a one-page PDF on the phone itself.
   - The PDF is handed to the WhatsApp share sheet (user picks the group).
   ========================================================================== */

/* ------------------------------ CONFIG ---------------------------------- */
const GROUP_NAME = 'Logbook_Sequence';
const AIRCRAFT = [
  'SU-BPX', 'SU-BTM', 'SU-BUJ', 'SU-BUK', 'SU-BUL', 'SU-BUM', 'SU-BUN',
  'SU-BUP', 'SU-BUQ', 'SU-BUR', 'SU-BUS', 'SU-BUT', 'SU-BUU', 'SU-BUV',
  'SU-BUX', 'SU-BUY', 'SU-BUZ', 'SU-BVA', 'SU-BVB', 'SU-BVC', 'SU-BVD',
  'SU-BVE', 'SU-BVF', 'SU-BVG', 'SU-BVH', 'SU-BVI', 'SU-BVJ', 'SU-BVK',
  'SU-BVL', 'SU-BVM', 'SU-BVN', 'SU-BVO', 'SU-BVP', 'SU-BVQ', 'SU-BWB',
  'SU-BWC', 'SU-BWD', 'SU-BWE', 'SU-BWF', 'SU-BWM', 'SU-BWN', 'SU-BWO',
];
const BOOK_TYPES = ['TLB', 'ADDL', 'CDL', 'CDDL'];
const STATUSES = ['ON', 'OFF'];
const DESTINATIONS = ['Record', 'MOCC', 'Cairo', 'HRG', 'SSH', 'HMB', 'ATZ', 'RMF', 'ASW'];
const HO_STATUSES = ['New', 'Used'];
const HISTORY_LIMIT = 30;
const FONT = 'system-ui, "Segoe UI", Tahoma, Arial, sans-serif';

const LS_USER = 'lb_user';
const LS_HISTORY = 'lb_history';

/* ------------------------------ helpers --------------------------------- */
const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}

const pad = (n) => String(n).padStart(2, '0');

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function makeRef(d) {
  return `LB-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizePhone(raw) {
  let s = String(raw || '')
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660)
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06F0)
    .replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    return /^\d{8,15}$/.test(digits) ? '+' + digits : null;
  }
  if (/^\d+$/.test(s)) {
    if (s.length === 11 && s.startsWith('01')) return '+20' + s.slice(1);   // 01012345678
    if (s.length === 12 && s.startsWith('201')) return '+' + s;             // 201012345678
  }
  return null;
}

function showErrors(boxId, errors) {
  const box = $(boxId);
  box.textContent = '';
  errors.forEach((msg) => {
    const p = document.createElement('p');
    p.textContent = msg;
    box.appendChild(p);
  });
  box.hidden = errors.length === 0;
}

function getUser() { return load(LS_USER, null); }

function fileName(entry) { return `${GROUP_NAME}_${entry.ref}.pdf`; }

function shareText(entry) {
  return `${GROUP_NAME}\n` +
         `A/C: ${entry.ac} | ${entry.book} | S/N ${entry.snFrom} - ${entry.snTo} | ${entry.status}\n` +
         `Date: ${entry.date}\n` +
         `By: ${entry.name}\n` +
         `Mobile: ${entry.phone}\n` +
         `Ref: ${entry.ref}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/* ------------------------------ PDF ------------------------------------- */
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* One A4 page drawn on a canvas (A4 at 150 dpi). The browser shapes Arabic
   text correctly, so names typed in Arabic come out right in the PDF. */
function drawReport(entry) {
  const W = 1240, H = 1754, M = 110;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textBaseline = 'alphabetic';

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  // header band
  g.fillStyle = '#0b3d62';
  g.fillRect(0, 0, W, 260);
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.font = `bold 58px ${FONT}`;
  g.fillText('Book Serial Number Entry', M, 120);
  g.font = `28px ${FONT}`;
  g.fillText(`${GROUP_NAME}  |  Ref ${entry.ref}`, M, 180, W - 2 * M - 300);

  // status badge
  const on = entry.status === 'ON';
  g.fillStyle = on ? '#1b8a3a' : '#b3261e';
  roundRect(g, W - M - 250, 62, 250, 104, 22);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = `bold 54px ${FONT}`;
  g.fillText(entry.status, W - M - 125, 138);

  // table
  const rows = [
    ['Date', entry.date],
    ['A/C', entry.ac],
    ['Book Type', entry.book],
    ['S/N From', entry.snFrom],
    ['S/N To', entry.snTo],
    ['Status', entry.status],
  ];
  const top = 340, rowH = 110, labelW = 420, tableW = W - 2 * M;
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    g.fillStyle = i % 2 === 0 ? '#f2f6fa' : '#ffffff';
    g.fillRect(M, y, tableW, rowH);
    g.strokeStyle = '#d5dde5';
    g.lineWidth = 2;
    g.strokeRect(M, y, tableW, rowH);
    g.beginPath();
    g.moveTo(M + labelW, y);
    g.lineTo(M + labelW, y + rowH);
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = '#0b3d62';
    g.font = `bold 34px ${FONT}`;
    g.fillText(row[0], M + 28, y + 68);
    g.fillStyle = '#000000';
    g.font = `38px ${FONT}`;
    g.fillText(String(row[1]), M + labelW + 36, y + 68, tableW - labelW - 72);
  });

  // submitted by
  let y = top + rows.length * rowH + 110;
  const lines = [
    ['Submitted by:', entry.name, true],
    ['Mobile:', entry.phone, false],
    ['Submitted at:', fmtDateTime(entry.createdAt), false],
  ];
  lines.forEach((ln) => {
    g.textAlign = 'left';
    g.fillStyle = '#555555';
    g.font = `30px ${FONT}`;
    g.fillText(ln[0], M, y);
    g.fillStyle = '#000000';
    g.font = `${ln[2] ? 'bold 38px' : '32px'} ${FONT}`;
    g.fillText(ln[1], M + 270, y, W - M - (M + 270));
    y += 70;
  });

  // footer
  g.strokeStyle = '#d5dde5';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(M, H - 150);
  g.lineTo(W - M, H - 150);
  g.stroke();
  g.fillStyle = '#888888';
  g.textAlign = 'left';
  g.font = `24px ${FONT}`;
  g.fillText(`Generated by Logbook Sequence app - ${GROUP_NAME}`, M, H - 105);

  return c;
}

/* Wrap the canvas (as a JPEG) into a minimal one-page A4 PDF. No libraries. */
function canvasToPdf(canvas, entry) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const bin = atob(dataUrl.split(',')[1]);
  const jpeg = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);

  const PW = 595.28, PH = 841.89;               // A4 in points
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = (u8) => { parts.push(u8); pos += u8.length; };
  const str = (s) => push(enc.encode(s));
  const obj = (n) => { offsets[n] = pos; };

  str('%PDF-1.4\n');
  obj(1); str('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2); str('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  obj(3); str(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
              '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  obj(4);
  str(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  str('\nendstream\nendobj\n');
  const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
  obj(5); str(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  obj(6); str(`6 0 obj\n<< /Title (${GROUP_NAME} ${entry.ref}) /Creator (Logbook Sequence app) >>\nendobj\n`);

  const xrefPos = pos;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let n = 1; n <= 6; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  str(xref);
  str(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}

function buildPdf(entry) { return canvasToPdf(drawReport(entry), entry); }

/* ------------------------------ sharing --------------------------------- */
function setDoneMessage(html) { $('done-msg').innerHTML = html; }

async function doShare(entry, pdf) {
  const file = new File([pdf], fileName(entry), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: entry.ref, text: shareText(entry) });
      setDoneMessage('Shared. If you did not send it to <b>' + GROUP_NAME + '</b>, press the green button again.');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        setDoneMessage('Not sent yet. Press the green button to share to <b>' + GROUP_NAME + '</b>.');
        return;
      }
    }
  }
  setDoneMessage('This browser cannot share files directly. Press <b>Download PDF</b> and send it to <b>' + GROUP_NAME +
                 '</b> from WhatsApp, or send the details as text.');
}

function sendAsText(entry) {
  window.open('https://wa.me/?text=' + encodeURIComponent(shareText(entry)), '_blank', 'noopener');
}

/* ------------------------------ screens --------------------------------- */
const SCREENS = ['register', 'form', 'done', 'history', 'handover', 'receive'];
let lastEntry = null;
let lastPdf = null;

function show(name) {
  SCREENS.forEach((s) => { $('screen-' + s).hidden = (s !== name); });
  const u = getUser();
  $('who').hidden = !u;
  $('nav').hidden = !u;
  if (u) {
    const box = $('who-name');
    box.textContent = '';
    box.append(isolated(u.name, 'auto'), ' · ', isolated(u.phone, 'ltr'));
  }
  window.scrollTo(0, 0);
}

/* Name (maybe Arabic) and phone (+20...) side by side without the bidi
   algorithm moving the "+" to the wrong end. */
function isolated(text, dir) {
  const el = document.createElement('bdi');
  el.dir = dir;
  el.textContent = text;
  return el;
}

function startRegister() {
  const u = getUser();
  $('reg-name').value = u ? u.name : '';
  $('reg-phone').value = u ? u.phone : '';
  showErrors('reg-errors', []);
  show('register');
}

function startForm() {
  const u = getUser();
  if (!u) { startRegister(); return; }
  $('me-name').textContent = u.name;
  $('me-phone').textContent = u.phone;
  $('f-date').value = todayLocal();
  $('f-ac').value = '';
  $('f-book').value = '';
  $('f-from').value = '';
  $('f-to').value = '';
  document.querySelectorAll('input[name=status]').forEach((r) => { r.checked = false; });
  showErrors('form-errors', []);
  show('form');
}

function renderDone(entry) {
  const dl = $('done-details');
  dl.textContent = '';
  const add = (k, v, pill) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd');
    if (pill) {
      const s = document.createElement('span');
      s.className = 'pill ' + v; s.textContent = v; dd.appendChild(s);
    } else dd.textContent = v;
    dl.appendChild(dt); dl.appendChild(dd);
  };
  add('Reference', entry.ref);
  {
    const dt = document.createElement('dt'); dt.textContent = 'User';
    const dd = document.createElement('dd');
    dd.append(isolated(entry.name, 'auto'), document.createElement('br'), isolated(entry.phone, 'ltr'));
    dl.appendChild(dt); dl.appendChild(dd);
  }
  add('Date', entry.date);
  add('A/C', entry.ac);
  add('Book Type', entry.book);
  add('S/N', `${entry.snFrom} → ${entry.snTo}`);
  add('Status', entry.status, true);
  setDoneMessage('Choose the group <b>' + GROUP_NAME + '</b> in the share list and press send.');
}

function renderHistory() {
  const list = $('hist-list');
  list.textContent = '';
  const items = load(LS_HISTORY, []);
  if (!items.length) {
    const p = document.createElement('p');
    p.textContent = 'No entries yet.';
    list.appendChild(p);
    return;
  }
  items.forEach((entry) => {
    const div = document.createElement('div');
    div.className = 'hist';
    const b = document.createElement('b');
    b.textContent = `${entry.ac} · ${entry.book} · S/N ${entry.snFrom}→${entry.snTo} · ${entry.status}`;
    const sm = document.createElement('small');
    sm.textContent = `${entry.date} · ${entry.ref}`;
    const bShare = document.createElement('button');
    bShare.type = 'button'; bShare.className = 'btn small wa'; bShare.textContent = 'Share';
    bShare.addEventListener('click', () => doShareFromHistory(entry));
    const bPdf = document.createElement('button');
    bPdf.type = 'button'; bPdf.className = 'btn small alt'; bPdf.textContent = 'PDF';
    bPdf.addEventListener('click', () => downloadBlob(buildPdf(entry), fileName(entry)));
    div.append(b, sm, bShare, bPdf);
    list.appendChild(div);
  });
}

function doShareFromHistory(entry) {
  const pdf = buildPdf(entry);
  lastEntry = entry; lastPdf = pdf;
  renderDone(entry);
  show('done');
  doShare(entry, pdf);
}

function addHistory(entry) {
  const items = load(LS_HISTORY, []);
  items.unshift(entry);
  save(LS_HISTORY, items.slice(0, HISTORY_LIMIT));
}

/* ------------------------------ validation ------------------------------ */
function validateEntry(d) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || isNaN(new Date(d.date).getTime())) {
    errors.push('Date is invalid');
  }
  if (!AIRCRAFT.includes(d.ac)) errors.push('Choose an A/C');
  if (!BOOK_TYPES.includes(d.book)) errors.push('Choose a book type');
  if (!d.snFrom || !d.snTo) {
    errors.push('S/N From and S/N To are required');
  } else if (/^\d+$/.test(d.snFrom) && /^\d+$/.test(d.snTo) && BigInt(d.snTo) < BigInt(d.snFrom)) {
    errors.push('S/N To must be greater than or equal to S/N From');
  }
  if (!STATUSES.includes(d.status)) errors.push('Choose ON or OFF');
  return errors;
}

/* ------------------------------ wiring ---------------------------------- */
function fillSelect(sel, values) {
  const first = document.createElement('option');
  first.value = ''; first.textContent = 'Select...';
  sel.appendChild(first);
  values.forEach((v) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}


/* ------------------------------ handover -------------------------------- */
/* State of the list being built. Once the first range is added the A/C and
   book type are locked until the list is sent (or cancelled). */
let ho = { ranges: [], sent: false, status: '', dest: '' };
let incoming = null;                    // list opened from a WhatsApp link

function b64enc(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64dec(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(b, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function snCompareBad(a, b) {
  return /^\d+$/.test(a) && /^\d+$/.test(b) && BigInt(b) < BigInt(a);
}

function setHoLocked() {
  const locked = ho.ranges.length > 0 || ho.sent;
  $('h-book').disabled = locked;
  $('h-ac').disabled = locked;
  const lock = $('ho-lock');
  if (ho.sent) {
    lock.hidden = false;
    lock.textContent = 'List sent. Press "Create New List" to start another list.';
  } else if (locked) {
    lock.hidden = false;
    lock.textContent = 'Book type is locked to ' + $('h-book').value + ' until this list is sent.';
  } else lock.hidden = true;
  ['h-date', 'h-from', 'h-to'].forEach((id) => { $(id).disabled = ho.sent; });
  $('ho-add').disabled = ho.sent;
  $('ho-status').disabled = ho.sent;
  $('ho-send').disabled = ho.sent;
}

function renderHoList() {
  const box = $('ho-list');
  box.textContent = '';
  if (ho.ranges.length) {
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = 'List (' + $('h-book').value + ')';
    box.appendChild(t);
    let total = 0;
    ho.ranges.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'horow';
      const sp = document.createElement('span');
      sp.textContent = r[0] + ' → ' + r[1];
      row.appendChild(sp);
      if (!ho.sent) {
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'x'; x.textContent = '✕';
        x.setAttribute('aria-label', 'Remove');
        x.addEventListener('click', () => { ho.ranges.splice(i, 1); renderHoList(); setHoLocked(); });
        row.appendChild(x);
      }
      box.appendChild(row);
      if (/^\d+$/.test(r[0]) && /^\d+$/.test(r[1])) total += Number(BigInt(r[1]) - BigInt(r[0])) + 1;
    });
    if (total) {
      const tt = document.createElement('div');
      tt.className = 'total'; tt.textContent = 'Total: ' + total;
      box.appendChild(tt);
    }
  }
  setHoLocked();
}

function startHandover() {
  const u = getUser();
  if (!u) { startRegister(); return; }
  ho = { ranges: [], sent: false, status: '', dest: '' };
  $('ho-me-name').textContent = u.name;
  $('ho-me-phone').textContent = u.phone;
  $('h-date').value = todayLocal();
  $('h-ac').value = '';
  $('h-book').value = '';
  $('h-from').value = '';
  $('h-to').value = '';
  setHoStatus('');
  showErrors('ho-errors', []);
  renderHoList();
  show('handover');
}

function setHoStatus(v) {
  ho.status = v;
  const b = $('ho-status');
  b.textContent = v || 'Select status';
  b.classList.toggle('empty', !v);
}

function hoCreateNew() {
  if (ho.ranges.length && !ho.sent &&
      !window.confirm('This list has not been sent. Discard it and start a new list?')) return;
  startHandover();
}

function hoCancel() {
  if (ho.ranges.length && !ho.sent &&
      !window.confirm('Cancel and discard this list?')) return;
  startForm();
}

function hoAdd() {
  const errors = [];
  const book = $('h-book').value, ac = $('h-ac').value;
  const from = $('h-from').value.trim(), to = $('h-to').value.trim();
  if (!AIRCRAFT.includes(ac)) errors.push('Choose an A/C');
  if (!BOOK_TYPES.includes(book)) errors.push('Choose a book type');
  if (!from || !to) errors.push('S/N From and S/N To are required');
  else if (snCompareBad(from, to)) errors.push('S/N To must be greater than or equal to S/N From');
  else if (ho.ranges.some((r) => r[0] === from && r[1] === to)) errors.push('This range is already in the list');
  showErrors('ho-errors', errors);
  if (errors.length) return;
  ho.ranges.push([from, to]);
  $('h-from').value = ''; $('h-to').value = '';
  renderHoList();
  $('h-from').focus();
}

/* Bottom sheet with one choice (radio-style). cb(value) runs on OK. */
function pickModal(title, options, current, cb) {
  let chosen = current || '';
  const wrap = $('modal-opts');
  wrap.textContent = '';
  $('modal-title').textContent = title;
  const btns = options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt'; b.textContent = o;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(o === chosen));
    b.addEventListener('click', () => {
      chosen = o;
      btns.forEach((x) => x.setAttribute('aria-checked', String(x.textContent === chosen)));
    });
    wrap.appendChild(b);
    return b;
  });
  const close = () => { $('modal').hidden = true; };
  $('modal-cancel').onclick = close;
  $('modal-ok').onclick = () => {
    if (!chosen) { window.alert('Please choose one option'); return; }
    close(); cb(chosen);
  };
  $('modal').hidden = false;
}

function appLink(payload) {
  return location.origin + location.pathname + '#ho=' + b64enc(payload);
}

function openWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

function hoSend() {
  const errors = [];
  if (!ho.ranges.length) errors.push('Add at least one serial range first');
  if (!ho.status) errors.push('Choose a status (New / Used)');
  showErrors('ho-errors', errors);
  if (errors.length) return;
  pickModal('Send to', DESTINATIONS, ho.dest, (dest) => {
    const u = getUser();
    const now = new Date();
    const payload = {
      ref: 'HO-' + makeRef(now).slice(3), date: $('h-date').value, ac: $('h-ac').value,
      book: $('h-book').value, status: ho.status, to: dest,
      ranges: ho.ranges, by: u.name, phone: u.phone,
    };
    ho.dest = dest;
    const lines = ranges2text(payload.ranges);
    const text = `${GROUP_NAME} - HANDOVER\n` +
      `To: ${dest}\nA/C: ${payload.ac} | ${payload.book} | ${payload.status}\n` +
      `Date: ${payload.date}\n${lines}\n` +
      `By: ${u.name}\nMobile: ${u.phone}\nRef: ${payload.ref}\n\n` +
      `Open to confirm receipt:\n${appLink(payload)}`;
    openWhatsApp(text);
    ho.sent = true;
    renderHoList();
  });
}

function ranges2text(ranges) {
  return 'S/N:\n' + ranges.map((r) => '  ' + r[0] + ' - ' + r[1]).join('\n');
}

/* ---- receiving side (link opened from WhatsApp) ---- */
function showReceive(p) {
  incoming = p;
  const dl = $('rc-details');
  dl.textContent = '';
  const add = (k, v, pill) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd');
    if (pill) { const s = document.createElement('span'); s.className = 'pill ' + v; s.textContent = v; dd.appendChild(s); }
    else dd.textContent = v;
    dl.append(dt, dd);
  };
  add('Reference', p.ref);
  add('From', p.by + ' · ' + p.phone);
  add('Sent to', p.to);
  add('Date', p.date);
  add('A/C', p.ac);
  add('Book Type', p.book);
  add('Status', p.status, true);
  const dt = document.createElement('dt'); dt.textContent = 'S/N';
  const dd = document.createElement('dd'); dd.className = 'pre';
  dd.textContent = p.ranges.map((r) => r[0] + ' → ' + r[1]).join('\n');
  dl.append(dt, dd);
  $('rc-msg').hidden = true;
  $('rc-confirm').disabled = false;
  showErrors('rc-errors', []);
  show('receive');
}

function rcConfirm() {
  if (!incoming) return;
  pickModal('Confirm Receive', DESTINATIONS, '', (who) => {
    const u = getUser();
    const p = incoming;
    const text = `${GROUP_NAME} - RECEIVED ✓\n` +
      `Received by: ${who}\n` +
      `A/C: ${p.ac} | ${p.book} | ${p.status}\n` +
      `${ranges2text(p.ranges)}\n` +
      `Sent by: ${p.by}\nRef: ${p.ref}\n` +
      `Confirmed by: ${u ? u.name : ''}\nAt: ${fmtDateTime(new Date().toISOString())}`;
    openWhatsApp(text);
    const m = $('rc-msg');
    m.hidden = false;
    m.textContent = 'Confirmation prepared for WhatsApp. Choose the group ' + GROUP_NAME + ' and press send.';
  });
}

function rcCancel() {
  incoming = null;
  history.replaceState(null, '', location.pathname + location.search);
  startForm();
}

/* Open the right screen at start-up / when the link hash changes. */
function route() {
  const u = getUser();
  if (!u) { startRegister(); return; }
  const m = /^#ho=(.+)$/.exec(location.hash);
  if (m) {
    try { showReceive(b64dec(m[1])); return; }
    catch (e) { history.replaceState(null, '', location.pathname + location.search); }
  }
  startForm();
}

function init() {
  fillSelect($('f-ac'), AIRCRAFT);
  fillSelect($('f-book'), BOOK_TYPES);
  fillSelect($('h-ac'), AIRCRAFT);
  fillSelect($('h-book'), BOOK_TYPES);
  STATUSES.forEach((s) => {
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'status'; input.id = 'st_' + s; input.value = s;
    const label = document.createElement('label');
    label.htmlFor = 'st_' + s; label.textContent = s;
    $('f-status').append(input, label);
  });

  $('reg-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('reg-name').value.trim().replace(/\s+/g, ' ');
    const phone = normalizePhone($('reg-phone').value);
    const errors = [];
    if (name.length < 2 || name.length > 100) errors.push('Enter your full name');
    if (!phone) errors.push('Invalid mobile number (example: 01012345678 or +201012345678)');
    showErrors('reg-errors', errors);
    if (errors.length) return;
    if (!save(LS_USER, { name, phone })) {
      showErrors('reg-errors', ['Could not save your details on this phone. Are you in private/incognito mode?']);
      return;
    }
    route();
  });

  $('entry-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const user = getUser();
    if (!user) { startRegister(); return; }
    const checked = document.querySelector('input[name=status]:checked');
    const data = {
      date: $('f-date').value,
      ac: $('f-ac').value,
      book: $('f-book').value,
      snFrom: $('f-from').value.trim(),
      snTo: $('f-to').value.trim(),
      status: checked ? checked.value : '',
    };
    const errors = validateEntry(data);
    showErrors('form-errors', errors);
    if (errors.length) return;

    const now = new Date();
    const entry = Object.assign(
      { ref: makeRef(now), createdAt: now.toISOString(), name: user.name, phone: user.phone }, data);
    let pdf;
    try { pdf = buildPdf(entry); }
    catch (e) { showErrors('form-errors', ['Could not create the PDF: ' + e.message]); return; }

    addHistory(entry);
    lastEntry = entry; lastPdf = pdf;
    renderDone(entry);
    show('done');
    doShare(entry, pdf);        // opens the WhatsApp share sheet right away
  });

  $('btn-share').addEventListener('click', () => { if (lastEntry) doShare(lastEntry, lastPdf); });
  $('btn-download').addEventListener('click', () => { if (lastEntry) downloadBlob(lastPdf, fileName(lastEntry)); });
  $('btn-text').addEventListener('click', () => { if (lastEntry) sendAsText(lastEntry); });
  $('btn-new').addEventListener('click', startForm);
  $('nav-new').addEventListener('click', startForm);
  $('nav-edit').addEventListener('click', startRegister);
  $('nav-history').addEventListener('click', () => { renderHistory(); show('history'); });

  $('nav-handover').addEventListener('click', startHandover);
  $('ho-new').addEventListener('click', hoCreateNew);
  $('ho-add').addEventListener('click', hoAdd);
  $('ho-cancel').addEventListener('click', hoCancel);
  $('ho-send').addEventListener('click', hoSend);
  $('ho-status').addEventListener('click', () => {
    pickModal('Status', HO_STATUSES, ho.status, setHoStatus);
  });
  $('ho-form').addEventListener('submit', (ev) => ev.preventDefault());
  $('rc-confirm').addEventListener('click', rcConfirm);
  $('rc-cancel').addEventListener('click', rcCancel);
  window.addEventListener('hashchange', route);

  route();
}

init();

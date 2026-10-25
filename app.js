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
const MAX_RANGES = 12;                      // S/N ranges allowed in one handover list
const HANDOVER_GROUP_NAME = GROUP_NAME;     // WhatsApp group shown in the on-screen hints
const HISTORY_LIMIT = 30;
const FONT = 'system-ui, "Segoe UI", Tahoma, Arial, sans-serif';

const LS_USER = 'lb_user';
const LS_HISTORY = 'lb_history';
const LS_HO_DRAFT = 'lb_ho_draft';
const LS_RECEIPTS = 'lb_receipts';

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
function makeRef(d, prefix = 'LB') {
  return `${prefix}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
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
  if (entry.kind === 'handover') return handoverShareText(entry);
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

/* Handover list: info cells + a table with one row per S/N range. */
function drawHandoverReport(entry) {
  const W = 1240, H = 1754, M = 110;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  // header band
  g.fillStyle = '#0b3d62';
  g.fillRect(0, 0, W, 240);
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.font = `bold 58px ${FONT}`;
  g.fillText('Handover List', M, 112);
  g.font = `28px ${FONT}`;
  g.fillText(`${HANDOVER_GROUP_NAME}  |  Ref ${entry.ref}`, M, 170, W - 2 * M - 300);

  // status badge (New / Used)
  g.fillStyle = entry.status === 'New' ? '#1b8a3a' : '#b26a00';
  roundRect(g, W - M - 250, 68, 250, 104, 22);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = `bold 54px ${FONT}`;
  g.fillText(entry.status.toUpperCase(), W - M - 125, 144);

  // info cells (2 columns x 3 rows)
  const total = totalQty(entry.items);
  const cells = [
    ['Date', entry.date],
    ['A/C', entry.ac],
    ['Book Type', entry.book],
    ['Status', entry.status],
    ['Send to', entry.to],
    [total !== null ? 'Total Qty' : 'Ranges', total !== null ? String(total) : String(entry.items.length)],
  ];
  const cw = (W - 2 * M) / 2, ch = 112, gy = 290;
  cells.forEach((cell, i) => {
    const x = M + (i % 2) * cw, row = Math.floor(i / 2), y = gy + row * ch;
    g.fillStyle = row % 2 === 0 ? '#f2f6fa' : '#ffffff';
    g.fillRect(x, y, cw, ch);
    g.strokeStyle = '#d5dde5';
    g.lineWidth = 2;
    g.strokeRect(x, y, cw, ch);
    g.textAlign = 'left';
    g.fillStyle = '#0b3d62';
    g.font = `bold 26px ${FONT}`;
    g.fillText(cell[0], x + 24, y + 40);
    g.fillStyle = '#000000';
    g.font = `bold 40px ${FONT}`;
    g.fillText(String(cell[1]), x + 24, y + 92, cw - 48);
  });

  // S/N ranges table
  const tableW = W - 2 * M, tTop = 680, hh = 62;
  const n = entry.items.length;
  const nRows = n + (total !== null ? 1 : 0);
  const rowH = Math.min(64, Math.floor(560 / Math.max(nRows, 1)));
  const fs = Math.max(24, Math.min(34, rowH - 16));
  const cols = [['#', 90], ['S/N From', 360], ['S/N To', 360], ['Qty', 210]];
  g.fillStyle = '#0b3d62';
  g.fillRect(M, tTop, tableW, hh);
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.font = `bold 30px ${FONT}`;
  let hx = M;
  cols.forEach((col) => { g.fillText(col[0], hx + 20, tTop + 42); hx += col[1]; });

  const drawRow = (i, vals, bold) => {
    const y = tTop + hh + i * rowH;
    g.fillStyle = i % 2 === 0 ? '#f2f6fa' : '#ffffff';
    g.fillRect(M, y, tableW, rowH);
    g.strokeStyle = '#d5dde5';
    g.lineWidth = 2;
    g.strokeRect(M, y, tableW, rowH);
    g.fillStyle = '#000000';
    g.font = `${bold ? 'bold ' : ''}${fs}px ${FONT}`;
    let cx = M;
    vals.forEach((v, k) => {
      g.fillText(v, cx + 20, y + rowH / 2 + fs * 0.35, cols[k][1] - 40);
      cx += cols[k][1];
    });
  };
  entry.items.forEach((r, i) => {
    const q = rangeQty(r);
    drawRow(i, [String(i + 1), r.from, r.to, q === null ? '-' : String(q)], false);
  });
  if (total !== null) drawRow(n, ['', 'Total', '', String(total)], true);

  // submitted by
  let y = tTop + hh + nRows * rowH + 90;
  [['Submitted by:', entry.name, true],
   ['Mobile:', entry.phone, false],
   ['Submitted at:', fmtDateTime(entry.createdAt), false]].forEach((ln) => {
    g.textAlign = 'left';
    g.fillStyle = '#555555';
    g.font = `30px ${FONT}`;
    g.fillText(ln[0], M, y);
    g.fillStyle = '#000000';
    g.font = `${ln[2] ? 'bold 38px' : '32px'} ${FONT}`;
    g.fillText(ln[1], M + 270, y, W - M - (M + 270));
    y += 58;
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
  g.fillText(`Generated by Logbook Sequence app - ${HANDOVER_GROUP_NAME}`, M, H - 105);
  return c;
}

function buildPdf(entry) {
  return canvasToPdf(entry.kind === 'handover' ? drawHandoverReport(entry) : drawReport(entry), entry);
}

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
  if (name !== 'receive' && name !== 'register') {
    pendingReceive = null;
    clearHash();
  }
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
  const isHo = entry.kind === 'handover';
  addRow(dl, 'Reference', entry.ref);
  addRow(dl, 'User', { name: entry.name, phone: entry.phone }, 'user');
  addRow(dl, 'Date', entry.date);
  addRow(dl, 'A/C', entry.ac);
  addRow(dl, 'Book Type', entry.book);
  if (isHo) {
    addRow(dl, 'Status', entry.status, 'pill');
    addRow(dl, 'Send to', entry.to);
    addRow(dl, 'S/N', rangesLines(entry.items), 'pre');
    const total = totalQty(entry.items);
    if (total !== null) addRow(dl, 'Total', String(total));
    setDoneMessage('Choose the group <b>' + HANDOVER_GROUP_NAME + '</b> in the share list and press send. ' +
      'The receiver opens the link in the message and presses <b>Confirm Receive</b>. ' +
      'If the link is missing under the PDF, press <b>Send details as text</b>.');
  } else {
    addRow(dl, 'S/N', `${entry.snFrom} → ${entry.snTo}`);
    addRow(dl, 'Status', entry.status, 'pill');
    setDoneMessage('Choose the group <b>' + GROUP_NAME + '</b> in the share list and press send.');
  }
  $('btn-new').textContent = isHo ? 'Create New List' : 'New entry';
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
    b.textContent = entry.kind === 'handover'
      ? `HANDOVER → ${entry.to} · ${entry.ac} · ${entry.book} · ${entry.status} · ${entry.items.length} range(s)`
      : `${entry.ac} · ${entry.book} · S/N ${entry.snFrom}→${entry.snTo} · ${entry.status}`;
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

/* ------------------------------ handover -------------------------------- */
let ho = emptyHo();            // the list being built (also kept in localStorage)
let pendingReceive = null;     // handover opened from a WhatsApp link

function emptyHo() { return { date: todayLocal(), ac: '', book: '', status: '', items: [] }; }
function drop(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
function clearHash() {
  try {
    if (location.hash.startsWith('#h=')) history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* ignore */ }
}

function addRow(dl, k, v, mode) {
  const dt = document.createElement('dt'); dt.textContent = k;
  const dd = document.createElement('dd');
  if (mode === 'pill') {
    const s = document.createElement('span');
    s.className = 'pill ' + v; s.textContent = v; dd.appendChild(s);
  } else if (mode === 'pre') {
    dd.className = 'pre'; dd.textContent = v;
  } else if (mode === 'user') {
    dd.append(isolated(v.name, 'auto'), document.createElement('br'), isolated(v.phone, 'ltr'));
  } else dd.textContent = v;
  dl.append(dt, dd);
}

/* ---- S/N helpers ---- */
const isNum = (s) => /^\d+$/.test(s);
function rangeQty(r) {
  if (!isNum(r.from) || !isNum(r.to)) return null;
  const q = BigInt(r.to) - BigInt(r.from) + 1n;
  return q < 1n ? null : q;
}
function totalQty(items) {
  let t = 0n;
  for (const r of items) {
    const q = rangeQty(r);
    if (q === null) return null;
    t += q;
  }
  return t;
}
function rangesText(items) {
  return items.map((r) => (r.from === r.to ? r.from : `${r.from} - ${r.to}`)).join(', ');
}
function rangesLines(items) {
  return items.map((r, i) => {
    const q = rangeQty(r);
    return `${i + 1}. ${r.from} → ${r.to}` + (q === null ? '' : `  (${q})`);
  }).join('\n');
}
function rangesOverlap(a, b) {
  if (isNum(a.from) && isNum(a.to) && isNum(b.from) && isNum(b.to)) {
    return BigInt(a.from) <= BigInt(b.to) && BigInt(b.from) <= BigInt(a.to);
  }
  return a.from === b.from && a.to === b.to;
}

/* ---- link that carries the list to the receiver (no server needed) ---- */
function b64uEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function handoverLink(entry) {
  const payload = {
    v: 1, id: entry.ref, d: entry.date, a: entry.ac, b: entry.book, s: entry.status, t: entry.to,
    i: entry.items.map((r) => [r.from, r.to]), n: entry.name, p: entry.phone, c: entry.createdAt,
  };
  return location.href.split('#')[0] + '#h=' + b64uEncode(JSON.stringify(payload));
}
/* The link comes from outside, so every field is checked before it is used. */
function decodeHandover(token) {
  try {
    const p = JSON.parse(b64uDecode(token));
    const str = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;
    if (!p || p.v !== 1) return null;
    if (!str(p.id, 40) || !/^[A-Za-z0-9_-]+$/.test(p.id)) return null;
    if (typeof p.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.d)) return null;
    if (!str(p.a, 20) || !BOOK_TYPES.includes(p.b) || !HO_STATUSES.includes(p.s) || !DESTINATIONS.includes(p.t)) return null;
    if (!Array.isArray(p.i) || !p.i.length || p.i.length > 50) return null;
    const items = [];
    for (const r of p.i) {
      if (!Array.isArray(r) || !str(r[0], 40) || !str(r[1], 40)) return null;
      items.push({ from: r[0], to: r[1] });
    }
    return {
      id: p.id, date: p.d, ac: p.a, book: p.b, status: p.s, to: p.t, items,
      name: typeof p.n === 'string' ? p.n.slice(0, 100) : '',
      phone: typeof p.p === 'string' ? p.p.slice(0, 20) : '',
      createdAt: typeof p.c === 'string' ? p.c.slice(0, 40) : '',
    };
  } catch (e) { return null; }
}

function handoverShareText(entry) {
  const total = totalQty(entry.items);
  return `${HANDOVER_GROUP_NAME} - HANDOVER\n` +
         `To: ${entry.to}\n` +
         `A/C: ${entry.ac} | ${entry.book} | ${entry.status}\n` +
         `S/N: ${rangesText(entry.items)}\n` +
         (total !== null ? `Qty: ${total}\n` : '') +
         `Date: ${entry.date}\n` +
         `By: ${entry.name}\n` +
         `Mobile: ${entry.phone}\n` +
         `Ref: ${entry.ref}\n` +
         `Receiver: open the link below and press Confirm Receive\n` +
         handoverLink(entry);
}

function receiptText(rec, dest, user, now) {
  const total = totalQty(rec.items);
  return `\u2705 ${HANDOVER_GROUP_NAME} - HANDOVER RECEIVED\n` +
         `Received by: ${dest}\n` +
         `Ref: ${rec.id}\n` +
         `A/C: ${rec.ac} | ${rec.book} | ${rec.status}\n` +
         `S/N: ${rangesText(rec.items)}\n` +
         (total !== null ? `Qty: ${total}\n` : '') +
         (dest !== rec.to ? `Originally sent to: ${rec.to}\n` : '') +
         (rec.name ? `Sent by: ${rec.name}\n` : '') +
         `Confirmed by: ${user.name} (${user.phone})\n` +
         `At: ${fmtDateTime(now.toISOString())}`;
}

/* ---- option picker (bottom sheet): Status, Send to, Confirm Receive ---- */
function openPicker(opts) {
  const modal = $('modal'), box = $('modal-opts'), ok = $('modal-ok'), cancel = $('modal-cancel');
  const opener = document.activeElement;
  let current = opts.selected || '';
  $('modal-title').textContent = opts.title;
  ok.textContent = opts.okText || 'OK';
  ok.hidden = !opts.needOk;
  ok.disabled = !current;
  box.textContent = '';

  function onKey(ev) { if (ev.key === 'Escape') close(); }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = '';
    ok.onclick = null; cancel.onclick = null; modal.onclick = null;
    document.removeEventListener('keydown', onKey);
    if (opener && typeof opener.focus === 'function') opener.focus();
  }
  // onChoose runs inside the click that confirmed the choice, so the browser
  // still treats it as a user action (needed to open the WhatsApp share sheet).
  function choose() {
    if (!current) return;
    const value = current;
    close();
    opts.onChoose(value);
  }

  const btns = opts.options.map((v) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt'; b.textContent = v;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', v === current ? 'true' : 'false');
    b.addEventListener('click', () => {
      current = v;
      btns.forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      ok.disabled = false;
      if (!opts.needOk) choose();
    });
    box.appendChild(b);
    return b;
  });
  ok.onclick = choose;
  cancel.onclick = close;
  modal.onclick = (ev) => { if (ev.target === modal) close(); };
  document.addEventListener('keydown', onKey);
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  (btns.find((b) => b.getAttribute('aria-checked') === 'true') || btns[0]).focus();
}

/* ---- handover list: build ---- */
function loadHoDraft() {
  const d = load(LS_HO_DRAFT, null);
  const e = emptyHo();
  if (!d || typeof d !== 'object') return e;
  if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) e.date = d.date;
  if (AIRCRAFT.includes(d.ac)) e.ac = d.ac;
  if (BOOK_TYPES.includes(d.book)) e.book = d.book;
  if (HO_STATUSES.includes(d.status)) e.status = d.status;
  if (Array.isArray(d.items)) {
    e.items = d.items
      .filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string')
      .map((r) => ({ from: r.from, to: r.to }))
      .slice(0, MAX_RANGES);
  }
  if (e.items.length && !e.book) e.items = [];      // inconsistent draft
  return e;
}

function readHoFields() {
  ho.date = $('h-date').value;
  ho.ac = $('h-ac').value;
  if (!ho.items.length) ho.book = $('h-book').value;   // locked once a range is added
}
function saveHoDraft() { readHoFields(); save(LS_HO_DRAFT, ho); }
function hoIsDirty() {
  readHoFields();
  return ho.items.length > 0 || !!ho.status || !!$('h-from').value.trim() || !!$('h-to').value.trim();
}

function renderHandover() {
  $('h-date').value = ho.date;
  $('h-ac').value = ho.ac;
  $('h-book').value = ho.book;
  const locked = ho.items.length > 0;
  $('h-book').disabled = locked;
  const lock = $('ho-lock');
  lock.hidden = !locked;
  lock.textContent = locked
    ? `Book type is locked to ${ho.book} until this list is sent. Add more S/N ranges of the same type.`
    : '';

  const sb = $('ho-status');
  sb.textContent = ho.status || 'Select status';
  sb.classList.toggle('empty', !ho.status);

  $('ho-add').disabled = ho.items.length >= MAX_RANGES;

  const list = $('ho-list');
  list.textContent = '';
  if (!ho.items.length) return;
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `List (${ho.items.length}/${MAX_RANGES})`;
  list.appendChild(title);
  ho.items.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'horow';
    const q = rangeQty(r);
    const t = document.createElement('span');
    t.textContent = `${i + 1}. ${r.from} → ${r.to}` + (q === null ? '' : `  (${q})`);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '\u2715';
    x.setAttribute('aria-label', 'Remove range ' + (i + 1));
    x.addEventListener('click', () => { ho.items.splice(i, 1); saveHoDraft(); renderHandover(); });
    row.append(t, x);
    list.appendChild(row);
  });
  const total = totalQty(ho.items);
  if (total !== null) {
    const tt = document.createElement('div');
    tt.className = 'total';
    tt.textContent = `Total: ${total}`;
    list.appendChild(tt);
  }
}

function startHandover(fresh) {
  const u = getUser();
  if (!u) { startRegister(); return; }
  if (!fresh && !$('screen-handover').hidden) return;      // already here: keep what is typed
  if (fresh) { ho = emptyHo(); drop(LS_HO_DRAFT); } else { ho = loadHoDraft(); }
  $('ho-me-name').textContent = u.name;
  $('ho-me-phone').textContent = u.phone;
  $('h-from').value = '';
  $('h-to').value = '';
  showErrors('ho-errors', []);
  renderHandover();
  show('handover');
}

function newList() {
  if (hoIsDirty() && !confirm('Start a new list? The current unsent list will be discarded.')) return;
  startHandover(true);
}
function cancelHandover() {
  if (hoIsDirty() && !confirm('Cancel this list? Everything added so far will be discarded.')) return;
  ho = emptyHo();
  drop(LS_HO_DRAFT);
  startForm();
}

function addRange() {
  readHoFields();
  const from = $('h-from').value.trim();
  const to = $('h-to').value.trim();
  const errors = [];
  if (!BOOK_TYPES.includes(ho.book)) errors.push('Choose a book type');
  if (!from || !to) {
    errors.push('S/N From and S/N To are required');
  } else {
    if (isNum(from) && isNum(to) && BigInt(to) < BigInt(from)) errors.push('S/N To must be greater than or equal to S/N From');
    if (ho.items.some((r) => rangesOverlap(r, { from, to }))) errors.push('This S/N range overlaps one already in the list');
  }
  if (ho.items.length >= MAX_RANGES) {
    errors.push(`A list holds at most ${MAX_RANGES} S/N ranges. Send this list, then press Create New List.`);
  }
  showErrors('ho-errors', errors);
  if (errors.length) return;
  ho.items.push({ from, to });
  $('h-from').value = '';
  $('h-to').value = '';
  saveHoDraft();
  renderHandover();
  $('h-from').focus();
}

function validateHandover() {
  readHoFields();
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ho.date) || isNaN(new Date(ho.date).getTime())) errors.push('Date is invalid');
  if (!AIRCRAFT.includes(ho.ac)) errors.push('Choose an A/C');
  if (!BOOK_TYPES.includes(ho.book)) errors.push('Choose a book type');
  if ($('h-from').value.trim() || $('h-to').value.trim()) {
    errors.push('Press Add to include the S/N range you typed (or clear the two boxes)');
  }
  if (!ho.items.length) errors.push('Add at least one S/N range');
  if (!HO_STATUSES.includes(ho.status)) errors.push('Choose a status (New or Used)');
  return errors;
}

function handoverSend() {
  const errors = validateHandover();
  showErrors('ho-errors', errors);
  if (errors.length) return;
  saveHoDraft();
  openPicker({ title: 'Send to', options: DESTINATIONS, selected: '', needOk: true, onChoose: finishHandover });
}

function finishHandover(dest) {
  const user = getUser();
  if (!user) { startRegister(); return; }
  const now = new Date();
  const entry = {
    kind: 'handover', ref: makeRef(now, 'HO'), createdAt: now.toISOString(),
    name: user.name, phone: user.phone,
    date: ho.date, ac: ho.ac, book: ho.book, status: ho.status, to: dest,
    items: ho.items.map((r) => ({ from: r.from, to: r.to })),
  };
  let pdf;
  try { pdf = buildPdf(entry); }
  catch (e) { showErrors('ho-errors', ['Could not create the PDF: ' + e.message]); return; }
  addHistory(entry);
  ho = emptyHo();                 // the list is sent: unlock the book type
  drop(LS_HO_DRAFT);
  lastEntry = entry; lastPdf = pdf;
  renderDone(entry);
  show('done');
  doShare(entry, pdf);            // opens the WhatsApp share sheet right away
}

/* ---- receiving side: opened from the link in the WhatsApp group ---- */
function routeHash() {
  const m = /^#h=([A-Za-z0-9_-]{8,6000})$/.exec(location.hash);
  if (!m) return false;
  const rec = decodeHandover(m[1]);
  if (!rec) { pendingReceive = null; renderReceive(null); show('receive'); return true; }
  pendingReceive = rec;
  if (!getUser()) { startRegister(); return true; }       // register first, then confirm
  showReceive(rec);
  return true;
}
function showReceive(rec) {
  pendingReceive = rec;
  renderReceive(rec);
  show('receive');
}
function afterRegister() {
  if (pendingReceive) showReceive(pendingReceive); else startForm();
}

function renderReceive(rec) {
  const dl = $('rc-details');
  dl.textContent = '';
  const msg = $('rc-msg');
  msg.hidden = true;
  if (!rec) {
    showErrors('rc-errors', ['This link is not a valid handover list. Ask the sender to send it again.']);
    $('rc-confirm').hidden = true;
    return;
  }
  showErrors('rc-errors', []);
  $('rc-confirm').hidden = false;
  addRow(dl, 'Reference', rec.id);
  if (rec.name) addRow(dl, 'Sent by', { name: rec.name, phone: rec.phone }, 'user');
  addRow(dl, 'Date', rec.date);
  addRow(dl, 'A/C', rec.ac);
  addRow(dl, 'Book Type', rec.book);
  addRow(dl, 'Status', rec.status, 'pill');
  addRow(dl, 'Sent to', rec.to);
  addRow(dl, 'S/N', rangesLines(rec.items), 'pre');
  const total = totalQty(rec.items);
  if (total !== null) addRow(dl, 'Total', String(total));
  const prev = load(LS_RECEIPTS, {})['r_' + rec.id];
  if (prev && prev.by) {
    msg.hidden = false;
    msg.textContent = `You already confirmed this list as ${prev.by} on ${fmtDateTime(prev.at)}.`;
  }
}

function startConfirm() {
  if (!pendingReceive) return;
  const rec = pendingReceive;
  openPicker({
    title: 'Received by', options: DESTINATIONS, selected: '', needOk: true,
    onChoose: (dest) => confirmReceive(rec, dest),
  });
}

function confirmReceive(rec, dest) {
  const user = getUser();
  if (!user) { startRegister(); return; }
  if (dest !== rec.to &&
      !confirm(`This list was sent to ${rec.to} but you chose ${dest}. Confirm receipt as ${dest}?`)) return;
  const now = new Date();
  const text = receiptText(rec, dest, user, now);
  const all = load(LS_RECEIPTS, {});
  all['r_' + rec.id] = { by: dest, at: now.toISOString() };
  const keys = Object.keys(all);
  if (keys.length > 50) delete all[keys[0]];
  save(LS_RECEIPTS, all);
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  const msg = $('rc-msg');
  msg.hidden = false;
  msg.innerHTML = 'Confirmation for <b>' + dest + '</b> is ready in WhatsApp. Choose the group <b>' +
                  HANDOVER_GROUP_NAME + '</b> and press send.';
}

function cancelReceive() {
  pendingReceive = null;
  clearHash();
  startForm();
}

function wireHandover() {
  fillSelect($('h-ac'), AIRCRAFT);
  fillSelect($('h-book'), BOOK_TYPES);
  $('nav-handover').addEventListener('click', () => startHandover(false));
  $('ho-new').addEventListener('click', newList);
  $('ho-add').addEventListener('click', addRange);
  $('h-to').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addRange(); } });
  $('ho-form').addEventListener('submit', (ev) => ev.preventDefault());
  $('ho-form').addEventListener('change', saveHoDraft);          // date, A/C, book type
  $('ho-status').addEventListener('click', () => {
    openPicker({
      title: 'Status', options: HO_STATUSES, selected: ho.status, needOk: false,
      onChoose: (v) => { ho.status = v; saveHoDraft(); renderHandover(); },
    });
  });
  $('ho-send').addEventListener('click', handoverSend);
  $('ho-cancel').addEventListener('click', cancelHandover);
  $('rc-confirm').addEventListener('click', startConfirm);
  $('rc-cancel').addEventListener('click', cancelReceive);
  window.addEventListener('hashchange', routeHash);
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

function init() {
  fillSelect($('f-ac'), AIRCRAFT);
  fillSelect($('f-book'), BOOK_TYPES);
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
    afterRegister();
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
  $('btn-new').addEventListener('click', () => {
    if (lastEntry && lastEntry.kind === 'handover') startHandover(true); else startForm();
  });
  $('nav-new').addEventListener('click', startForm);
  $('nav-edit').addEventListener('click', startRegister);
  $('nav-history').addEventListener('click', () => { renderHistory(); show('history'); });

  wireHandover();
  if (!routeHash()) { if (getUser()) startForm(); else startRegister(); }
}

init();

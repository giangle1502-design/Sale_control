import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { norm } from './utils';

// ============================================================================
// 1) So khớp mã hàng "nhập tự do" của khách với mã hàng trong danh mục
// 2) Chỉ mục khách hàng toàn công ty (customerIndex) để kiểm tra trùng khách giữa các sale
// ============================================================================

export const compact = (s) => norm(s).replace(/ /g, '');
const RESIN = /^(hdpe|lldpe|ldpe|pp|ps|abs|pet|pvc|eva|pc|pe|gpps|hips)/;
// Phần "lõi" của mã hàng: HDPE5502 → 5502, PP1102K → 1102k (giữ nguyên nếu bỏ tiền tố còn quá ngắn)
const codeCore = (c) => { const r = c.replace(RESIN, ''); return r.length >= 3 && r !== c ? r : ''; };
const hasDigit = (s) => /\d/.test(s);

// Khách c có đang dùng mã hàng sel không (so khớp mềm cho dữ liệu nhập tay)
export function usesCode(c, sel, splitCodes) {
  const s = compact(sel);
  if (!s) return false;
  const core = codeCore(s);
  const tokens = splitCodes(c.productsUsed).map(compact).filter(Boolean);
  const hit = tokens.some((t) => t === s || t.includes(s) || (core && hasDigit(core) && (t === core || t.includes(core)))
    || (t.length >= 4 && hasDigit(t) && s.includes(t)));
  if (hit) return true;
  const vol = compact(c.monthlyVolume);
  return !!vol && (vol.includes(s) || (core && hasDigit(core) && vol.includes(core)));
}

// ---------------------------------------------------------------------------
// Tên khách hàng: bỏ các từ loại hình doanh nghiệp để so phần tên riêng
const STOP = new Set(['cong', 'ty', 'cty', 'tnhh', 'co', 'phan', 'cp', 'mtv', 'sx', 'san', 'xuat', 'tm', 'thuong', 'mai', 'dv', 'dich', 'vu',
  'xnk', 'nhap', 'khau', 'jsc', 'ltd', 'company', 'corp', 'viet', 'nam', 'vn', 'kh', 'khach', 'hang', 'tap', 'doan', 'chi', 'nhanh', 'va', 'and',
  'ctcp', 'tnhhmtv', 'sxtm', 'tmdv', 'sxtmdv', 'hh', 'inc', 'group']);
export function coreTokens(name) {
  return norm(name).split(' ').filter((w) => w && !STOP.has(w));
}
const LEGAL = new Set(['cong', 'ty', 'cty', 'tnhh', 'co', 'phan', 'cp', 'ctcp', 'mtv', 'tap', 'doan', 'jsc', 'ltd', 'company', 'corp', 'nhua', 'bao', 'bi']);
const initials = (name) => norm(name).split(' ').filter((w) => w && !LEGAL.has(w)).map((w) => w[0]).join('');
const exactName = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Mức giống nhau: 'exact' (trùng tên/mã/MST) | 'similar' (gần giống) | ''
export function compareCustomer(a, b) {
  const ca = compact(a.code); const cb = compact(b.c ?? b.code);
  if (a.codeTyped && ca && cb && ca === cb) return { level: 'exact', why: 'trùng mã khách hàng' };
  const ta = compact(a.taxCode); const tb = compact(b.t ?? b.taxCode);
  if (ta && tb && ta.length >= 8 && ta === tb) return { level: 'exact', why: 'trùng mã số thuế' };
  const na = norm(a.name); const nb = norm(b.n ?? b.name);
  if (!na || !nb) return { level: '' };
  if (exactName(a.name) === exactName(b.n ?? b.name)) return { level: 'exact', why: 'trùng tên' };
  if (na === nb) return { level: 'similar', why: 'cùng tên, chỉ khác dấu / cách viết' };
  const xa = coreTokens(a.name); const xb = coreTokens(b.n ?? b.name);
  const ja = xa.join(''); const jb = xb.join('');
  if (!ja || !jb) return { level: '' };
  if (ja === jb) return { level: 'similar', why: 'tên riêng giống nhau' };
  if (Math.min(ja.length, jb.length) >= 5 && (ja.includes(jb) || jb.includes(ja))) return { level: 'similar', why: 'tên này nằm trong tên kia' };
  const sa = new Set(xa); const sb = new Set(xb);
  const inter = [...sa].filter((w) => sb.has(w)).length;
  const uni = new Set([...sa, ...sb]).size;
  if (inter >= 2 && inter / uni >= 0.6) return { level: 'similar', why: 'phần lớn các chữ giống nhau' };
  const ia = initials(a.name); const ib = initials(b.n ?? b.name);
  const ra = compact(a.name); const rb = compact(b.n ?? b.name);
  if (ia.length >= 3 && (ia === rb || ia === jb)) return { level: 'similar', why: 'tên viết tắt' };
  if (ib.length >= 3 && (ib === ra || ib === ja)) return { level: 'similar', why: 'tên viết tắt' };
  return { level: '' };
}

// ---------------------------------------------------------------------------
// Chỉ mục khách hàng: customerIndex/{customerId} = { n: tên, c: mã, t: MST, o: email sale }
export const indexEntry = (c) => ({ n: c.name || '', c: c.code || '', t: c.taxCode || '', o: c.ownerEmail || '' });
export const writeIndex = (id, c) => setDoc(doc(db, 'customerIndex', id), indexEntry(c)).catch(() => {});
export const removeIndex = (id) => deleteDoc(doc(db, 'customerIndex', id)).catch(() => {});
export async function loadIndex() {
  const s = await getDocs(collection(db, 'customerIndex'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
// Admin: đồng bộ chỉ mục với toàn bộ danh sách khách (thêm/sửa/xóa phần lệch)
export async function syncIndex(customers) {
  const idx = await loadIndex();
  const byId = new Map(idx.map((x) => [x.id, x]));
  const live = new Set(customers.map((c) => c.id));
  const ops = [];
  customers.forEach((c) => {
    const e = indexEntry(c); const o = byId.get(c.id);
    if (!o || o.n !== e.n || o.c !== e.c || o.t !== e.t || o.o !== e.o) ops.push(['set', c.id, e]);
  });
  idx.forEach((x) => { if (!live.has(x.id)) ops.push(['del', x.id]); });
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(([t, id, e]) => (t === 'set' ? b.set(doc(db, 'customerIndex', id), e) : b.delete(doc(db, 'customerIndex', id))));
    await b.commit();
  }
  return ops.length;
}

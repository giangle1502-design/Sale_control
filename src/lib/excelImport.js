import * as XLSX from 'xlsx';
import { norm } from './utils';

// Đọc sheet đầu tiên (hoặc sheet được chọn) thành mảng các dòng (mỗi dòng là mảng ô)
export async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb;
}
export function sheetRows(wb, name) {
  const ws = wb.Sheets[name || wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

// Tìm dòng tiêu đề: dòng có nhiều ô chứa từ khóa nhất trong 30 dòng đầu
export function detectHeaderRow(rows, keywords) {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 30).forEach((r, i) => {
    const cells = r.map(norm).filter(Boolean);
    const score = cells.filter((c) => keywords.some((k) => c.includes(k))).length * 10 + Math.min(cells.length, 9);
    if (cells.length >= 2 && score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// Đoán cột cho từng trường: fields = [{key, aliases: [...]}]; trả về {key: colIndex}
export function guessMapping(headers, fields) {
  const h = headers.map(norm);
  const used = new Set();
  const out = {};
  fields.forEach((f) => {
    let best = -1;
    let bestScore = 0;
    h.forEach((cell, i) => {
      if (!cell || used.has(i)) return;
      f.aliases.forEach((a, rank) => {
        const na = norm(a);
        const score = cell === na ? 100 - rank : cell.includes(na) ? 50 - rank : 0;
        if (score > bestScore) { bestScore = score; best = i; }
      });
    });
    if (best >= 0) { out[f.key] = best; used.add(best); }
  });
  return out;
}

// Chuyển giá trị ô thành số (hỗ trợ 1.234.567 / 1,234,567 / (1.000) âm)
export function toNumber(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d.,-]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

// Chuyển giá trị ô thành ngày YYYY-MM-DD
export function toYmd(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000); // tránh lệch múi giờ
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

export const cellText = (v) => (v instanceof Date ? toYmd(v) : String(v ?? '').trim());

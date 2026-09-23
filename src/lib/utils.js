// Ngày theo giờ Việt Nam, định dạng YYYY-MM-DD
export function vnDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}
export const today = () => vnDate();

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export function monthStart(ymd = today()) {
  return ymd.slice(0, 8) + '01';
}
export function fmtDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}
export function daysBetween(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to && out.length < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const fmtMoney = (v) => Math.round(num(v)).toLocaleString('vi-VN');
export const fmtNum = (v, digits = 2) =>
  num(v).toLocaleString('vi-VN', { maximumFractionDigits: digits });
export const fmtTon = (kg) => fmtNum(num(kg) / 1000, 3);

export const ORDER_STATUSES = ['Báo giá', 'Đã chốt', 'Đang giao', 'Hoàn thành', 'Hủy'];
// Trạng thái được tính vào doanh số và công nợ
export const REVENUE_STATUSES = ['Đã chốt', 'Đang giao', 'Hoàn thành'];
export const TASK_STATUSES = ['Mới', 'Đang làm', 'Hoàn thành', 'Hủy'];
export const PRIORITIES = ['Thấp', 'Bình thường', 'Cao', 'Gấp'];

export function orderAmount(o) {
  return (o.items || []).reduce((s, it) => s + num(it.qtyKg) * num(it.priceKg), 0) * (1 + num(o.vatPct) / 100);
}
export function orderKg(o) {
  return (o.items || []).reduce((s, it) => s + num(it.qtyKg), 0);
}

export function isTaskOverdue(t, ref = today()) {
  return t.dueDate && t.dueDate < ref && !['Hoàn thành', 'Hủy'].includes(t.status);
}

export function slugKey(label) {
  return (
    'f_' +
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) +
    '_' +
    Math.random().toString(36).slice(2, 6)
  );
}

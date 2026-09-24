// Tổng hợp báo cáo — dùng chung cho Dashboard (trình duyệt) và API gửi email (server)
import { isTaskOverdue, num, orderAmount, orderKg, REVENUE_STATUSES, today } from './utils.js';

export function buildReport({ activities = [], quotes = [], orders = [], payments = [], tasks = [], notes = [], customers = [], staffList = [], from, to }) {
  const inRange = (d) => d && d >= from && d <= to;
  const ref = today();
  const rows = new Map();
  const row = (email, name) => {
    if (!email) email = '(không rõ)';
    if (!rows.has(email)) {
      const s = staffList.find((x) => x.email === email);
      rows.set(email, {
        email, name: s?.name || name || email, role: s?.role || 'sale',
        activities: 0, byType: {}, newCustomers: 0, quotes: 0, quoteAmount: 0, quotesWon: 0, orders: 0, kg: 0, amount: 0,
        collected: 0, tasksDone: 0, tasksOpen: 0, tasksOverdue: 0, notes: 0,
      });
    }
    return rows.get(email);
  };
  staffList.filter((s) => s.active !== false && s.role !== 'admin').forEach((s) => row(s.email, s.name));

  activities.filter((a) => inRange(a.date)).forEach((a) => {
    const r = row(a.ownerEmail, a.ownerName);
    r.activities++;
    r.byType[a.type || 'Khác'] = (r.byType[a.type || 'Khác'] || 0) + 1;
  });
  customers.filter((c) => inRange(c.createdDate)).forEach((c) => { row(c.ownerEmail, c.ownerName).newCustomers++; });
  quotes.filter((q) => inRange(q.date)).forEach((q) => {
    const r = row(q.ownerEmail, q.ownerName);
    r.quotes++;
    r.quoteAmount += orderAmount(q);
    if (q.status === 'Đã tạo đơn') r.quotesWon++;
  });
  orders.filter((o) => inRange(o.date)).forEach((o) => {
    const r = row(o.ownerEmail, o.ownerName);
    if (o.status === 'Báo giá') r.quotes++;
    if (REVENUE_STATUSES.includes(o.status)) {
      r.orders++;
      r.kg += orderKg(o);
      r.amount += orderAmount(o);
    }
  });
  payments.filter((p) => inRange(p.date)).forEach((p) => { row(p.ownerEmail, p.ownerName).collected += num(p.amount); });
  tasks.forEach((t) => {
    const r = row(t.ownerEmail, t.ownerName);
    if (t.status === 'Hoàn thành' && inRange(t.completedDate)) r.tasksDone++;
    if (!['Hoàn thành', 'Hủy'].includes(t.status)) r.tasksOpen++;
    if (isTaskOverdue(t, ref)) r.tasksOverdue++;
  });
  notes.filter((n) => inRange(n.date)).forEach((n) => { row(n.ownerEmail, n.ownerName).notes++; });

  const list = [...rows.values()].sort((a, b) => b.amount - a.amount || b.activities - a.activities);
  const total = list.reduce((t, r) => {
    ['activities', 'newCustomers', 'quotes', 'quoteAmount', 'quotesWon', 'orders', 'kg', 'amount', 'collected', 'tasksDone', 'tasksOpen', 'tasksOverdue', 'notes']
      .forEach((k) => { t[k] = (t[k] || 0) + r[k]; });
    return t;
  }, {});

  // Theo ngày
  const byDay = {};
  const day = (d) => (byDay[d] ||= { date: d, amount: 0, kg: 0, activities: 0, collected: 0 });
  orders.filter((o) => inRange(o.date) && REVENUE_STATUSES.includes(o.status)).forEach((o) => {
    day(o.date).amount += orderAmount(o);
    day(o.date).kg += orderKg(o);
  });
  activities.filter((a) => inRange(a.date)).forEach((a) => { day(a.date).activities++; });
  payments.filter((p) => inRange(p.date)).forEach((p) => { day(p.date).collected += num(p.amount); });

  // Theo sản phẩm
  const byProduct = {};
  orders.filter((o) => inRange(o.date) && REVENUE_STATUSES.includes(o.status)).forEach((o) => {
    (o.items || []).forEach((it) => {
      const k = (it.product || 'Khác').trim();
      byProduct[k] ||= { product: k, kg: 0, amount: 0 };
      byProduct[k].kg += num(it.qtyKg);
      byProduct[k].amount += num(it.qtyKg) * num(it.priceKg) * (1 + num(o.vatPct) / 100);
    });
  });

  // Theo khách hàng
  const byCustomer = {};
  orders.filter((o) => inRange(o.date) && REVENUE_STATUSES.includes(o.status)).forEach((o) => {
    const k = o.customerName || '(không tên)';
    byCustomer[k] ||= { customer: k, orders: 0, kg: 0, amount: 0 };
    byCustomer[k].orders++;
    byCustomer[k].kg += orderKg(o);
    byCustomer[k].amount += orderAmount(o);
  });

  return {
    from, to, staff: list, total,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    byProduct: Object.values(byProduct).sort((a, b) => b.amount - a.amount),
    byCustomer: Object.values(byCustomer).sort((a, b) => b.amount - a.amount),
  };
}

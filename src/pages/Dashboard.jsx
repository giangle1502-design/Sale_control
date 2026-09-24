import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { scopedQuery } from '../lib/data';
import { buildReport } from '../lib/report';
import {
  daysBetween, fmtDate, fmtMoney, fmtNum, fmtTon, isTaskOverdue, num, orderAmount, orderKg, today,
} from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { customValue, Empty, ErrorBox, FilterBar, Stat, useRange } from '../components/ui';

const BAR = '#1565c0';
const short = (v) => (v >= 1e9 ? fmtNum(v / 1e9, 1) + ' tỷ' : v >= 1e6 ? fmtNum(v / 1e6, 1) + ' tr' : fmtNum(v, 0));

export default function Dashboard() {
  const { email, isAdmin, staffList, staffName, config } = useApp();
  const [range, setRange] = useRange('Hôm nay');
  const [staff, setStaff] = useState('');
  const scope = { me: email, isAdmin, staffFilter: staff, ...range };
  const deps = [email, isAdmin, staff, range.from, range.to];

  const acts = useQuery(() => scopedQuery('activities', scope), deps);
  const ords = useQuery(() => scopedQuery('orders', scope), deps);
  const quos = useQuery(() => scopedQuery('quotes', scope), deps);
  const pays = useQuery(() => scopedQuery('payments', scope), deps);
  const notes = useQuery(() => scopedQuery('dailyNotes', scope), deps);
  const custs = useQuery(() => scopedQuery('customers', { ...scope, dateField: 'createdDate' }), deps);
  const tasks = useQuery(() => scopedQuery('tasks', { me: email, isAdmin, staffFilter: staff }), [email, isAdmin, staff]);

  const visibleStaff = isAdmin ? (staff ? staffList.filter((s) => s.email === staff) : staffList) : staffList.filter((s) => s.email === email);
  const rep = useMemo(() => buildReport({
    activities: acts.data, quotes: quos.data, orders: ords.data, payments: pays.data, tasks: tasks.data, notes: notes.data,
    customers: custs.data, staffList: visibleStaff, ...range,
  }), [acts.data, quos.data, ords.data, pays.data, tasks.data, notes.data, custs.data, visibleStaff.length, range.from, range.to]);

  const days = daysBetween(range.from, range.to);
  const chartDays = days.map((d) => rep.byDay.find((x) => x.date === d) || { date: d, amount: 0, activities: 0 })
    .map((x) => ({ ...x, label: fmtDate(x.date).slice(0, 5) }));
  const multiDay = days.length > 1;
  const t = rep.total;
  const err = acts.error || quos.error || ords.error || pays.error || notes.error || custs.error || tasks.error;
  const missingNotes = range.to >= today() && range.from <= today()
    ? rep.staff.filter((s) => s.role !== 'admin' && !notes.data.some((n) => n.ownerEmail === s.email && n.date === today()))
    : [];
  const followUps = acts.data.filter((a) => a.nextDate && a.nextDate >= today()).sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 8);

  const doExport = () => {
    const cf = config.customFields;
    const extra = (list, r) => Object.fromEntries((list || []).map((f) => [f.label, customValue(f, r.custom?.[f.key])]));
    exportSheets(`BaoCao_${range.from}_${range.to}`, {
      'Tổng hợp theo NV': rep.staff.map((s) => ({
        'Nhân viên': s.name, 'Hoạt động KH': s.activities, 'Chi tiết HĐ': Object.entries(s.byType).map(([k, v]) => `${k}: ${v}`).join(', '),
        'KH mới': s.newCustomers, 'Báo giá': s.quotes, 'Giá trị báo giá': Math.round(s.quoteAmount), 'BG đã chốt': s.quotesWon, 'Đơn chốt': s.orders, 'Sản lượng (tấn)': +(s.kg / 1000).toFixed(3),
        'Doanh số': Math.round(s.amount), 'Đã thu': Math.round(s.collected), 'Việc hoàn thành': s.tasksDone,
        'Việc đang mở': s.tasksOpen, 'Việc quá hạn': s.tasksOverdue, 'Số ngày có báo cáo': s.notes,
      })),
      'Theo ngày': rep.byDay.map((d) => ({ Ngày: fmtDate(d.date), 'Hoạt động': d.activities, 'Sản lượng (tấn)': +(d.kg / 1000).toFixed(3), 'Doanh số': Math.round(d.amount), 'Đã thu': Math.round(d.collected) })),
      'Theo sản phẩm': rep.byProduct.map((p) => ({ 'Sản phẩm': p.product, 'Sản lượng (tấn)': +(p.kg / 1000).toFixed(3), 'Doanh số': Math.round(p.amount) })),
      'Theo khách hàng': rep.byCustomer.map((c) => ({ 'Khách hàng': c.customer, 'Số đơn': c.orders, 'Sản lượng (tấn)': +(c.kg / 1000).toFixed(3), 'Doanh số': Math.round(c.amount) })),
      'Hoạt động': acts.data.map((a) => ({ Ngày: fmtDate(a.date), 'Nhân viên': staffName(a.ownerEmail), 'Khách hàng': a.customerName, Loại: a.type, 'Nội dung': a.content, 'Kết quả': a.result, 'Việc tiếp theo': a.nextAction, 'Hẹn ngày': fmtDate(a.nextDate), ...extra(cf.activities, a) })),
      'Đơn hàng': ords.data.map((o) => ({ 'Số ĐH': o.orderNo, Ngày: fmtDate(o.date), 'Nhân viên': staffName(o.ownerEmail), 'Khách hàng': o.customerName, 'Sản phẩm': (o.items || []).map((i) => `${i.product} ${i.grade || ''} ${i.qtyKg}kg×${i.priceKg}`).join('; '), 'Tổng kg': orderKg(o), 'Tổng tiền': Math.round(orderAmount(o)), 'Trạng thái': o.status, ...extra(cf.orders, o) })),
      'Thu tiền': pays.data.map((p) => ({ Ngày: fmtDate(p.date), 'Nhân viên': staffName(p.ownerEmail), 'Khách hàng': p.customerName, 'Số tiền': num(p.amount), 'Hình thức': p.method, 'Ghi chú': p.note, ...extra(cf.payments, p) })),
      'Công việc': tasks.data.map((x) => ({ 'Công việc': x.title, 'Người thực hiện': staffName(x.ownerEmail), Hạn: fmtDate(x.dueDate), 'Trạng thái': x.status, 'Tiến độ %': num(x.progress), 'Quá hạn': isTaskOverdue(x) ? 'Có' : '', ...extra(cf.tasks, x) })),
      'Báo cáo ngày': notes.data.map((n) => ({ Ngày: fmtDate(n.date), 'Nhân viên': staffName(n.ownerEmail), 'Đã làm': n.summary, 'Khó khăn': n.issues, 'Kế hoạch': n.plan, ...extra(cf.dailyNotes, n) })),
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>Tổng quan {isAdmin ? '' : 'của tôi'}</h1>
        <button className="btn" onClick={doExport}>⬇ Xuất báo cáo Excel</button>
      </div>
      <FilterBar range={range} setRange={setRange} staff={staff} setStaff={setStaff} />
      <ErrorBox error={err} />
      <div className="stats">
        <Stat label="Doanh số (đơn đã chốt)" value={fmtMoney(t.amount || 0)} sub={`${t.orders || 0} đơn · ${t.quotes || 0} báo giá (${fmtMoney(t.quoteAmount || 0)} đ)`} tone="green" />
        <Stat label="Sản lượng" value={fmtTon(t.kg || 0) + ' tấn'} tone="green" />
        <Stat label="Đã thu tiền" value={fmtMoney(t.collected || 0)} tone="amber" />
        <Stat label="Hoạt động KH" value={t.activities || 0} sub={`${t.newCustomers || 0} khách hàng mới`} />
        <Stat label="Việc hoàn thành" value={t.tasksDone || 0} sub={`${t.tasksOpen || 0} đang mở`} />
        <Stat label="Việc quá hạn" value={t.tasksOverdue || 0} tone="red" />
      </div>

      {isAdmin && missingNotes.length > 0 && (
        <div className="error-box">Chưa gửi báo cáo ngày hôm nay: {missingNotes.map((s) => s.name).join(', ')}</div>
      )}

      {multiDay && (
        <div className="grid2">
          <div className="chart-card">
            <h4>Doanh số theo ngày (đ)</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartDays} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#eef1f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={{ stroke: '#e3e7ed' }} />
                <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v) => [fmtMoney(v) + ' đ', 'Doanh số']} labelFormatter={(l) => 'Ngày ' + l} cursor={{ fill: '#f0f4fa' }} />
                <Bar dataKey="amount" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card">
            <h4>Số hoạt động khách hàng theo ngày</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartDays} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#eef1f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={{ stroke: '#e3e7ed' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={false} width={32} />
                <Tooltip formatter={(v) => [v, 'Hoạt động']} labelFormatter={(l) => 'Ngày ' + l} cursor={{ fill: '#f0f4fa' }} />
                <Bar dataKey="activities" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="section-title">Kết quả theo nhân viên</div>
      <div className="table-wrap">
        {rep.staff.length === 0 ? <Empty /> : (
          <table>
            <thead><tr>
              <th>Nhân viên</th><th className="num">Hoạt động</th><th>Chi tiết</th><th className="num">KH mới</th><th className="num">Báo giá</th>
              <th className="num">Đơn chốt</th><th className="num">Tấn</th><th className="num">Doanh số</th><th className="num">Đã thu</th>
              <th className="num">Việc xong</th><th className="num">Quá hạn</th><th className="num">Báo cáo ngày</th>
            </tr></thead>
            <tbody>
              {rep.staff.map((s) => (
                <tr key={s.email}>
                  <td><b>{s.name}</b></td>
                  <td className="num">{s.activities}</td>
                  <td className="small">{Object.entries(s.byType).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                  <td className="num">{s.newCustomers}</td>
                  <td className="num">{s.quotes}</td>
                  <td className="num">{s.orders}</td>
                  <td className="num">{fmtTon(s.kg)}</td>
                  <td className="num">{fmtMoney(s.amount)}</td>
                  <td className="num">{fmtMoney(s.collected)}</td>
                  <td className="num">{s.tasksDone}</td>
                  <td className="num">{s.tasksOverdue > 0 ? <span className="badge red">{s.tasksOverdue}</span> : 0}</td>
                  <td className="num">{s.notes}/{days.length}</td>
                </tr>
              ))}
            </tbody>
            {rep.staff.length > 1 && (
              <tfoot><tr>
                <td>Tổng</td><td className="num">{t.activities}</td><td></td><td className="num">{t.newCustomers}</td><td className="num">{t.quotes}</td>
                <td className="num">{t.orders}</td><td className="num">{fmtTon(t.kg)}</td><td className="num">{fmtMoney(t.amount)}</td>
                <td className="num">{fmtMoney(t.collected)}</td><td className="num">{t.tasksDone}</td><td className="num">{t.tasksOverdue}</td><td></td>
              </tr></tfoot>
            )}
          </table>
        )}
      </div>

      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <div className="section-title">Theo loại hạt</div>
          <div className="table-wrap">
            {rep.byProduct.length === 0 ? <Empty /> : (
              <table><thead><tr><th>Sản phẩm</th><th className="num">Tấn</th><th className="num">Doanh số</th></tr></thead>
                <tbody>{rep.byProduct.map((p) => <tr key={p.product}><td>{p.product}</td><td className="num">{fmtTon(p.kg)}</td><td className="num">{fmtMoney(p.amount)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
        <div>
          <div className="section-title">Lịch hẹn sắp tới (từ hoạt động trong kỳ)</div>
          <div className="table-wrap">
            {followUps.length === 0 ? <Empty text="Không có lịch hẹn" /> : (
              <table><thead><tr><th>Hẹn</th><th>Khách hàng</th><th>Việc</th>{isAdmin && <th>NV</th>}</tr></thead>
                <tbody>{followUps.map((a) => (
                  <tr key={a.id}><td className="nowrap">{fmtDate(a.nextDate)}</td><td>{a.customerName}</td><td>{a.nextAction}</td>{isAdmin && <td>{staffName(a.ownerEmail)}</td>}</tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="section-title">Top khách hàng trong kỳ</div>
      <div className="table-wrap">
        {rep.byCustomer.length === 0 ? <Empty /> : (
          <table><thead><tr><th>Khách hàng</th><th className="num">Số đơn</th><th className="num">Tấn</th><th className="num">Doanh số</th></tr></thead>
            <tbody>{rep.byCustomer.slice(0, 10).map((c) => (
              <tr key={c.customer}><td>{c.customer}</td><td className="num">{c.orders}</td><td className="num">{fmtTon(c.kg)}</td><td className="num">{fmtMoney(c.amount)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

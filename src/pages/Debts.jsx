import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { ensureCustomer, removeDoc, saveDoc, scopedQuery } from '../lib/data';
import { fmtDate, fmtMoney, num, orderAmount, REVENUE_STATUSES, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import CustomerPicker from '../components/CustomerPicker';
import Receivables from './Receivables';
import PaymentForm from '../components/PaymentForm';
import {
  confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, FilterBar, Modal, Stat, useRange,
} from '../components/ui';

const METHODS = ['Chuyển khoản', 'Tiền mặt', 'Bù trừ', 'Khác'];
const blank = () => ({ date: today(), customerId: '', customerName: '', amount: '', method: 'Chuyển khoản', orderNo: '', note: '', custom: {} });
const custKey = (r) => r.customerId || (r.customerName || '').trim().toLowerCase();

// Tính công nợ theo khách từ toàn bộ đơn hàng và phiếu thu
export function computeDebts(orders, payments, ref = today()) {
  const map = new Map();
  const get = (r) => {
    const k = custKey(r);
    if (!map.has(k)) map.set(k, { key: k, customerId: r.customerId || '', customerName: r.customerName, ownerEmail: r.ownerEmail, sales: 0, paid: 0, dueSales: 0, lastDue: '' });
    return map.get(k);
  };
  orders.filter((o) => REVENUE_STATUSES.includes(o.status)).forEach((o) => {
    const c = get(o);
    const amt = orderAmount(o);
    c.sales += amt;
    const due = o.dueDate || o.date;
    if (due < ref) c.dueSales += amt;
    else if (!c.lastDue || due < c.lastDue) c.lastDue = due;
  });
  payments.forEach((p) => { get(p).paid += num(p.amount); });
  return [...map.values()]
    .map((c) => ({ ...c, balance: c.sales - c.paid, overdue: Math.max(0, c.dueSales - c.paid) }))
    .sort((a, b) => b.balance - a.balance);
}

export default function Debts() {
  const { email, isAdmin, profile, config, staffName, staffList } = useApp();
  const [range, setRange] = useRange('Tháng này');
  const [staff, setStaff] = useState('');
  const [tab, setTab] = useState('acc');
  const [edit, setEdit] = useState(null);
  const [outstanding, setOutstanding] = useState(0);
  const fields = config.customFields.payments || [];
  const scope = { me: email, isAdmin, staffFilter: staff };

  const allOrders = useQuery(() => scopedQuery('orders', scope), [email, isAdmin, staff]);
  const allPays = useQuery(() => scopedQuery('payments', scope), [email, isAdmin, staff]);
  const debts = useMemo(() => computeDebts(allOrders.data, allPays.data), [allOrders.data, allPays.data]);
  const pays = allPays.data
    .filter((p) => p.date >= range.from && p.date <= range.to)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totals = {
    balance: debts.reduce((s, d) => s + Math.max(0, d.balance), 0),
    overdue: debts.reduce((s, d) => s + d.overdue, 0),
    collected: pays.reduce((s, p) => s + num(p.amount), 0),
  };

  const doExport = () => exportSheets(`CongNo_${today()}`, {
    'Công nợ theo KH': debts.map((d) => ({
      'Khách hàng': d.customerName, 'Nhân viên': staffName(d.ownerEmail), 'Tổng bán': Math.round(d.sales),
      'Đã thu': Math.round(d.paid), 'Còn nợ': Math.round(d.balance), 'Quá hạn': Math.round(d.overdue),
    })),
    'Phiếu thu': pays.map((p) => ({
      Ngày: fmtDate(p.date), 'Nhân viên': staffName(p.ownerEmail), 'Khách hàng': p.customerName, 'Số tiền': num(p.amount),
      'Hình thức': p.method, 'Số ĐH': p.orderNo, 'Ghi chú': p.note,
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, p.custom?.[f.key])])),
    })),
  });

  const TABS = [['acc', 'Công nợ (số liệu kế toán)'], ['debt', 'Công nợ tính theo đơn hàng'], ['pay', 'Phiếu thu']];
  return (
    <>
      <div className="page-head">
        <h1>Công nợ & Thu tiền</h1>
        <div className="actions">
          {tab !== 'acc' && <button className="btn" onClick={doExport}>⬇ Excel</button>}
          <button className="btn primary" onClick={() => setEdit(blank())}>+ Ghi thu tiền</button>
        </div>
      </div>
      <div className="presets" style={{ marginBottom: 10 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
        {isAdmin && (
          <select value={staff} onChange={(e) => setStaff(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="">Tất cả nhân viên</option>
            {staffList.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </select>
        )}
      </div>
      {tab === 'acc' ? <Receivables staffFilter={staff} onCollect={(c, amt) => { setOutstanding(amt); setEdit({ ...blank(), ...c }); }} /> : <>
      {tab === 'pay' && <FilterBar range={range} setRange={setRange} />}
      <div className="stats">
        <Stat label="Tổng còn phải thu" value={fmtMoney(totals.balance) + ' đ'} tone="amber" />
        <Stat label="Quá hạn" value={fmtMoney(totals.overdue) + ' đ'} tone="red" />
        <Stat label="Đã thu trong kỳ" value={fmtMoney(totals.collected) + ' đ'} tone="green" sub={`${pays.length} phiếu thu`} />
      </div>
      <ErrorBox error={allOrders.error || allPays.error} />
      {tab === 'debt' ? (
        <div className="table-wrap">
          {debts.length === 0 ? <Empty /> : (
            <table>
              <thead><tr><th>Khách hàng</th>{isAdmin && <th>Nhân viên</th>}<th className="num">Tổng bán</th><th className="num">Đã thu</th><th className="num">Còn nợ</th><th className="num">Quá hạn</th><th>Hạn gần nhất</th><th></th></tr></thead>
              <tbody>
                {debts.map((d) => (
                  <tr key={d.key}>
                    <td>{d.customerName}</td>
                    {isAdmin && <td>{staffName(d.ownerEmail)}</td>}
                    <td className="num">{fmtMoney(d.sales)}</td>
                    <td className="num">{fmtMoney(d.paid)}</td>
                    <td className="num"><b>{fmtMoney(d.balance)}</b></td>
                    <td className="num">{d.overdue > 0 ? <span className="badge red">{fmtMoney(d.overdue)}</span> : '-'}</td>
                    <td>{fmtDate(d.lastDue)}</td>
                    <td className="nowrap">
                      {d.balance > 0 && (isAdmin || d.ownerEmail === email) && (
                        <button className="btn sm primary" onClick={() => { setOutstanding(d.balance); setEdit({ ...blank(), customerId: d.customerId, customerName: d.customerName }); }}>💰 Ghi thu tiền</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          {pays.length === 0 ? <Empty /> : (
            <table>
              <thead><tr><th>Ngày</th>{isAdmin && <th>Nhân viên</th>}<th>Khách hàng</th><th className="num">Số tiền</th><th>Hình thức</th><th>Số ĐH</th><th>Ghi chú</th>
                {fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{fmtDate(p.date)}</td>
                    {isAdmin && <td>{staffName(p.ownerEmail)}</td>}
                    <td>{p.customerName}</td>
                    <td className="num">{fmtMoney(p.amount)}</td>
                    <td>{p.method}</td><td>{p.orderNo}</td><td>{p.note}</td>
                    {fields.map((f) => <td key={f.key}>{String(customValue(f, p.custom?.[f.key]))}</td>)}
                    <td className="nowrap">
                      {(isAdmin || p.ownerEmail === email) && <>
                        <button className="btn sm" onClick={() => setEdit(p)}>Sửa</button>{' '}
                        <button className="btn sm danger" onClick={() => confirmDelete() && removeDoc('payments', p.id)}>Xóa</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      </>}
      {edit && <PaymentForm initial={edit} outstanding={outstanding} onClose={() => { setEdit(null); setOutstanding(0); }} />}
    </>
  );
}

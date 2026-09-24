import { useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { ensureCustomer, markCustomerOld, removeDoc, saveDoc, scopedQuery } from '../lib/data';
import {
  addDays, fmtDate, fmtMoney, fmtNum, fmtTon, num, ORDER_STATUSES, orderAmount, orderKg, REVENUE_STATUSES, today,
} from '../lib/utils';
import { exportSheets } from '../lib/excel';
import CustomerPicker from '../components/CustomerPicker';
import ItemsTable, { blankItem, cleanItems, itemText } from '../components/ItemsTable';
import AddFieldButton from '../components/AddFieldButton';
import {
  confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, FilterBar, Modal, Stat, useRange,
} from '../components/ui';

const STATUS_TONE = { 'Báo giá': 'amber', 'Đã chốt': 'blue', 'Đang giao': 'blue', 'Hoàn thành': 'green', 'Hủy': 'red' };
export const newOrderNo = () => 'DH' + today().replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
const blank = () => ({
  orderNo: newOrderNo(), date: today(), customerId: '', customerName: '', items: [blankItem()], vatPct: 0, status: 'Đã chốt',
  deliveryDate: '', paymentDays: 0, dueDate: '', note: '', custom: {}, quoteId: '', quoteNo: '',
});

export default function Orders() {
  const { email, isAdmin, config, staffName } = useApp();
  const [range, setRange] = useRange('Tháng này');
  const [staff, setStaff] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState(null);
  const fields = config.customFields.orders || [];
  const cols = config.customFields.items || [];

  const { data, error } = useQuery(
    () => scopedQuery('orders', { me: email, isAdmin, staffFilter: staff, ...range }),
    [email, isAdmin, staff, range.from, range.to]
  );
  const rows = data.filter((r) => (!status || r.status === status) && r.status !== 'Báo giá');
  const sum = useMemo(() => {
    const rev = rows.filter((r) => REVENUE_STATUSES.includes(r.status));
    return {
      count: rev.length,
      kg: rev.reduce((s, r) => s + orderKg(r), 0),
      amount: rev.reduce((s, r) => s + orderAmount(r), 0),
      fromQuote: rev.filter((r) => r.quoteId).length,
    };
  }, [rows]);

  const doExport = () => {
    const lines = [];
    rows.forEach((r) => (r.items || []).forEach((it) => lines.push({
      'Số ĐH': r.orderNo, 'Từ báo giá': r.quoteNo || '', Ngày: fmtDate(r.date), 'Nhân viên': staffName(r.ownerEmail), 'Khách hàng': r.customerName,
      'Mã hàng': it.productCode || '', 'Tên hàng': it.product, 'Grade': it.grade,
      ...Object.fromEntries(cols.map((c) => [c.label, customValue(c, it.custom?.[c.key])])),
      'SL (kg)': num(it.qtyKg), 'Đơn giá (đ/kg)': num(it.priceKg),
      'Thành tiền': num(it.qtyKg) * num(it.priceKg), 'VAT %': num(r.vatPct), 'Trạng thái': r.status,
    })));
    exportSheets(`DonHang_${range.from}_${range.to}`, {
      'Đơn hàng': rows.map((r) => ({
        'Số ĐH': r.orderNo, 'Từ báo giá': r.quoteNo || '', Ngày: fmtDate(r.date), 'Nhân viên': staffName(r.ownerEmail), 'Khách hàng': r.customerName,
        'Sản phẩm': (r.items || []).map((i) => itemText(i, cols)).join('; '),
        'Tổng kg': orderKg(r), 'Tổng tiền (gồm VAT)': Math.round(orderAmount(r)), 'Trạng thái': r.status,
        'Ngày giao': fmtDate(r.deliveryDate), 'Hạn thanh toán': fmtDate(r.dueDate), 'Ghi chú': r.note,
        ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, r.custom?.[f.key])])),
      })),
      'Chi tiết dòng hàng': lines,
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>Đơn hàng</h1>
        <div className="actions">
          <button className="btn" onClick={doExport}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setEdit(blank())}>+ Tạo đơn trực tiếp</button>
        </div>
      </div>
      <p className="small">Quy trình chuẩn: tạo <b>Báo giá</b> → khách đồng ý → bấm <b>"Xác nhận tạo đơn"</b> ở trang Báo giá. Nút "Tạo đơn trực tiếp" dùng cho khách đặt không qua báo giá.</p>
      <FilterBar range={range} setRange={setRange} staff={staff} setStaff={setStaff}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {ORDER_STATUSES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </FilterBar>
      <div className="stats">
        <Stat label="Đơn đã chốt" value={sum.count} sub={`${sum.fromQuote} đơn từ báo giá`} />
        <Stat label="Sản lượng" value={fmtTon(sum.kg) + ' tấn'} tone="green" />
        <Stat label="Doanh số (gồm VAT)" value={fmtMoney(sum.amount) + ' đ'} tone="green" />
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {rows.length === 0 ? <Empty /> : (
          <table>
            <thead><tr>
              <th>Số ĐH</th><th>Ngày</th>{isAdmin && <th>Nhân viên</th>}<th>Khách hàng</th><th>Sản phẩm</th>
              <th className="num">Tấn</th><th className="num">Tổng tiền</th><th>Trạng thái</th><th>Hạn TT</th>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{r.orderNo}{r.quoteNo && <div className="small">từ {r.quoteNo}</div>}</td>
                  <td className="nowrap">{fmtDate(r.date)}</td>
                  {isAdmin && <td>{staffName(r.ownerEmail)}</td>}
                  <td>{r.customerName}</td>
                  <td>{(r.items || []).map((i, k) => <div key={k}>{itemText(i, cols)} <span className="small">{fmtNum(i.qtyKg, 0)}kg × {fmtMoney(i.priceKg)}</span></div>)}</td>
                  <td className="num">{fmtTon(orderKg(r))}</td>
                  <td className="num">{fmtMoney(orderAmount(r))}</td>
                  <td><span className={'badge ' + (STATUS_TONE[r.status] || '')}>{r.status}</span></td>
                  <td className="nowrap">{fmtDate(r.dueDate)}</td>
                  {fields.map((f) => <td key={f.key}>{String(customValue(f, r.custom?.[f.key]))}</td>)}
                  <td className="nowrap">
                    {(isAdmin || r.ownerEmail === email) && <>
                      <button className="btn sm" onClick={() => setEdit(r)}>Sửa</button>{' '}
                      <button className="btn sm danger" onClick={() => confirmDelete('Xóa đơn hàng này?') && removeDoc('orders', r.id)}>Xóa</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <OrderForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// Form đơn hàng — dùng cả khi xác nhận từ báo giá (initial.quoteId có giá trị)
export function OrderForm({ initial, onClose }) {
  const { profile, config } = useApp();
  const fields = config.customFields.orders || [];
  const [f, setF] = useState({ ...blank(), ...initial, custom: initial.custom || {}, items: initial.items?.length ? initial.items : [blankItem()] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const cust = await ensureCustomer(f, profile);
      const { id, ownerEmail, ownerName, createdAt, createdBy, updatedAt, updatedBy, ...rest } = f;
      const items = cleanItems(rest.items);
      const dueDate = num(rest.paymentDays) > 0 ? addDays(rest.deliveryDate || rest.date, num(rest.paymentDays)) : (rest.dueDate || rest.date);
      const orderId = await saveDoc('orders', id, {
        ...rest, ...cust, items, vatPct: num(rest.vatPct), paymentDays: num(rest.paymentDays), dueDate,
        totalKg: orderKg({ items }), totalAmount: Math.round(orderAmount({ items, vatPct: rest.vatPct })),
      }, profile);
      if (REVENUE_STATUSES.includes(rest.status)) await markCustomerOld(cust.customerId);
      if (rest.quoteId && !id) {
        await updateDoc(doc(db, 'quotes', rest.quoteId), { status: 'Đã tạo đơn', orderId, orderNo: rest.orderNo, confirmedDate: today() });
      }
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const total = orderAmount(f);

  return (
    <Modal title={f.id ? 'Sửa đơn hàng' : f.quoteId ? `Xác nhận tạo đơn từ báo giá ${f.quoteNo}` : 'Tạo đơn hàng'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {f.quoteId && !f.id && <div className="ok-box" style={{ marginBottom: 10 }}>Thông tin đã lấy từ báo giá. Kiểm tra lại số lượng, giá, ngày giao rồi bấm "Xác nhận tạo đơn".</div>}
        <div className="form-grid">
          <Field label="Số đơn hàng" required><input value={f.orderNo} onChange={set('orderNo')} required /></Field>
          <Field label="Ngày đặt" required><input type="date" value={f.date} onChange={set('date')} required /></Field>
          <Field label="Khách hàng" required full><CustomerPicker value={f} onChange={(c) => setF({ ...f, ...c })} required /></Field>
        </div>
        <div className="section-title">Dòng hàng</div>
        <ItemsTable items={f.items} onChange={(items) => setF({ ...f, items })} />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="VAT % (để 0 nếu giá đã gồm VAT)"><input type="number" step="any" value={f.vatPct} onChange={set('vatPct')} /></Field>
          <Field label="Tổng tiền"><input value={fmtMoney(total) + ' đ'} readOnly /></Field>
          <Field label="Trạng thái" required>
            <select value={f.status} onChange={set('status')}>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Ngày giao dự kiến"><input type="date" value={f.deliveryDate} onChange={set('deliveryDate')} /></Field>
          <Field label="Công nợ (số ngày)"><input type="number" value={f.paymentDays} onChange={set('paymentDays')} /></Field>
          <Field label="Ghi chú"><input value={f.note} onChange={set('note')} /></Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        <div style={{ marginTop: 10 }}><AddFieldButton module="orders" label="+ Thêm trường cho đơn hàng" /></div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>{f.quoteId && !f.id ? '✔ Xác nhận tạo đơn' : 'Lưu'}</button>
        </div>
      </form>
    </Modal>
  );
}

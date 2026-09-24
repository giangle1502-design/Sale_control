import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ensureCustomer, saveDoc } from '../lib/data';
import { fmtMoney, num, today } from '../lib/utils';
import CustomerPicker from './CustomerPicker';
import { CustomFieldInputs, Field, Modal } from './ui';

export const METHODS = ['Chuyển khoản', 'Tiền mặt', 'Bù trừ', 'Khác'];
export const blankPayment = () => ({ date: today(), customerId: '', customerName: '', amount: '', method: 'Chuyển khoản', orderNo: '', note: '', custom: {} });

// Form ghi nhận thu tiền — dùng ở trang Công nợ (nút chung và nút trên từng dòng công nợ)
export default function PaymentForm({ initial, onClose, outstanding }) {
  const { profile, config } = useApp();
  const fields = config.customFields.payments || [];
  const [f, setF] = useState({ ...blankPayment(), ...initial, custom: initial.custom || {} });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const cust = await ensureCustomer(f, profile);
      const { id, ownerEmail, ownerName, createdAt, createdBy, updatedAt, updatedBy, ...rest } = f;
      await saveDoc('payments', id, { ...rest, ...cust, amount: num(rest.amount) }, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Modal title={f.id ? 'Sửa phiếu thu' : 'Ghi nhận thu tiền'} onClose={onClose}>
      <form onSubmit={submit}>
        {outstanding > 0 && (
          <div className="ok-box" style={{ marginBottom: 10 }}>
            Khách <b>{f.customerName}</b> còn nợ <b>{fmtMoney(outstanding)} đ</b>.{' '}
            <a onClick={() => setF({ ...f, amount: Math.round(outstanding) })}>Thu đủ số này</a>
          </div>
        )}
        <div className="form-grid">
          <Field label="Ngày thu" required><input type="date" value={f.date} onChange={set('date')} required /></Field>
          <Field label="Số tiền (đ)" required><input type="number" step="any" value={f.amount} onChange={set('amount')} required autoFocus /></Field>
          <Field label="Khách hàng" required full><CustomerPicker value={f} onChange={(c) => setF({ ...f, ...c })} required /></Field>
          <Field label="Hình thức"><select value={f.method} onChange={set('method')}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Số hóa đơn / đơn hàng (nếu có)"><input value={f.orderNo} onChange={set('orderNo')} /></Field>
          <Field label="Ghi chú" full><input value={f.note} onChange={set('note')} /></Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

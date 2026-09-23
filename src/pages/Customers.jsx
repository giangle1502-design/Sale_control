import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { removeDoc, saveDoc } from '../lib/data';
import { fmtDate, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { useCustomers } from '../components/CustomerPicker';
import { confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, Modal } from '../components/ui';

const STAGES = ['Tiềm năng', 'Đang chăm sóc', 'Đang giao dịch', 'Ngừng giao dịch'];
const TONE = { 'Tiềm năng': 'amber', 'Đang chăm sóc': 'blue', 'Đang giao dịch': 'green', 'Ngừng giao dịch': 'red' };
const blank = () => ({
  name: '', contact: '', phone: '', email: '', address: '', taxCode: '', source: '', stage: 'Tiềm năng',
  productsUsed: '', monthlyVolume: '', note: '', custom: {}, createdDate: today(),
});

export default function Customers() {
  const { email, isAdmin, profile, config, staffList, staffName } = useApp();
  const [staff, setStaff] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [edit, setEdit] = useState(null);
  const fields = config.customFields.customers || [];
  const { data, error } = useCustomers(staff);
  const s = search.trim().toLowerCase();
  const rows = data
    .filter((c) => (!stage || c.stage === stage) && (!s || [c.name, c.contact, c.phone, c.taxCode].some((v) => (v || '').toLowerCase().includes(s))))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const doExport = () => exportSheets(`KhachHang_${today()}`, {
    'Khách hàng': rows.map((c) => ({
      'Tên KH': c.name, 'Người liên hệ': c.contact, SĐT: c.phone, Email: c.email, 'Địa chỉ': c.address, MST: c.taxCode,
      Nguồn: c.source, 'Giai đoạn': c.stage, 'Loại hạt đang dùng': c.productsUsed, 'Sản lượng/tháng (tấn)': c.monthlyVolume,
      'Nhân viên phụ trách': staffName(c.ownerEmail), 'Ngày tạo': fmtDate(c.createdDate), 'Ghi chú': c.note,
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, c.custom?.[f.key])])),
    })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Khách hàng <span className="small">({rows.length})</span></h1>
        <div className="actions">
          <button className="btn" onClick={doExport}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setEdit(blank())}>+ Thêm khách hàng</button>
        </div>
      </div>
      <div className="filters">
        <input placeholder="Tìm tên, SĐT, MST…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Tất cả giai đoạn</option>{STAGES.map((x) => <option key={x}>{x}</option>)}
        </select>
        {isAdmin && (
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {staffList.map((x) => <option key={x.email} value={x.email}>{x.name || x.email}</option>)}
          </select>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {rows.length === 0 ? <Empty /> : (
          <table>
            <thead><tr><th>Khách hàng</th><th>Liên hệ</th><th>Giai đoạn</th><th>Đang dùng</th>{isAdmin && <th>Phụ trách</th>}
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{c.address && <div className="small">{c.address}</div>}</td>
                  <td>{c.contact}<div className="small">{c.phone} {c.email}</div></td>
                  <td><span className={'badge ' + (TONE[c.stage] || '')}>{c.stage || '-'}</span></td>
                  <td>{c.productsUsed}{c.monthlyVolume && <div className="small">{c.monthlyVolume} tấn/tháng</div>}</td>
                  {isAdmin && <td>{staffName(c.ownerEmail)}</td>}
                  {fields.map((f) => <td key={f.key}>{String(customValue(f, c.custom?.[f.key]))}</td>)}
                  <td className="nowrap">
                    {(isAdmin || c.ownerEmail === email) && <>
                      <button className="btn sm" onClick={() => setEdit(c)}>Sửa</button>{' '}
                      <button className="btn sm danger" onClick={() => confirmDelete('Xóa khách hàng này? (Đơn hàng, hoạt động cũ vẫn giữ)') && removeDoc('customers', c.id)}>Xóa</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <CustomerForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CustomerForm({ initial, onClose }) {
  const { isAdmin, profile, config, staffList, staffName } = useApp();
  const fields = config.customFields.customers || [];
  const [f, setF] = useState({ ...blank(), ...initial, custom: initial.custom || {} });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { id, createdAt, createdBy, updatedAt, updatedBy, ...rest } = f;
      if (!isAdmin) { delete rest.ownerEmail; delete rest.ownerName; }
      else if (rest.ownerEmail) rest.ownerName = staffName(rest.ownerEmail);
      await saveDoc('customers', id, rest, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Modal title={f.id ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên khách hàng / công ty" required full><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Người liên hệ"><input value={f.contact} onChange={set('contact')} /></Field>
          <Field label="Số điện thoại"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Mã số thuế"><input value={f.taxCode} onChange={set('taxCode')} /></Field>
          <Field label="Địa chỉ" full><input value={f.address} onChange={set('address')} /></Field>
          <Field label="Nguồn khách">
            <select value={f.source} onChange={set('source')}><option value="">--</option>{config.customerSources.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
          <Field label="Giai đoạn">
            <select value={f.stage} onChange={set('stage')}>{STAGES.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
          <Field label="Loại hạt đang dùng"><input value={f.productsUsed} onChange={set('productsUsed')} placeholder="VD: PP, HDPE" /></Field>
          <Field label="Sản lượng ước tính (tấn/tháng)"><input type="number" step="any" value={f.monthlyVolume} onChange={set('monthlyVolume')} /></Field>
          {isAdmin && f.id && (
            <Field label="Nhân viên phụ trách">
              <select value={f.ownerEmail} onChange={set('ownerEmail')}>
                {staffList.map((x) => <option key={x.email} value={x.email}>{x.name || x.email}</option>)}
              </select>
            </Field>
          )}
          <Field label="Ghi chú" full><textarea rows={2} value={f.note} onChange={set('note')} /></Field>
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

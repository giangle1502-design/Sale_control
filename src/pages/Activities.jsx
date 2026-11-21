import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { ensureCustomer, removeDoc, saveDoc, scopedQuery } from '../lib/data';
import { fmtDate, norm, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import CustomerPicker, { useCustomers } from '../components/CustomerPicker';
import ColumnTable from '../components/ColumnTable';
import {
  confirmDelete, CustomFieldInputs, customValue, ErrorBox, Field, FilterBar, Modal, useRange,
} from '../components/ui';

const blank = () => ({ date: today(), customerId: '', customerName: '', type: '', content: '', result: '', nextAction: '', nextDate: '', custom: {} });

export default function Activities() {
  const { email, isAdmin, profile, config, staffName } = useApp();
  const [range, setRange] = useRange('7 ngày');
  const [staff, setStaff] = useState('');
  const [type, setType] = useState('');
  const [edit, setEdit] = useState(null);
  const fields = config.customFields.activities || [];

  const { data, error } = useQuery(
    () => scopedQuery('activities', { me: email, isAdmin, staffFilter: staff, ...range }),
    [email, isAdmin, staff, range.from, range.to]
  );
  const rows = data.filter((r) => !type || r.type === type);
  // Thông tin khách lấy từ danh mục Khách hàng (theo mã khách đã chọn, không có thì theo tên)
  const custs = useCustomers(staff).data;
  const custOf = useMemo(() => {
    const byId = new Map(custs.map((c) => [c.id, c])); const byName = new Map(custs.map((c) => [norm(c.name), c]));
    return (r) => byId.get(r.customerId) || byName.get(norm(r.customerName)) || {};
  }, [custs]);
  const CUST = [['company', 'Tên công ty', (c) => c.name], ['taxCode', 'MST', (c) => c.taxCode], ['address', 'Địa chỉ', (c) => c.address], ['contact', 'Người liên hệ', (c) => c.contact], ['phone', 'SĐT', (c) => c.phone]];
  const columns = [
    { k: 'date', l: 'Ngày', v: (r) => fmtDate(r.date), cls: 'nowrap' },
    ...(isAdmin ? [{ k: 'staff', l: 'Nhân viên', v: (r) => staffName(r.ownerEmail) }] : []),
    { k: 'cust', l: 'Khách hàng', v: (r) => r.customerName },
    ...CUST.map(([k, l, f]) => ({ k, l, v: (r) => f(custOf(r)) || '', cls: ['taxCode', 'phone'].includes(k) ? 'nowrap' : '' })),
    { k: 'type', l: 'Loại', v: (r) => r.type, render: (r) => <span className="badge blue">{r.type}</span> },
    { k: 'content', l: 'Nội dung / Kết quả', v: (r) => [r.content, r.result && '→ ' + r.result].filter(Boolean).join(' '), render: (r) => <>{r.content}{r.result && <div className="act-result">→ {r.result}</div>}</> },
    { k: 'next', l: 'Việc tiếp theo', v: (r) => [r.nextAction, r.nextDate && 'Hẹn: ' + fmtDate(r.nextDate)].filter(Boolean).join(' '), render: (r) => <>{r.nextAction}{r.nextDate && <div className="small">Hẹn: {fmtDate(r.nextDate)}</div>}</> },
    ...fields.map((f) => ({ k: 'cf_' + f.key, l: f.label, v: (r) => String(customValue(f, r.custom?.[f.key]) ?? '') })),
  ];

  const doExport = () => {
    exportSheets(`HoatDong_${range.from}_${range.to}`, {
      'Hoạt động': rows.map((r) => ({
        Ngày: fmtDate(r.date), 'Nhân viên': staffName(r.ownerEmail), 'Khách hàng': r.customerName,
        ...Object.fromEntries(CUST.map(([, l, fn]) => [l, fn(custOf(r)) || ''])), Loại: r.type,
        'Nội dung': r.content, 'Kết quả': r.result, 'Việc tiếp theo': r.nextAction, 'Hẹn ngày': fmtDate(r.nextDate),
        ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, r.custom?.[f.key])])),
      })),
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>Hoạt động khách hàng</h1>
        <div className="actions">
          <button className="btn" onClick={doExport}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setEdit(blank())}>+ Ghi hoạt động</button>
        </div>
      </div>
      <FilterBar range={range} setRange={setRange} staff={staff} setStaff={setStaff}>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tất cả loại</option>
          {config.activityTypes.map((t) => <option key={t}>{t}</option>)}
        </select>
      </FilterBar>
      <ErrorBox error={error} />
      <ColumnTable id="activities" columns={columns} rows={rows} noExport empty="Chưa có dữ liệu"
        actions={(r) => (isAdmin || r.ownerEmail === email) && <>
          <button className="btn sm" onClick={() => setEdit(r)}>Sửa</button>{' '}
          <button className="btn sm danger" onClick={() => confirmDelete() && removeDoc('activities', r.id)}>Xóa</button>
        </>} />
      {edit && <ActivityForm initial={edit} onClose={() => setEdit(null)} profile={profile} config={config} fields={fields} />}
    </>
  );
}

export function ActivityForm({ initial, onClose, profile, config, fields }) {
  const [f, setF] = useState({ ...blank(), ...initial, custom: initial.custom || {} });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const cust = await ensureCustomer(f, profile);
      const { id, ownerEmail, ownerName, createdAt, createdBy, updatedAt, updatedBy, ...rest } = f;
      await saveDoc('activities', id, { ...rest, ...cust }, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <Modal title={f.id ? 'Sửa hoạt động' : 'Ghi hoạt động mới'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Ngày" required><input type="date" value={f.date} onChange={set('date')} required /></Field>
          <Field label="Loại hoạt động" required>
            <select value={f.type} onChange={set('type')} required>
              <option value="">-- Chọn --</option>
              {config.activityTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Khách hàng" required full>
            <CustomerPicker value={f} onChange={(c) => setF({ ...f, ...c })} required />
          </Field>
          <Field label="Nội dung" full><textarea rows={2} value={f.content} onChange={set('content')} placeholder="VD: Gọi chào giá PP T30S, khách đang dùng hàng Hàn Quốc…" /></Field>
          <Field label="Kết quả" full><textarea rows={2} value={f.result} onChange={set('result')} /></Field>
          <Field label="Việc tiếp theo"><input value={f.nextAction} onChange={set('nextAction')} /></Field>
          <Field label="Hẹn ngày"><input type="date" value={f.nextDate} onChange={set('nextDate')} /></Field>
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

import { useMemo, useRef, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { removeDoc, saveDoc } from '../lib/data';
import { CUSTOMER_TYPE_HINT, CUSTOMER_TYPES, fmtDate, norm, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, detectHeaderRow, guessMapping, readWorkbook, sheetRows, toNumber } from '../lib/excelImport';
import { useCustomers } from '../components/CustomerPicker';
import AddFieldButton from '../components/AddFieldButton';
import { confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, Modal, Stat } from '../components/ui';

const STAGES = ['Tiềm năng', 'Đang chăm sóc', 'Đang giao dịch', 'Ngừng giao dịch'];
const TONE = { 'Tiềm năng': 'amber', 'Đang chăm sóc': 'blue', 'Đang giao dịch': 'green', 'Ngừng giao dịch': 'red' };
const TYPE_TONE = { 'Khách cũ': 'green', 'Khách mới': 'amber' };
const blank = () => ({
  code: '', name: '', customerType: 'Khách mới', contact: '', phone: '', email: '', address: '', taxCode: '', source: '',
  stage: 'Tiềm năng', productsUsed: '', monthlyVolume: '', note: '', custom: {}, createdDate: today(),
});

// Cột Excel chuẩn (dùng cho xuất và nhập lại)
const COLS = [
  ['id', 'ID hệ thống', ['id he thong', 'id']],
  ['ownerEmail', 'Email NV phụ trách', ['email nv phu trach', 'email sale', 'email nhan vien']],
  ['ownerName', 'Tên NV phụ trách', ['ten nv phu trach', 'nv phu trach', 'nhan vien phu trach', 'sale phu trach', 'nhan vien']],
  ['code', 'Mã KH', ['ma kh', 'ma khach hang', 'ma doi tuong']],
  ['name', 'Tên KH', ['ten kh', 'ten khach hang', 'ten cong ty', 'ten doi tuong', 'khach hang', 'ten']],
  ['customerType', 'Loại KH (Khách cũ/Khách mới)', ['loai kh', 'loai khach hang', 'khach cu moi']],
  ['contact', 'Người liên hệ', ['nguoi lien he', 'lien he']],
  ['phone', 'SĐT', ['sdt', 'so dien thoai', 'dien thoai', 'phone', 'mobile']],
  ['email', 'Email KH', ['email kh', 'email khach hang', 'email']],
  ['address', 'Địa chỉ', ['dia chi', 'address']],
  ['taxCode', 'MST', ['mst', 'ma so thue']],
  ['source', 'Nguồn', ['nguon', 'nguon khach']],
  ['stage', 'Giai đoạn', ['giai doan']],
  ['productsUsed', 'Loại hạt đang dùng', ['loai hat dang dung', 'san pham dang dung', 'loai hat']],
  ['monthlyVolume', 'Sản lượng/tháng (tấn)', ['san luong thang', 'san luong']],
  ['note', 'Ghi chú', ['ghi chu', 'note']],
];

function toType(v, fallback = 'Khách mới') {
  const s = norm(v);
  if (!s) return fallback;
  if (s.includes('cu') || s.includes('da ban') || s.includes('old')) return 'Khách cũ';
  return 'Khách mới';
}

export default function Customers() {
  const { email, isAdmin, config, staffList, staffName } = useApp();
  const [staff, setStaff] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [ctype, setCtype] = useState('');
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const fields = config.customFields.customers || [];
  const { data, error } = useCustomers(staff);
  const s = norm(search);
  const rows = data
    .filter((c) => (!stage || c.stage === stage) && (!ctype || (c.customerType || 'Khách mới') === ctype)
      && (!s || [c.name, c.code, c.contact, c.phone, c.taxCode].some((v) => norm(v).includes(s))))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const cnt = useMemo(() => ({
    all: data.length,
    old: data.filter((c) => c.customerType === 'Khách cũ').length,
    fresh: data.filter((c) => (c.customerType || 'Khách mới') === 'Khách mới').length,
  }), [data]);

  const doExport = () => exportSheets(`KhachHang_${today()}`, {
    'Khách hàng': rows.map((c) => ({
      'ID hệ thống': c.id, 'Email NV phụ trách': c.ownerEmail, 'Tên NV phụ trách': staffName(c.ownerEmail),
      'Mã KH': c.code || '', 'Tên KH': c.name, 'Loại KH (Khách cũ/Khách mới)': c.customerType || 'Khách mới',
      'Người liên hệ': c.contact, SĐT: c.phone, 'Email KH': c.email, 'Địa chỉ': c.address, MST: c.taxCode,
      Nguồn: c.source, 'Giai đoạn': c.stage, 'Loại hạt đang dùng': c.productsUsed, 'Sản lượng/tháng (tấn)': c.monthlyVolume,
      'Ghi chú': c.note, 'Ngày tạo': fmtDate(c.createdDate),
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, c.custom?.[f.key])])),
    })),
    'Danh sách NV (tham khảo)': staffList.filter((x) => x.active !== false).map((x) => ({ 'Họ tên': x.name, Email: x.email, 'Vai trò': x.role === 'admin' ? 'Quản trị' : 'Sale' })),
  });

  const doTemplate = () => exportSheets('Mau_nhap_khach_hang', {
    'Khách hàng': [{
      'ID hệ thống': '', 'Email NV phụ trách': staffList.find((x) => x.role !== 'admin')?.email || 'sale@congty.com', 'Tên NV phụ trách': '',
      'Mã KH': 'KH001', 'Tên KH': 'Công ty TNHH Nhựa ABC', 'Loại KH (Khách cũ/Khách mới)': 'Khách mới', 'Người liên hệ': 'Anh Nam',
      SĐT: '0909xxxxxx', 'Email KH': '', 'Địa chỉ': 'KCN ...', MST: '', Nguồn: '', 'Giai đoạn': 'Tiềm năng',
      'Loại hạt đang dùng': 'PP, HDPE', 'Sản lượng/tháng (tấn)': 20, 'Ghi chú': '',
      ...Object.fromEntries(fields.map((f) => [f.label, ''])),
    }],
    'Danh sách NV (tham khảo)': staffList.map((x) => ({ 'Họ tên': x.name, Email: x.email })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Khách hàng <span className="small">({rows.length})</span></h1>
        <div className="actions">
          <button className="btn" onClick={doTemplate}>File mẫu</button>
          <button className="btn" onClick={() => setImporting(true)}>⬆ Nhập Excel</button>
          <button className="btn" onClick={doExport}>⬇ Xuất Excel{isAdmin ? ' (phân bổ)' : ''}</button>
          <button className="btn primary" onClick={() => setEdit(blank())}>+ Thêm khách hàng</button>
        </div>
      </div>
      {isAdmin && (
        <p className="small">
          Phân bổ khách cho sale: <b>Xuất Excel</b> → điền cột <b>Email NV phụ trách</b> (xem sheet "Danh sách NV") → <b>Nhập Excel</b> lại.
          Dòng có "ID hệ thống" sẽ được cập nhật, dòng không có ID sẽ tạo khách mới (tự nhận diện trùng theo Mã KH, MST hoặc tên).
        </p>
      )}
      <div className="stats">
        <Stat label="Tổng khách hàng" value={cnt.all} />
        <Stat label="Khách cũ (đã bán)" value={cnt.old} tone="green" />
        <Stat label="Khách mới (đang chào)" value={cnt.fresh} tone="amber" />
      </div>
      <div className="filters">
        <input placeholder="Tìm tên, mã KH, SĐT, MST…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={ctype} onChange={(e) => setCtype(e.target.value)}>
          <option value="">Khách cũ + mới</option>{CUSTOMER_TYPES.map((x) => <option key={x}>{x}</option>)}
        </select>
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
            <thead><tr><th>Mã KH</th><th>Khách hàng</th><th>Loại</th><th>Liên hệ</th><th>Giai đoạn</th><th>Đang dùng</th>{isAdmin && <th>Phụ trách</th>}
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{c.code}</td>
                  <td><b>{c.name}</b>{c.address && <div className="small">{c.address}</div>}</td>
                  <td><span className={'badge ' + TYPE_TONE[c.customerType || 'Khách mới']} title={CUSTOMER_TYPE_HINT[c.customerType || 'Khách mới']}>{c.customerType || 'Khách mới'}</span></td>
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
      {importing && <ImportCustomers existing={data} onClose={() => setImporting(false)} />}
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
      if (isAdmin && !id && rest.ownerEmail === undefined) delete rest.ownerEmail;
      await saveDoc('customers', id, rest, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Modal title={f.id ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên khách hàng / công ty" required full><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Mã KH (theo phần mềm kế toán)"><input value={f.code} onChange={set('code')} /></Field>
          <Field label="Loại khách hàng">
            <select value={f.customerType} onChange={set('customerType')}>
              {CUSTOMER_TYPES.map((x) => <option key={x} value={x}>{x} – {CUSTOMER_TYPE_HINT[x]}</option>)}
            </select>
          </Field>
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
          {isAdmin && (
            <Field label="Nhân viên phụ trách">
              <select value={f.ownerEmail || profile.email} onChange={set('ownerEmail')}>
                {!staffList.some((x) => x.email === profile.email) && <option value={profile.email}>{profile.name} (tôi)</option>}
                {staffList.map((x) => <option key={x.email} value={x.email}>{x.name || x.email}</option>)}
              </select>
            </Field>
          )}
          <Field label="Ghi chú" full><textarea rows={2} value={f.note} onChange={set('note')} /></Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        <div style={{ marginTop: 10 }}><AddFieldButton module="customers" label="+ Thêm trường cho khách hàng" /></div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportCustomers({ existing, onClose }) {
  const { email, isAdmin, profile, config, staffList } = useApp();
  const fields = config.customFields.customers || [];
  const fileRef = useRef();
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const parse = async (file) => {
    setErr(''); setPlan(null); setDone('');
    try {
      const wb = await readWorkbook(file);
      const rows = sheetRows(wb);
      const hr = detectHeaderRow(rows, ['ten', 'ma', 'sdt', 'dien thoai', 'email', 'khach', 'mst']);
      const headers = rows[hr].map(cellText);
      const map = guessMapping(headers, COLS.map(([key, label, aliases]) => ({ key, aliases: [label, ...aliases] })));
      const customMap = {};
      fields.forEach((f) => { const i = headers.findIndex((h) => norm(h) === norm(f.label)); if (i >= 0) customMap[f.key] = i; });
      if (map.name === undefined) throw new Error('Không tìm thấy cột "Tên KH" trong file. Hãy dùng File mẫu.');

      const byId = new Map(existing.map((c) => [c.id, c]));
      const byCode = new Map(existing.filter((c) => c.code).map((c) => [norm(c.code), c]));
      const byTax = new Map(existing.filter((c) => c.taxCode).map((c) => [norm(c.taxCode), c]));
      const byName = new Map(existing.map((c) => [norm(c.name), c]));
      const staffByEmail = new Map(staffList.map((x) => [x.email.toLowerCase(), x]));
      const staffByName = new Map(staffList.map((x) => [norm(x.name), x]));

      const items = [];
      rows.slice(hr + 1).forEach((r, i) => {
        const get = (k) => (map[k] === undefined ? '' : cellText(r[map[k]]));
        const name = get('name');
        if (!name) return;
        const found = byId.get(get('id')) || (get('code') && byCode.get(norm(get('code')))) || (get('taxCode') && byTax.get(norm(get('taxCode')))) || byName.get(norm(name));
        let owner = found?.ownerEmail || email;
        let problem = '';
        if (isAdmin) {
          const oe = get('ownerEmail').toLowerCase();
          const on = norm(get('ownerName'));
          if (oe && staffByEmail.has(oe)) owner = oe;
          else if (on && staffByName.has(on)) owner = staffByName.get(on).email;
          else if (oe) problem = `Email NV "${oe}" chưa có trong danh sách nhân viên → giữ NV cũ`;
        } else {
          owner = email;
          if (found && found.ownerEmail !== email) problem = 'Khách của NV khác → bỏ qua';
        }
        const data = {};
        COLS.forEach(([k]) => {
          if (['id', 'ownerEmail', 'ownerName'].includes(k) || map[k] === undefined) return;
          const v = get(k);
          if (k === 'customerType') data[k] = toType(v, found?.customerType || 'Khách mới');
          else if (k === 'monthlyVolume') { if (v !== '') data[k] = toNumber(v); }
          else if (v !== '' || !found) data[k] = v;
        });
        if (!found && !data.customerType) data.customerType = 'Khách mới';
        if (!found && !data.stage) data.stage = 'Tiềm năng';
        const custom = { ...(found?.custom || {}) };
        Object.entries(customMap).forEach(([k, idx]) => { const v = cellText(r[idx]); if (v !== '') custom[k] = v; });
        items.push({
          line: hr + i + 2, name, found, owner, problem,
          skip: !isAdmin && found && found.ownerEmail !== email,
          data: { ...data, custom },
        });
      });
      setPlan({ items, headerRow: hr + 1, mapped: Object.keys(map).length + Object.keys(customMap).length });
    } catch (e) { setErr(e.message); }
  };

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const todo = plan.items.filter((x) => !x.skip);
      const nameOf = (e) => staffList.find((x) => x.email === e)?.name || (e === email ? profile.name : e);
      for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        todo.slice(i, i + 400).forEach((x) => {
          const base = { ...x.data, ownerEmail: x.owner, ownerName: nameOf(x.owner), updatedAt: serverTimestamp(), updatedBy: email };
          if (x.found) batch.set(doc(db, 'customers', x.found.id), base, { merge: true });
          else batch.set(doc(collection(db, 'customers')), { ...base, createdDate: today(), createdAt: serverTimestamp(), createdBy: email });
        });
        await batch.commit();
      }
      setDone(`Đã nhập ${todo.length} khách hàng (${todo.filter((x) => !x.found).length} mới, ${todo.filter((x) => x.found).length} cập nhật).`);
      setPlan(null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const nNew = plan?.items.filter((x) => !x.found && !x.skip).length || 0;
  const nUpd = plan?.items.filter((x) => x.found && !x.skip).length || 0;
  const nSkip = plan?.items.filter((x) => x.skip).length || 0;
  const nameOf = (e) => staffList.find((x) => x.email === e)?.name || e;

  return (
    <Modal title="Nhập khách hàng từ Excel" onClose={onClose} wide>
      <p className="small">
        Dùng file xuất từ nút "Xuất Excel" hoặc "File mẫu". Cột bắt buộc: <b>Tên KH</b>.
        {isAdmin ? ' Cột "Email NV phụ trách" (hoặc "Tên NV phụ trách") dùng để phân bổ khách cho sale.' : ' Khách nhập vào sẽ thuộc về bạn.'}
      </p>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && parse(e.target.files[0])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {plan && (
        <>
          <div className="stats" style={{ marginTop: 12 }}>
            <Stat label="Khách mới sẽ tạo" value={nNew} tone="green" />
            <Stat label="Khách sẽ cập nhật" value={nUpd} />
            <Stat label="Bỏ qua" value={nSkip} tone="red" />
          </div>
          <div className="small">Dòng tiêu đề: dòng {plan.headerRow} · Nhận diện {plan.mapped} cột</div>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto', marginTop: 6 }}>
            <table>
              <thead><tr><th>Dòng</th><th>Khách hàng</th><th>Loại</th><th>Thao tác</th><th>NV phụ trách</th><th>Ghi chú</th></tr></thead>
              <tbody>
                {plan.items.slice(0, 300).map((x) => (
                  <tr key={x.line}>
                    <td>{x.line}</td><td>{x.name}</td><td>{x.data.customerType || x.found?.customerType}</td>
                    <td>{x.skip ? <span className="badge red">Bỏ qua</span> : x.found ? <span className="badge blue">Cập nhật</span> : <span className="badge green">Tạo mới</span>}</td>
                    <td>{nameOf(x.owner)}</td>
                    <td className="small">{x.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {plan && <button type="button" className="btn primary" disabled={busy || nNew + nUpd === 0} onClick={run}>{busy ? 'Đang nhập…' : `Nhập ${nNew + nUpd} khách hàng`}</button>}
      </div>
    </Modal>
  );
}

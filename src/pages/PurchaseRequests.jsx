import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { ensureCustomer, removeDoc, saveDoc, scopedQuery } from '../lib/data';
import { addDays, fmtDate, fmtMoney, num, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import CustomerPicker from '../components/CustomerPicker';
import { useProducts } from './Products';
import { confirmDelete, Empty, ErrorBox, Field, Modal, Stat } from '../components/ui';

// ============================================================================
// Yêu cầu mua hàng bổ sung: sale gửi → sếp xử lý. Cảnh báo trên menu, Tổng quan và email cuối ngày.
// ============================================================================
export const PR_PENDING = 'Chờ xử lý';
export const PR_DONE = 'Đã xử lý';

// Mức gấp theo ngày cần giao
export function prUrgency(r, t = today()) {
  if (r.status !== PR_PENDING || !r.deliveryDate) return '';
  if (r.deliveryDate < t) return 'late';
  if (r.deliveryDate <= addDays(t, 2)) return 'soon';
  return '';
}
export const prAmount = (r) => num(r.qty) * num(r.price);

// Yêu cầu đang chờ (admin: tất cả; sale: của mình) — dùng cho số đỏ trên menu và Tổng quan
export function usePendingPurchases() {
  const { email, isAdmin, isAccountant } = useApp();
  const q = useQuery(
    () => (isAccountant || !email ? null
      : isAdmin ? query(collection(db, 'purchaseRequests'), where('status', '==', PR_PENDING))
        : query(collection(db, 'purchaseRequests'), where('ownerEmail', '==', email))),
    [email, isAdmin, isAccountant]
  );
  return useMemo(() => q.data.filter((r) => r.status === PR_PENDING)
    .sort((a, b) => (a.deliveryDate || '9').localeCompare(b.deliveryDate || '9')), [q.data]);
}

export function UrgencyBadge({ r }) {
  const u = prUrgency(r);
  if (u === 'late') return <span className="badge red">Quá ngày giao</span>;
  if (u === 'soon') return <span className="badge amber">Sắp đến ngày giao</span>;
  return null;
}

const TABS = [['pending', 'Chờ xử lý'], ['done', 'Đã xử lý'], ['all', 'Tất cả']];

export default function PurchaseRequests() {
  const { email, isAdmin, staffList, staffName } = useApp();
  const [staff, setStaff] = useState('');
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [handling, setHandling] = useState(null);

  const { data, error } = useQuery(() => scopedQuery('purchaseRequests', { me: email, isAdmin, staffFilter: staff }), [email, isAdmin, staff]);
  const s = search.trim().toLowerCase();
  const all = useMemo(() => [...data].sort((a, b) =>
    (a.status === PR_PENDING ? 0 : 1) - (b.status === PR_PENDING ? 0 : 1)
    || (a.status === PR_PENDING ? (a.deliveryDate || '9').localeCompare(b.deliveryDate || '9') : (b.date || '').localeCompare(a.date || ''))), [data]);
  const rows = all.filter((r) => (tab === 'all' || (tab === 'pending' ? r.status === PR_PENDING : r.status === PR_DONE))
    && (!s || [r.productCode, r.productName, r.customerName, r.note].some((v) => String(v || '').toLowerCase().includes(s))));
  const pending = all.filter((r) => r.status === PR_PENDING);
  const cnt = {
    pending: pending.length,
    late: pending.filter((r) => prUrgency(r) === 'late').length,
    soon: pending.filter((r) => prUrgency(r) === 'soon').length,
    value: pending.reduce((t, r) => t + prAmount(r), 0),
  };

  const blank = () => ({ date: today(), productCode: '', productName: '', qty: '', unit: 'kg', deliveryDate: addDays(today(), 3), customerId: '', customerName: '', price: '', note: '', status: PR_PENDING });

  const doExport = () => exportSheets(`YeuCauMuaHang_${today()}`, {
    'Yêu cầu mua hàng': rows.map((r) => ({
      'Ngày yêu cầu': fmtDate(r.date), 'Nhân viên': staffName(r.ownerEmail), 'Mã hàng': r.productCode, 'Tên hàng': r.productName,
      'Số lượng': num(r.qty), 'Đơn vị': r.unit, 'Ngày cần giao': fmtDate(r.deliveryDate), 'Khách hàng': r.customerName,
      'Đơn giá': num(r.price), 'Thành tiền': prAmount(r), 'Ghi chú': r.note, 'Trạng thái': r.status,
      'Ngày xử lý': fmtDate(r.handledDate), 'Người xử lý': r.handledBy ? staffName(r.handledBy) : '', 'Ghi chú xử lý': r.handledNote || '',
    })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Yêu cầu mua hàng</h1>
        <div className="actions">
          <button className="btn" onClick={doExport} disabled={!rows.length}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setEdit(blank())}>+ Gửi yêu cầu mua hàng</button>
        </div>
      </div>
      <div className="filters">
        <div className="presets">
          {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}{k === 'pending' && cnt.pending ? ` (${cnt.pending})` : ''}</button>)}
        </div>
        <input placeholder="Tìm mã hàng, khách hàng…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {isAdmin && (
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {staffList.filter((x) => x.role !== 'accountant').map((x) => <option key={x.email} value={x.email}>{x.name || x.email}</option>)}
          </select>
        )}
      </div>
      <div className="stats">
        <Stat label="Đang chờ xử lý" value={cnt.pending} tone="amber" onClick={() => setTab('pending')} active={tab === 'pending'} />
        <Stat label="Quá ngày cần giao" value={cnt.late} tone="red" sub="Chưa xử lý mà đã qua ngày giao" />
        <Stat label="Sắp đến ngày giao (≤ 2 ngày)" value={cnt.soon} tone="red" />
        <Stat label="Giá trị đang chờ" value={fmtMoney(cnt.value) + ' đ'} />
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {rows.length === 0 ? <Empty text={tab === 'pending' ? 'Không có yêu cầu nào đang chờ' : 'Chưa có yêu cầu'} /> : (
          <table>
            <thead><tr>
              <th>Ngày YC</th>{isAdmin && <th>Nhân viên</th>}<th>Mã hàng</th><th className="num">Số lượng</th><th>Ngày cần giao</th>
              <th>Khách hàng</th><th className="num">Đơn giá</th><th className="num">Thành tiền</th><th>Trạng thái</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const u = prUrgency(r);
                return (
                  <tr key={r.id} style={u === 'late' ? { background: 'var(--red-soft)' } : u === 'soon' ? { background: 'var(--amber-soft)' } : undefined}>
                    <td className="nowrap">{fmtDate(r.date)}</td>
                    {isAdmin && <td>{staffName(r.ownerEmail)}</td>}
                    <td style={{ minWidth: 160 }}><b>{r.productCode}</b>{r.productName && <div className="small">{r.productName}</div>}
                      {r.note && <div className="small">📝 {r.note}</div>}</td>
                    <td className="num nowrap"><b>{num(r.qty).toLocaleString('vi-VN')}</b> {r.unit}</td>
                    <td className="nowrap">{fmtDate(r.deliveryDate)} <UrgencyBadge r={r} /></td>
                    <td>{r.customerName}</td>
                    <td className="num">{r.price ? fmtMoney(r.price) : '-'}</td>
                    <td className="num">{prAmount(r) ? fmtMoney(prAmount(r)) : '-'}</td>
                    <td>
                      {r.status === PR_DONE
                        ? <><span className="badge green">✔ Đã xử lý</span><div className="small">{fmtDate(r.handledDate)}{r.handledBy ? ' · ' + staffName(r.handledBy) : ''}</div>
                          {r.handledNote && <div className="act-result">→ {r.handledNote}</div>}</>
                        : <span className="badge amber">⏳ Chờ xử lý</span>}
                    </td>
                    <td className="nowrap">
                      {isAdmin && r.status === PR_PENDING && <><button className="btn sm primary" onClick={() => setHandling(r)}>✔ Đã xử lý</button>{' '}</>}
                      {isAdmin && r.status === PR_DONE && <><button className="btn sm" onClick={() => saveDoc('purchaseRequests', r.id, { status: PR_PENDING, handledDate: '', handledBy: '', handledNote: '' }, { email })}>Mở lại</button>{' '}</>}
                      {(isAdmin || (r.ownerEmail === email && r.status === PR_PENDING)) && <><button className="btn sm" onClick={() => setEdit(r)}>Sửa</button>{' '}</>}
                      <button className="btn sm" title="Tạo yêu cầu mới giống dòng này" onClick={() => {
                        const { id, ownerEmail, ownerName, createdAt, createdBy, updatedAt, updatedBy, handledDate, handledBy, handledNote, ...rest } = r;
                        setEdit({ ...rest, date: today(), status: PR_PENDING });
                      }}>Chép</button>{' '}
                      {(isAdmin || (r.ownerEmail === email && r.status === PR_PENDING)) && (
                        <button className="btn sm danger" onClick={() => confirmDelete('Xóa yêu cầu mua hàng này?') && removeDoc('purchaseRequests', r.id)}>Xóa</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {edit && <RequestForm initial={edit} onClose={() => setEdit(null)} />}
      {handling && <HandleForm r={handling} onClose={() => setHandling(null)} />}
    </>
  );
}

function RequestForm({ initial, onClose }) {
  const { profile } = useApp();
  const products = useProducts().data;
  const [f, setF] = useState({ ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sorted = useMemo(() => [...products].sort((a, b) => String(a.code).localeCompare(String(b.code))), [products]);
  const pickCode = (code) => {
    const p = sorted.find((x) => String(x.code).toLowerCase() === code.trim().toLowerCase());
    setF((x) => ({ ...x, productCode: code, productName: p ? p.name || '' : x.productName, unit: p?.unit || x.unit, price: x.price || (p?.price ? num(p.price) : '') }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (f.deliveryDate && f.deliveryDate < f.date) { setErr('Ngày cần giao không được trước ngày yêu cầu.'); return; }
    setBusy(true); setErr('');
    try {
      const cust = await ensureCustomer(f, profile);
      const { id, ownerEmail, ownerName, createdAt, createdBy, updatedAt, updatedBy, ...rest } = f;
      await saveDoc('purchaseRequests', id, { ...rest, ...cust, productCode: rest.productCode.trim(), qty: num(rest.qty), price: rest.price === '' ? '' : num(rest.price) }, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <Modal title={f.id ? 'Sửa yêu cầu mua hàng' : 'Gửi yêu cầu mua hàng bổ sung'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Ngày yêu cầu" required><input type="date" value={f.date} onChange={set('date')} required /></Field>
          <Field label="Ngày cần giao" required><input type="date" value={f.deliveryDate} onChange={set('deliveryDate')} required /></Field>
          <Field label="Mã hàng" required>
            <input list="pr-products" value={f.productCode} onChange={(e) => pickCode(e.target.value)} placeholder="Gõ để tìm mã hàng…" required />
            <datalist id="pr-products">{sorted.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}</datalist>
            {f.productName && <small className="small">{f.productName}</small>}
          </Field>
          <Field label="Số lượng" required>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="any" min="0" value={f.qty} onChange={set('qty')} required style={{ flex: 1 }} />
              <select value={f.unit} onChange={set('unit')} style={{ width: 80 }}>{['kg', 'tấn', 'bao', 'cont'].concat(['kg', 'tấn', 'bao', 'cont'].includes(f.unit) ? [] : [f.unit]).map((u) => <option key={u}>{u}</option>)}</select>
            </div>
          </Field>
          <Field label="Khách hàng" required full><CustomerPicker value={f} onChange={(c) => setF((x) => ({ ...x, ...c }))} required /></Field>
          <Field label="Đơn giá (đ)"><input type="number" step="any" value={f.price} onChange={set('price')} placeholder="Giá bán dự kiến cho khách" /></Field>
          <Field label="Thành tiền"><input value={prAmount(f) ? fmtMoney(prAmount(f)) + ' đ' : ''} readOnly tabIndex={-1} /></Field>
          <Field label="Ghi chú" full><textarea rows={2} value={f.note} onChange={set('note')} placeholder="VD: khách cần gấp, hàng TQ hoặc Hàn đều được…" /></Field>
        </div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>{f.id ? 'Lưu' : 'Gửi yêu cầu'}</button>
        </div>
      </form>
    </Modal>
  );
}

function HandleForm({ r, onClose }) {
  const { profile, staffName } = useApp();
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await saveDoc('purchaseRequests', r.id, { status: PR_DONE, handledDate: date, handledBy: profile.email, handledNote: note.trim() }, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Modal title="Xác nhận đã xử lý yêu cầu mua hàng" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="small">
          <b>{r.productCode}</b> – {num(r.qty).toLocaleString('vi-VN')} {r.unit} cho <b>{r.customerName}</b>, cần giao {fmtDate(r.deliveryDate)} (sale {staffName(r.ownerEmail)}).
        </p>
        <div className="form-grid">
          <Field label="Ngày xử lý"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Ghi chú xử lý (sale sẽ thấy)" full><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: đã đặt NCC A, hàng về 10/10" /></Field>
        </div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>✔ Đã xử lý</button>
        </div>
      </form>
    </Modal>
  );
}

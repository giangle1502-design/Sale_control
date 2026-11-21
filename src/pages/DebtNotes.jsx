import { useEffect, useMemo, useState } from 'react';
import { addDoc, arrayUnion, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { addDays, fmtDate, norm, num, today } from '../lib/utils';
import AddFieldButton from '../components/AddFieldButton';
import ColumnTable from '../components/ColumnTable';
import { confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, FilterBar, Modal, Stat, useRange } from '../components/ui';

// ============================================================================
// Ghi nhận công nợ của sale: sale báo khách thanh toán / khách phản hồi gì.
// Thời gian ghi nhận = thời điểm lưu (máy chủ ghi), không sửa được → báo cáo theo sale, theo ngày.
// ============================================================================

export const DEFAULT_ACTIONS = ['Báo khách hàng thanh toán', 'Gửi bảng đối chiếu công nợ', 'Nhắc hóa đơn quá hạn', 'Khách hẹn thanh toán', 'Khách đã chuyển khoản', 'Khách khiếu nại / chưa đồng ý số liệu', 'Khác'];
const money = (v) => Math.round(num(v)).toLocaleString('en-US');
const atOf = (n) => (n.at?.toDate ? n.at.toDate() : n.atLocal ? new Date(n.atLocal) : null);
const hm = (d) => (d ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const dayOf = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); };
const dt = (d) => (d ? `${fmtDate(dayOf(d))} ${hm(d)}` : '');

// Danh sách "Hành động": mặc định + do mọi người thêm (nút +)
export function useActions() {
  const [extra, setExtra] = useState([]);
  useEffect(() => onSnapshot(doc(db, 'settings', 'debtNoteActions'), (s) => setExtra(s.data()?.list || []), () => {}), []);
  return [...new Set([...DEFAULT_ACTIONS, ...extra])];
}

// Ghi nhận trong phạm vi người dùng: sale → khách của mình; quản trị / kế toán → 90 ngày gần nhất
export function useDebtNotes() {
  const { email, isAdmin, isAccountant } = useApp();
  const all = isAdmin || isAccountant;
  return useQuery(() => (all ? query(collection(db, 'debtNotes'), where('day', '>=', addDays(today(), -90))) : query(collection(db, 'debtNotes'), where('custOwner', '==', email))), [email, all]);
}

// Hành động có ô tìm nhanh + nút "+" thêm lựa chọn mới
function ActionPicker({ value, onChange, actions }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState('');
  const list = actions.filter((a) => !q || norm(a).includes(norm(q)));
  const add = async () => {
    const v = nv.trim(); if (!v) return;
    await setDoc(doc(db, 'settings', 'debtNoteActions'), { list: arrayUnion(v) }, { merge: true }).catch(() => {});
    onChange(v); setNv(''); setAdding(false);
  };
  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="🔍 Tìm nhanh" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 130 }} />
        <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }}>
          <option value="">-- Chọn --</option>
          {list.map((a) => <option key={a} value={a}>{a}</option>)}
          {value && !list.includes(value) && <option value={value}>{value}</option>}
        </select>
        <button type="button" className="btn sm" title="Thêm lựa chọn mới" onClick={() => setAdding(!adding)}>+</button>
      </div>
      {adding && <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><input autoFocus value={nv} onChange={(e) => setNv(e.target.value)} placeholder="Hành động mới" onKeyDown={(e) => e.key === 'Enter' && add()} style={{ flex: 1 }} /><button type="button" className="btn sm primary" onClick={add}>Thêm</button></div>}
    </div>
  );
}

// Ghi nhận cho 1 khách (mở từ thẻ khách ở tab Theo hóa đơn)
export function NoteModal({ c, notes, onClose }) {
  const { email, profile, staffName, config, isAdmin } = useApp();
  const actions = useActions();
  const fields = config.customFields.debtNotes || [];
  const open = c.list.filter((r) => num(r.remaining) > 0);
  const [f, setF] = useState({ action: 'Báo khách hàng thanh toán', content: '', response: '', promiseDate: '', promiseAmount: '', invoices: [], custom: {} });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setF({ ...f, ...p });
  const ck = c.list[0]?.customerKey || '';
  const hist = notes.filter((n) => n.entity === c.entity && n.customerKey === ck).sort((a, b) => (atOf(b) || 0) - (atOf(a) || 0));
  const save = async () => {
    if (!f.action) return setErr('Chọn hành động');
    if (!f.content.trim() && !f.response.trim()) return setErr('Nhập nội dung đã làm hoặc phản hồi của khách');
    const miss = fields.find((x) => x.required && !customValue(x, f.custom?.[x.key]));
    if (miss) return setErr('Nhập ' + miss.label);
    setBusy(true); setErr('');
    try {
      const now = new Date();
      await addDoc(collection(db, 'debtNotes'), {
        entity: c.entity, customerKey: ck, customerName: c.customerName, custOwner: c.ownerEmail || email,
        by: email, byName: profile.name || staffName(email), at: serverTimestamp(), atLocal: now.toISOString(), day: dayOf(now),
        action: f.action, content: f.content.trim(), response: f.response.trim(), promiseDate: f.promiseDate, promiseAmount: num(f.promiseAmount),
        invoices: f.invoices, debtAtNote: c.remaining, lateAtNote: c.late, custom: f.custom || {},
      });
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const tog = (no) => set({ invoices: f.invoices.includes(no) ? f.invoices.filter((x) => x !== no) : [...f.invoices, no] });
  return (
    <Modal title={`📝 Ghi nhận công nợ – ${c.customerName}`} onClose={onClose} wide>
      <p className="small">Còn nợ <b>{money(c.remaining)}</b>{c.late > 0 && <> · quá hạn <b style={{ color: 'var(--red)' }}>{money(c.late)}</b></>}. Thời gian ghi nhận là lúc bấm Lưu (không sửa được) — dùng cho báo cáo theo sale, theo ngày.</p>
      <div className="form-grid">
        <Field label="Hành động" required full><ActionPicker value={f.action} onChange={(v) => set({ action: v })} actions={actions} /></Field>
        <Field label="Khách hẹn thanh toán ngày"><input type="date" value={f.promiseDate} onChange={(e) => set({ promiseDate: e.target.value })} /></Field>
        <Field label="Số tiền khách hẹn trả"><input inputMode="numeric" value={f.promiseAmount ? Number(String(f.promiseAmount).replace(/,/g, '')).toLocaleString('en-US') : ''} onChange={(e) => set({ promiseAmount: e.target.value.replace(/[^\d]/g, '') })} placeholder="0" /></Field>
        <Field label="Sale đã làm gì" full><textarea rows={2} value={f.content} onChange={(e) => set({ content: e.target.value })} placeholder="VD: Gọi điện chị Lan kế toán, gửi bảng đối chiếu qua Zalo, nhắc HĐ 1023 quá hạn…" /></Field>
        <Field label="Phản hồi của khách hàng" full><textarea rows={2} value={f.response} onChange={(e) => set({ response: e.target.value })} placeholder="VD: Khách hẹn chuyển khoản thứ 6, đang chờ sếp duyệt…" /></Field>
        {open.length > 0 && <Field label="Hóa đơn liên quan" full><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{open.map((r) => <label key={r.id || r.invoiceNo} className="nowrap"><input type="checkbox" checked={f.invoices.includes(r.invoiceNo || r.voucher)} onChange={() => tog(r.invoiceNo || r.voucher)} /> {r.invoiceNo || r.voucher} <span className="small">({money(r.remaining)})</span></label>)}</div></Field>}
        <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => set({ custom })} />
      </div>
      <div className="form-actions" style={{ marginTop: 8 }}>
        <AddFieldButton module="debtNotes" label="+ Thêm trường ghi nhận" />
        {err && <span className="error-box" style={{ padding: '4px 8px' }}>{err}</span>}
        <button className="btn primary" disabled={busy} onClick={save}>Lưu ghi nhận</button>
      </div>
      <h3 className="section-title" style={{ marginTop: 14 }}>Lịch sử ghi nhận ({hist.length})</h3>
      {!hist.length ? <p className="small">Chưa có ghi nhận nào.</p> : (
        <div className="table-wrap"><table className="ct-grid">
          <thead><tr><th>Thời gian</th><th>Người ghi</th><th>Hành động</th><th>Sale đã làm</th><th>Phản hồi khách</th><th>Hẹn TT</th><th className="num">Số tiền hẹn</th>{isAdmin && <th />}</tr></thead>
          <tbody>{hist.map((n) => (
            <tr key={n.id}><td className="nowrap">{dt(atOf(n))}</td><td>{n.byName}</td><td>{n.action}</td><td>{n.content}{n.invoices?.length ? <div className="small">HĐ: {n.invoices.join(', ')}</div> : null}</td><td>{n.response}</td><td>{fmtDate(n.promiseDate)}</td><td className="num">{n.promiseAmount ? money(n.promiseAmount) : ''}</td>
              {isAdmin && <td><button className="btn sm" onClick={async () => { if (await confirmDelete('Xóa ghi nhận này?')) deleteDoc(doc(db, 'debtNotes', n.id)); }}>Xóa</button></td>}</tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

// Dòng tóm tắt ghi nhận mới nhất trên thẻ khách
export function LastNote({ notes }) {
  if (!notes.length) return null;
  const n = notes.reduce((a, b) => ((atOf(b) || 0) > (atOf(a) || 0) ? b : a));
  return <div className="small" style={{ marginTop: 4 }}>📝 <b>{dt(atOf(n))}</b> · {n.byName}: {n.action}{n.response ? <> — <i>KH: {n.response}</i></> : n.content ? ` — ${n.content}` : ''}{n.promiseDate ? ` · hẹn TT ${fmtDate(n.promiseDate)}` : ''}</div>;
}

// ----------------------------------------------------------------------------
// Báo cáo: sale đã làm gì, khách phản hồi gì — theo sale, theo ngày
export default function DebtNoteReport({ staffFilter }) {
  const { email, isAdmin, isAccountant, staffName, config } = useApp();
  const all = isAdmin || isAccountant;
  const [range, setRange] = useRange('7 ngày');
  const [staff, setStaff] = useState(staffFilter || '');
  useEffect(() => setStaff(staffFilter || ''), [staffFilter]);
  const fields = config.customFields.debtNotes || [];
  const { data, loading, error } = useQuery(
    () => (all ? query(collection(db, 'debtNotes'), where('day', '>=', range.from)) : query(collection(db, 'debtNotes'), where('by', '==', email))),
    [all, email, range.from]
  );
  const rows = useMemo(() => data.filter((n) => n.day >= range.from && n.day <= range.to && (!staff || n.by === staff)).sort((a, b) => (atOf(b) || 0) - (atOf(a) || 0)), [data, range, staff]);
  // Tổng hợp theo sale × ngày
  const sum = useMemo(() => {
    const m = new Map();
    rows.forEach((n) => {
      const k = n.by + '|' + n.day;
      if (!m.has(k)) m.set(k, { k, by: n.by, byName: n.byName, day: n.day, n: 0, cust: new Set(), promised: 0, debt: 0, resp: 0 });
      const x = m.get(k); x.n++; x.cust.add(n.entity + n.customerKey); x.promised += num(n.promiseAmount); if (n.response) x.resp++;
    });
    return [...m.values()].map((x) => ({ ...x, cust: x.cust.size })).sort((a, b) => b.day.localeCompare(a.day) || String(a.byName).localeCompare(String(b.byName)));
  }, [rows]);
  const promised = rows.reduce((t, n) => t + num(n.promiseAmount), 0);

  const cols = [
    { k: 'at', l: 'Thời gian ghi nhận', v: (n) => dt(atOf(n)) },
    { k: 'day', l: 'Ngày', v: (n) => fmtDate(n.day) },
    { k: 'by', l: 'Sale', v: (n) => n.byName || staffName(n.by) },
    { k: 'entity', l: 'Pháp nhân', v: (n) => n.entity },
    { k: 'cust', l: 'Khách hàng', v: (n) => n.customerName },
    { k: 'action', l: 'Hành động', v: (n) => n.action },
    { k: 'content', l: 'Sale đã làm', v: (n) => n.content },
    { k: 'response', l: 'Phản hồi khách hàng', v: (n) => n.response },
    { k: 'inv', l: 'Hóa đơn', v: (n) => (n.invoices || []).join(', ') },
    { k: 'pdate', l: 'Hẹn thanh toán', v: (n) => fmtDate(n.promiseDate) },
    { k: 'pamt', l: 'Số tiền hẹn', v: (n) => num(n.promiseAmount), num: true, render: (n) => (num(n.promiseAmount) ? money(n.promiseAmount) : '') },
    { k: 'debt', l: 'Còn nợ lúc ghi', v: (n) => num(n.debtAtNote), num: true },
    { k: 'late', l: 'Quá hạn lúc ghi', v: (n) => num(n.lateAtNote), num: true },
    ...fields.map((f) => ({ k: 'cf_' + f.key, l: f.label, v: (n) => customValue(f, n.custom?.[f.key]) })),
  ];
  return (
    <>
      <FilterBar range={range} setRange={setRange} staff={staff} setStaff={all ? setStaff : undefined} />
      <ErrorBox error={error} />
      <div className="stats">
        <Stat label="Số lần ghi nhận" value={rows.length.toLocaleString('en-US')} />
        <Stat label="Số khách đã liên hệ" value={new Set(rows.map((n) => n.entity + n.customerKey)).size.toLocaleString('en-US')} />
        <Stat label="Có phản hồi của khách" value={rows.filter((n) => n.response).length.toLocaleString('en-US')} tone="green" />
        <Stat label="Tiền khách hẹn trả" value={money(promised)} tone="amber" />
      </div>
      {loading ? <p className="small">Đang tải…</p> : !rows.length ? <Empty text="Chưa có ghi nhận trong khoảng ngày này" /> : (
        <>
          <h3 className="section-title">Tổng hợp theo sale, theo ngày</h3>
          <div className="table-wrap" style={{ marginBottom: 14 }}><table className="ct-grid">
            <thead><tr><th>Ngày</th><th>Sale</th><th className="num">Số ghi nhận</th><th className="num">Số khách</th><th className="num">Có phản hồi</th><th className="num">Tiền hẹn trả</th></tr></thead>
            <tbody>{sum.map((x) => <tr key={x.k}><td>{fmtDate(x.day)}</td><td>{x.byName || staffName(x.by)}</td><td className="num">{x.n}</td><td className="num">{x.cust}</td><td className="num">{x.resp}</td><td className="num">{money(x.promised)}</td></tr>)}</tbody>
          </table></div>
          <h3 className="section-title">Chi tiết ghi nhận</h3>
          <ColumnTable id="debtNotes" columns={cols} rows={rows} exportName="NhatKy_CongNo" empty="Không có dòng phù hợp" />
        </>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db, SUPER_ADMINS } from '../firebase';
import { useApp } from '../context/AppContext';
import { confirmDelete, Empty, Field, Modal } from '../components/ui';

const MAIN = [['customers', 'Khách hàng'], ['receivables', 'Công nợ (kế toán)']];
const HISTORY = [['activities', 'Hoạt động'], ['quotes', 'Báo giá'], ['orders', 'Đơn hàng'], ['payments', 'Thu tiền'], ['tasks', 'Việc được giao'], ['dailyNotes', 'Báo cáo tuần/tháng']];

const blank = { email: '', name: '', phone: '', role: 'sale', active: true };

export default function Staff() {
  const { staffList } = useApp();
  const [edit, setEdit] = useState(null);
  const [transfer, setTransfer] = useState(false);
  return (
    <>
      <div className="page-head">
        <h1>Nhân viên</h1>
        <div className="actions">
          <button className="btn" onClick={() => setTransfer(true)}>🔁 Chuyển dữ liệu</button>
          <button className="btn primary" onClick={() => setEdit({ ...blank })}>+ Thêm nhân viên</button>
        </div>
      </div>
      <p className="small">
        Thêm email của nhân viên tại đây. Nhân viên mở link ứng dụng → "Đăng nhập bằng Google" (nếu là Gmail) hoặc "Đăng ký" để tự đặt mật khẩu với đúng email đó.
        Email quản trị gốc: {SUPER_ADMINS.join(', ') || '(chưa cấu hình)'}.
      </p>
      <div className="table-wrap">
        {staffList.length === 0 ? <Empty text="Chưa có nhân viên" /> : (
          <table>
            <thead><tr><th>Họ tên</th><th>Email</th><th>SĐT</th><th>Vai trò</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.email}>
                  <td><b>{s.name}</b></td><td>{s.email}</td><td>{s.phone}</td>
                  <td><span className={'badge ' + (s.role === 'admin' ? 'amber' : s.role === 'accountant' ? 'green' : 'blue')}>{s.role === 'admin' ? 'Quản trị' : s.role === 'accountant' ? 'Kế toán' : 'Sale'}</span></td>
                  <td>{s.active !== false ? <span className="badge green">Đang làm</span> : <span className="badge red">Đã khóa</span>}</td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => setEdit({ ...blank, ...s, _existing: true })}>Sửa</button>{' '}
                    <button className="btn sm danger" onClick={() => confirmDelete('Xóa nhân viên? (Dữ liệu đã nhập vẫn giữ. Nên dùng "Khóa" thay vì xóa.)') && deleteDoc(doc(db, 'staff', s.email))}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <StaffForm initial={edit} onClose={() => setEdit(null)} />}
      {transfer && <TransferData onClose={() => setTransfer(false)} />}
    </>
  );
}

function StaffForm({ initial, onClose }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const email = f.email.trim().toLowerCase();
      await setDoc(doc(db, 'staff', email), {
        name: f.name.trim(), phone: f.phone || '', role: f.role, active: !!f.active, updatedAt: serverTimestamp(),
      }, { merge: true });
      onClose();
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <Modal title={initial._existing ? 'Sửa nhân viên' : 'Thêm nhân viên'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Email đăng nhập" required><input type="email" value={f.email} onChange={set('email')} required disabled={initial._existing} /></Field>
          <Field label="Họ tên" required><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Số điện thoại"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Vai trò">
            <select value={f.role} onChange={set('role')}>
              <option value="sale">Nhân viên sale (chỉ thấy dữ liệu của mình)</option>
              <option value="admin">Quản trị (thấy tất cả)</option>
              <option value="accountant">Kế toán (chỉ xem và nhập công nợ)</option>
            </select>
          </Field>
          <Field label="Đang làm việc (bỏ tick để khóa tài khoản)"><input type="checkbox" checked={f.active} onChange={set('active')} /></Field>
        </div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary">Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

// Chuyển toàn bộ dữ liệu đang đứng tên một email sang nhân viên khác
function TransferData({ onClose }) {
  const { staffList, profile } = useApp();
  const [owners, setOwners] = useState(null); // { email: { customers, receivables } }
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [withHistory, setWithHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const known = new Set(staffList.map((s) => s.email));
  const nameOf = (e) => staffList.find((s) => s.email === e)?.name || '';

  const load = async () => {
    setErr('');
    try {
      const m = {};
      for (const [c] of [...MAIN, ...HISTORY]) {
        const snap = await getDocs(collection(db, c));
        snap.forEach((d) => {
          const e = d.data().ownerEmail || '';
          if (!e) return;
          m[e] = m[e] || { customers: 0, receivables: 0, history: 0 };
          if (c === 'customers' || c === 'receivables') m[e][c] += 1; else m[e].history += 1;
        });
      }
      setOwners(m);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  // Email không còn trong danh sách NV → mặc định chuyển cả lịch sử
  useEffect(() => { if (from) setWithHistory(!known.has(from)); }, [from]);

  const run = async () => {
    if (!from || !to || from === to) return;
    if (!window.confirm(`Chuyển dữ liệu của ${from} sang ${nameOf(to) || to} (${to})?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const colls = [...MAIN, ...(withHistory ? HISTORY : [])];
      const done = [];
      for (const [c, label] of colls) {
        const snap = await getDocs(query(collection(db, c), where('ownerEmail', '==', from)));
        for (let i = 0; i < snap.docs.length; i += 400) {
          const b = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { ownerEmail: to, ownerName: nameOf(to), updatedAt: serverTimestamp(), updatedBy: profile.email }));
          await b.commit();
        }
        if (snap.size) done.push(`${snap.size} ${label.toLowerCase()}`);
      }
      setMsg(done.length ? `Đã chuyển: ${done.join(', ')}.` : 'Không có dữ liệu nào đứng tên email này.');
      setFrom('');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const rows = owners ? Object.entries(owners).sort((a, b) => (known.has(a[0]) - known.has(b[0])) || b[1].customers - a[1].customers || b[1].history - a[1].history) : [];
  return (
    <Modal title="Chuyển dữ liệu giữa nhân viên" onClose={onClose} wide>
      <p className="small">
        Dữ liệu được gắn theo <b>email</b> người phụ trách. Khi đổi email của sale hoặc bàn giao khách cho người khác,
        dùng chức năng này để chuyển khách hàng và công nợ sang email mới.
      </p>
      <div className="section-title">Email đang giữ dữ liệu</div>
      <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
        {!owners ? <Empty text="Đang tải…" /> : rows.length === 0 ? <Empty /> : (
          <table>
            <thead><tr><th>Email</th><th>Nhân viên</th><th className="num">Khách hàng</th><th className="num">Dòng công nợ</th><th className="num">Hoạt động, báo giá, đơn, việc, báo cáo</th><th></th></tr></thead>
            <tbody>
              {rows.map(([e, c]) => (
                <tr key={e} style={from === e ? { background: 'var(--primary-soft)' } : undefined}>
                  <td>{e}</td>
                  <td>{known.has(e) ? nameOf(e) : <span className="badge red">Không có trong danh sách NV</span>}</td>
                  <td className="num">{c.customers}</td>
                  <td className="num">{c.receivables}</td>
                  <td className="num">{c.history}</td>
                  <td><button type="button" className="btn sm" onClick={() => setFrom(e)}>Chọn</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Từ email">
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">-- Chọn --</option>
            {rows.map(([e]) => <option key={e} value={e}>{e}{nameOf(e) ? ' – ' + nameOf(e) : ''}</option>)}
          </select>
        </Field>
        <Field label="Sang nhân viên">
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">-- Chọn --</option>
            {staffList.filter((s) => s.active !== false).map((s) => <option key={s.email} value={s.email}>{s.name} ({s.email})</option>)}
          </select>
        </Field>
        <Field label="Chuyển cả lịch sử (hoạt động, báo giá, đơn hàng, thu tiền, việc được giao)" full>
          <label><input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} /> Có – dùng khi là cùng một người chỉ đổi email</label>
        </Field>
      </div>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="ok-box">{msg}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        <button type="button" className="btn primary" disabled={busy || !from || !to || from === to} onClick={run}>{busy ? 'Đang chuyển…' : 'Chuyển dữ liệu'}</button>
      </div>
    </Modal>
  );
}

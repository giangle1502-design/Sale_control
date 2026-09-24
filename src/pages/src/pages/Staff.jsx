import { useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, SUPER_ADMINS } from '../firebase';
import { useApp } from '../context/AppContext';
import { confirmDelete, Empty, Field, Modal } from '../components/ui';

const blank = { email: '', name: '', phone: '', role: 'sale', active: true };

export default function Staff() {
  const { staffList } = useApp();
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="page-head">
        <h1>Nhân viên</h1>
        <button className="btn primary" onClick={() => setEdit({ ...blank })}>+ Thêm nhân viên</button>
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
                  <td><span className={'badge ' + (s.role === 'admin' ? 'amber' : 'blue')}>{s.role === 'admin' ? 'Quản trị' : 'Sale'}</span></td>
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

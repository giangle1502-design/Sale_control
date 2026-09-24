import { useState } from 'react';
import { arrayUnion, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { slugKey } from '../lib/utils';
import { Field, Modal } from './ui';

export const FIELD_TYPES = [['text', 'Chữ'], ['textarea', 'Đoạn văn'], ['number', 'Số'], ['date', 'Ngày'], ['select', 'Danh sách chọn'], ['checkbox', 'Có/Không']];

// Nút "+ Thêm trường/cột" ngay trong form — chỉ quản trị thấy; lưu vào Cài đặt dùng chung
export default function AddFieldButton({ module, label = '+ Thêm trường', onAdded }) {
  const { isAdmin } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ label: '', type: 'text', options: '', required: false });
  const [err, setErr] = useState('');
  if (!isAdmin) return null;

  const save = async () => {
    if (!f.label.trim()) return setErr('Nhập tên trường');
    const field = {
      key: slugKey(f.label), label: f.label.trim(), type: f.type, required: !!f.required,
      options: f.type === 'select' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
    };
    try {
      await setDoc(doc(db, 'settings', 'config'), { customFields: { [module]: arrayUnion(field) } }, { merge: true });
      onAdded?.(field);
      setF({ label: '', type: 'text', options: '', required: false });
      setOpen(false);
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Modal title={label.replace('+ ', '')} onClose={() => setOpen(false)}>
          <div className="form-grid">
            <Field label="Tên trường / cột" required full>
              <input autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="VD: Lot, Nhà sản xuất, Xuất xứ…" />
            </Field>
            <Field label="Kiểu dữ liệu">
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {FIELD_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Bắt buộc nhập">
              <input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />
            </Field>
            {f.type === 'select' && (
              <Field label="Các lựa chọn (cách nhau dấu phẩy)" full>
                <input value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
              </Field>
            )}
          </div>
          <p className="small">Trường mới áp dụng cho tất cả nhân viên. Sửa/xóa trong mục Cài đặt.</p>
          {err && <div className="error-box">{err}</div>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>Hủy</button>
            <button type="button" className="btn primary" onClick={save}>Thêm</button>
          </div>
        </Modal>
      )}
    </>
  );
}

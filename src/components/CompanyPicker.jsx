import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { norm } from '../lib/utils';

// Danh sách công ty (pháp nhân) đứng tên trên báo giá. Lưu ở settings/companies { list: [...] }.
export const DEFAULT_COMPANIES = [
  { code: 'VAP', name: 'CÔNG TY TNHH VIỆT AN PHA', taxCode: '3702210726', address: 'Số 34 Đường D17A, Khu TĐC Mỹ Phước I mở rộng, Phường Thới Hòa, TP HCM', phone: '' },
  { code: 'PLA', name: 'CÔNG TY TNHH PLASTIC VIỆT NAM', taxCode: '0316285785', address: 'Số A7 Khu dân cư ấp Mới 1, đường Liên xã Tân Xuân - Trung Chánh, Xã Hóc Môn, Thành phố Hồ Chí Minh, Việt Nam', phone: '' },
  { code: 'DAM', name: 'CÔNG TY CỔ PHẦN HÓA CHẤT DIAMOND', taxCode: '1102005337', address: 'Thửa đất số 159, Tờ bản đồ số 8, Lô A215a, Đường số 2, KCN Thái Hoà, Xã Đức Lập, Tỉnh Tây Ninh, Việt Nam', phone: '' },
];

export function useCompanies() {
  const [list, setList] = useState(DEFAULT_COMPANIES);
  useEffect(() => onSnapshot(doc(db, 'settings', 'companies'), (s) => {
    const saved = s.data()?.list;
    setList(Array.isArray(saved) && saved.length ? saved : DEFAULT_COMPANIES);
  }, () => {}), []);
  return list;
}

export const saveCompanies = (list) => setDoc(doc(db, 'settings', 'companies'), { list }, { merge: true });
export const companyOf = (list, code) => list.find((c) => c.code === code) || null;

const LS = 'quote.company';
export const lastCompany = () => { try { return localStorage.getItem(LS) || ''; } catch { return ''; } };
export const rememberCompany = (code) => { try { localStorage.setItem(LS, code); } catch { /* bỏ qua */ } };

const blankCo = () => ({ code: '', name: '', taxCode: '', address: '', phone: '' });

// Ô chọn công ty: tìm nhanh + chọn + nút "+" thêm / ✎ sửa (quản trị)
export default function CompanyPicker({ value, onChange, required }) {
  const { isAdmin } = useApp();
  const list = useCompanies();
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const shown = list.filter((c) => !q || norm(`${c.code} ${c.name} ${c.taxCode}`).includes(norm(q)));
  const cur = companyOf(list, value);

  const save = async () => {
    const c = { ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() };
    if (!c.code || !c.name) return setErr('Nhập mã và tên công ty');
    const editing = form._old;
    if (!editing && list.some((x) => x.code === c.code)) return setErr('Mã công ty đã có');
    delete c._old;
    const next = editing ? list.map((x) => (x.code === editing ? c : x)) : [...list, c];
    try { await saveCompanies(next); onChange(c.code); setForm(null); setErr(''); } catch (e) { setErr(e.message); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="🔍 Tìm" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 90 }} />
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} style={{ flex: 1 }}>
          <option value="">-- Chọn công ty --</option>
          {shown.map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
          {value && !shown.some((c) => c.code === value) && <option value={value}>{value}</option>}
        </select>
        {isAdmin && <button type="button" className="btn sm" title="Thêm công ty" onClick={() => { setForm(blankCo()); setErr(''); }}>+</button>}
        {isAdmin && cur && <button type="button" className="btn sm" title="Sửa thông tin công ty" onClick={() => { setForm({ ...blankCo(), ...cur, _old: cur.code }); setErr(''); }}>✎</button>}
      </div>
      {cur && <div className="small" style={{ marginTop: 4 }}>MST: {cur.taxCode || '—'} · {cur.address || 'chưa có địa chỉ'}</div>}
      {form && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 6, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input placeholder="Mã (VD: VAP)" value={form.code} onChange={set('code')} style={{ width: 110 }} />
            <input placeholder="Tên công ty" value={form.name} onChange={set('name')} style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input placeholder="MST" value={form.taxCode} onChange={set('taxCode')} style={{ width: 140 }} />
            <input placeholder="Điện thoại" value={form.phone} onChange={set('phone')} style={{ width: 140 }} />
          </div>
          <input placeholder="Địa chỉ" value={form.address} onChange={set('address')} />
          {err && <div className="error-box">{err}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn sm" onClick={() => setForm(null)}>Hủy</button>
            <button type="button" className="btn sm primary" onClick={save}>Lưu công ty</button>
          </div>
        </div>
      )}
    </div>
  );
}

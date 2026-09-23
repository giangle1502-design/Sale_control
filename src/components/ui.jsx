import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { addDays, monthStart, today } from '../lib/utils';

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, required, children, full }) {
  return (
    <label className={'field' + (full ? ' full' : '')}>
      <span>{label}{required && <b className="req"> *</b>}</span>
      {children}
    </label>
  );
}

// Nhập các trường tùy chỉnh do admin định nghĩa
export function CustomFieldInputs({ fields = [], value = {}, onChange }) {
  if (!fields.length) return null;
  const set = (k, v) => onChange({ ...value, [k]: v });
  return fields.map((f) => (
    <Field key={f.key} label={f.label} required={f.required} full={f.type === 'textarea'}>
      {f.type === 'select' ? (
        <select value={value[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
          <option value="">-- Chọn --</option>
          {(f.options || []).map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : f.type === 'checkbox' ? (
        <input type="checkbox" checked={!!value[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
      ) : f.type === 'textarea' ? (
        <textarea rows={2} value={value[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} required={f.required} />
      ) : (
        <input
          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
          step="any"
          value={value[f.key] ?? ''}
          onChange={(e) => set(f.key, e.target.value)}
          required={f.required}
        />
      )}
    </Field>
  ));
}

export function customValue(f, v) {
  if (f.type === 'checkbox') return v ? '✓' : '';
  return v ?? '';
}

const PRESETS = [
  ['Hôm nay', () => [today(), today()]],
  ['Hôm qua', () => [addDays(today(), -1), addDays(today(), -1)]],
  ['7 ngày', () => [addDays(today(), -6), today()]],
  ['Tháng này', () => [monthStart(), today()]],
  ['Tháng trước', () => {
    const end = addDays(monthStart(), -1);
    return [monthStart(end), end];
  }],
];

export function useRange(initial = 'Tháng này') {
  const p = PRESETS.find((x) => x[0] === initial)[1]();
  const [range, setRange] = useState({ from: p[0], to: p[1] });
  return [range, setRange];
}

export function FilterBar({ range, setRange, staff, setStaff, children }) {
  const { isAdmin, staffList } = useApp();
  return (
    <div className="filters">
      <div className="presets">
        {PRESETS.map(([label, fn]) => {
          const [f, t] = fn();
          return (
            <button key={label} className={'chip' + (range.from === f && range.to === t ? ' on' : '')}
              onClick={() => setRange({ from: f, to: t })}>{label}</button>
          );
        })}
      </div>
      <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      <span>→</span>
      <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      {isAdmin && setStaff && (
        <select value={staff} onChange={(e) => setStaff(e.target.value)}>
          <option value="">Tất cả nhân viên</option>
          {staffList.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
        </select>
      )}
      {children}
    </div>
  );
}

export function Empty({ text = 'Chưa có dữ liệu' }) {
  return <div className="empty">{text}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  const idx = /index/i.test(error);
  return (
    <div className="error-box">
      {idx ? 'Firestore cần tạo chỉ mục (index). Mở Console trình duyệt (F12) để bấm link tạo, hoặc chạy "firebase deploy --only firestore:indexes". ' : ''}
      {error}
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={'stat ' + (tone || '')}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function confirmDelete(msg = 'Xóa bản ghi này?') {
  return window.confirm(msg);
}

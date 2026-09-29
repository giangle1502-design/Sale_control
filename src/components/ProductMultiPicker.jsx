import { useMemo, useRef, useState } from 'react';
import { useProducts } from '../pages/Products';
import { norm } from '../lib/utils';

// Chọn nhiều mã hàng từ danh mục Mặt hàng (có ô tìm kiếm). Giá trị lưu dạng chuỗi "5502, 7000F, PP"
export const splitCodes = (v) => String(v || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);

export default function ProductMultiPicker({ value, onChange }) {
  const products = useProducts().data;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const selected = splitCodes(value);
  const selKeys = new Set(selected.map(norm));
  const byCode = useMemo(() => new Map(products.map((p) => [norm(p.code), p])), [products]);

  const s = norm(q);
  const list = useMemo(() => products
    .filter((p) => !s || norm(p.code).includes(s) || norm(p.name).includes(s) || norm(p.category).includes(s))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .slice(0, 80), [products, s]);

  const setList = (arr) => onChange(arr.join(', '));
  const toggle = (code) => {
    const k = norm(code);
    setList(selKeys.has(k) ? selected.filter((x) => norm(x) !== k) : [...selected, String(code)]);
  };
  const addTyped = () => {
    const t = q.trim();
    if (!t) return;
    const exact = products.find((p) => norm(p.code) === norm(t));
    if (!selKeys.has(norm(t))) setList([...selected, exact ? String(exact.code) : t]);
    setQ('');
  };

  return (
    // Nằm trong <label> của Field: chặn trình duyệt chuyển cú bấm sang phần tử khác trong label
    <div className="pmp" onClick={(e) => e.preventDefault()}>
      <div className="pmp-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {selected.map((c) => {
          const p = byCode.get(norm(c));
          return (
            <span key={c} className="pmp-chip" title={p ? `${p.name || ''}${p.category ? ' · ' + p.category : ''}` : 'Không có trong danh mục Mặt hàng'}>
              {c}{!p && products.length > 0 && <span style={{ opacity: 0.6 }}> *</span>}
              <span role="button" className="pmp-x" onClick={(e) => { e.stopPropagation(); toggle(c); }} aria-label={'Bỏ ' + c}>×</span>
            </span>
          );
        })}
        <input
          ref={inputRef}
          value={q}
          placeholder={selected.length ? 'Tìm thêm mã hàng…' : 'Tìm mã / tên hàng (VD: 5502, HDPE)…'}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (list.length === 1 && s) { toggle(list[0].code); setQ(''); } else addTyped(); }
            else if (e.key === 'Backspace' && !q && selected.length) setList(selected.slice(0, -1));
            else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
          }}
        />
      </div>
      {open && (
        <div className="pmp-list">
          <div className="pmp-head">
            <span className="small">{products.length ? `Bấm để chọn / bỏ chọn · đã chọn ${selected.length}` : 'Chưa có danh mục Mặt hàng — gõ rồi Enter để thêm'}</span>
            <button type="button" className="btn sm" onClick={() => { setOpen(false); setQ(''); }}>Xong</button>
          </div>
          {list.map((p) => {
            const on = selKeys.has(norm(p.code));
            return (
              <div key={p.id || p.code} className={'pmp-item' + (on ? ' on' : '')} onClick={() => toggle(p.code)}>
                <input type="checkbox" readOnly checked={on} />
                <b>{p.code}</b>
                <span className="small">{p.name}{p.category ? ' · ' + p.category : ''}</span>
              </div>
            );
          })}
          {s && !list.some((p) => norm(p.code) === s) && (
            <div className="pmp-item" onClick={addTyped}><span>➕ Thêm "<b>{q.trim()}</b>" (không có trong danh mục)</span></div>
          )}
          {!list.length && !s && <div className="small" style={{ padding: 8 }}>Không có mặt hàng</div>}
        </div>
      )}
    </div>
  );
}

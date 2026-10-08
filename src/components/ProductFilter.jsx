import { useEffect, useMemo, useRef, useState } from 'react';
import { norm } from '../lib/utils';

// Bộ lọc chọn nhiều mã hàng (có ô tìm kiếm). options: [{ code, name, free }]; count(codes) → { code: số khách } (chỉ gọi khi mở)
export default function ProductFilter({ options, count, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [onlyUsed, setOnlyUsed] = useState(true);
  const box = useRef(null);
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const counts = useMemo(() => (open ? count(options.map((o) => o.code)) : {}), [open, options, count]);
  const s = norm(q);
  const list = useMemo(() => options
    .map((o) => ({ ...o, count: counts[o.code] || 0 }))
    .filter((o) => (!onlyUsed || o.count > 0 || value.includes(o.code)) && (!s || norm(o.code).includes(s) || norm(o.name).includes(s)))
    .sort((a, b) => (value.includes(b.code) - value.includes(a.code)) || b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 150), [options, counts, s, onlyUsed, value]);
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);

  return (
    <div className="pf" ref={box}>
      <button type="button" className={'pf-btn' + (value.length ? ' on' : '')} onClick={() => setOpen(!open)}>
        🔎 {value.length ? <>Mã hàng: <b>{value.length <= 2 ? value.join(', ') : `${value.slice(0, 2).join(', ')} +${value.length - 2}`}</b></> : 'Lọc theo mã hàng'} ▾
      </button>
      {value.length > 0 && <button type="button" className="btn sm" onClick={() => onChange([])} title="Bỏ lọc mã hàng">✕</button>}
      {open && (
        <div className="pf-pop">
          <input autoFocus placeholder="Gõ để tìm mã / tên hàng (VD: 5502, lldpe)…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); toggle(list[0].code); setQ(''); } if (e.key === 'Escape') setOpen(false); }} />
          <div className="pf-tools">
            <label className="small"><input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} /> Chỉ mã có khách đang dùng</label>
            {list.length > 0 && s && <a className="small" onClick={() => onChange([...new Set([...value, ...list.map((o) => o.code)])])}>Chọn tất cả {list.length} mã đang hiện</a>}
          </div>
          <div className="pf-list">
            {list.map((o) => (
              <div key={o.code} className={'pmp-item' + (value.includes(o.code) ? ' on' : '')} onClick={() => toggle(o.code)}>
                <input type="checkbox" readOnly checked={value.includes(o.code)} />
                <b>{o.code}</b>
                <span className="small ellipsis" style={{ flex: 1 }}>{o.free ? <i>nhập tự do (không có trong danh mục)</i> : o.name}</span>
                <span className="badge">{o.count} KH</span>
              </div>
            ))}
            {!list.length && <div className="small" style={{ padding: 8 }}>Không có mã phù hợp</div>}
          </div>
          <div className="pf-tools"><span className="small">Đã chọn {value.length} mã · khách dùng <b>bất kỳ</b> mã nào trong số này sẽ hiện</span>
            <button type="button" className="btn sm primary" onClick={() => setOpen(false)}>Xong</button></div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { norm, num } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { Empty, Modal } from './ui';

// Bảng báo cáo dùng chung: chọn cột hiển thị, kéo thả đổi thứ tự (lưu theo từng người; quản trị lưu mặc định cho mọi người),
// lọc nâng cao nhiều điều kiện, xuất Excel theo đúng cột đang hiện. Cột: { k, l, v: (row) => giá trị, render?, num? }
const OPS = [['has', 'chứa'], ['eq', '='], ['ne', '≠'], ['ge', '≥'], ['le', '≤'], ['empty', 'trống'], ['filled', 'có dữ liệu']];
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };

function test(val, op, q) {
  const s = val == null ? '' : String(val);
  if (op === 'empty') return !s.trim();
  if (op === 'filled') return !!s.trim();
  const isNum = typeof val === 'number' && q !== '' && !isNaN(Number(String(q).replace(/,/g, '')));
  const a = isNum ? val : norm(s); const b = isNum ? Number(String(q).replace(/,/g, '')) : norm(q);
  if (op === 'has') return String(a).includes(String(b));
  if (op === 'eq') return a === b;
  if (op === 'ne') return a !== b;
  if (op === 'ge') return a >= b;
  if (op === 'le') return a <= b;
  return true;
}

export default function ColumnTable({ id, columns, rows, exportName, empty, rowKey }) {
  const { email, isAdmin } = useApp();
  const lsKey = `ct.${id}.${email}`;
  const [def, setDef] = useState(null);
  const [cfg, setCfg] = useState(() => lsGet(lsKey));
  const [pick, setPick] = useState(false);
  const [conds, setConds] = useState([]);
  useEffect(() => onSnapshot(doc(db, 'settings', 'tableCols'), (s) => setDef(s.data()?.[id] || null), () => {}), [id]);

  const all = columns.map((c) => c.k);
  const base = cfg || def || { order: all, hidden: [] };
  const order = [...base.order.filter((k) => all.includes(k)), ...all.filter((k) => !base.order.includes(k))];
  const shown = order.filter((k) => !(base.hidden || []).includes(k)).map((k) => columns.find((c) => c.k === k));

  const list = useMemo(() => rows.filter((r) => conds.every((c) => !c.k || test(columns.find((x) => x.k === c.k)?.v(r), c.op, c.q))), [rows, conds, columns]);
  const doExport = () => exportSheets(exportName || id, { 'Báo cáo': list.map((r) => Object.fromEntries(shown.map((c) => [c.l, c.v(r) ?? '']))) });

  return (
    <>
      <div className="filters" style={{ marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setPick(true)}>☰ Chọn / sắp xếp cột</button>
        <button className="btn sm" onClick={() => setConds([...conds, { k: shown[0]?.k || '', op: 'has', q: '' }])}>🔎 + Điều kiện lọc</button>
        <button className="btn sm" onClick={doExport} disabled={!list.length}>⬇ Excel</button>
        <span className="small">{list.length.toLocaleString('en-US')} dòng</span>
      </div>
      {conds.map((c, i) => {
        const set = (p) => setConds(conds.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={i} className="filters" style={{ marginBottom: 6 }}>
            <span className="small">{i ? 'và' : 'Lọc:'}</span>
            <select value={c.k} onChange={(e) => set({ k: e.target.value })}>{columns.map((x) => <option key={x.k} value={x.k}>{x.l}</option>)}</select>
            <select value={c.op} onChange={(e) => set({ op: e.target.value })}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {!['empty', 'filled'].includes(c.op) && <input value={c.q} onChange={(e) => set({ q: e.target.value })} placeholder="giá trị" />}
            <button className="btn sm" onClick={() => setConds(conds.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      {!list.length ? <Empty text={empty} /> : (
        <div className="table-wrap">
          <table className="ct-grid">
            <thead><tr>{shown.map((c) => <th key={c.k} className={c.num ? 'num' : ''}>{c.l}</th>)}</tr></thead>
            <tbody>{list.map((r, i) => <tr key={rowKey ? rowKey(r) : r.id || i}>{shown.map((c) => <td key={c.k} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : c.num ? num(c.v(r)).toLocaleString('en-US') : c.v(r)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {pick && <ColPicker columns={columns} order={order} hidden={base.hidden || []} isAdmin={isAdmin} onClose={() => setPick(false)}
        onSave={(o, h, asDefault) => {
          const v = { order: o, hidden: h }; setCfg(v); lsSet(lsKey, v);
          if (asDefault) setDoc(doc(db, 'settings', 'tableCols'), { [id]: v }, { merge: true }).catch(() => {});
          setPick(false);
        }}
        onReset={() => { setCfg(null); try { localStorage.removeItem(lsKey); } catch { /* bỏ qua */ } setPick(false); }} />}
    </>
  );
}

function ColPicker({ columns, order: o0, hidden: h0, isAdmin, onSave, onReset, onClose }) {
  const [order, setOrder] = useState(o0);
  const [hidden, setHidden] = useState(h0);
  const [drag, setDrag] = useState(null);
  const label = (k) => columns.find((c) => c.k === k)?.l || k;
  const move = (from, to) => { if (from === to || from == null) return; const a = [...order]; const [x] = a.splice(from, 1); a.splice(to, 0, x); setOrder(a); };
  return (
    <Modal title="Chọn cột hiển thị & kéo thả để sắp xếp" onClose={onClose}>
      <p className="small">Tích chọn cột muốn xem; kéo ⋮⋮ để đổi thứ tự (hoặc dùng ▲▼).</p>
      <div>{order.map((k, i) => (
        <div key={k} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { move(drag, i); setDrag(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, background: drag === i ? 'var(--primary-soft)' : 'var(--card, #fff)', cursor: 'grab' }}>
          <span style={{ color: 'var(--muted)' }}>⋮⋮</span>
          <label style={{ flex: 1 }}><input type="checkbox" checked={!hidden.includes(k)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== k) : [...hidden, k])} /> {label(k)}</label>
          <button className="btn sm" disabled={!i} onClick={() => move(i, i - 1)}>▲</button>
          <button className="btn sm" disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>▼</button>
        </div>
      ))}</div>
      <div className="form-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onReset}>Về mặc định</button>
        {isAdmin && <button className="btn" onClick={() => onSave(order, hidden, true)}>Lưu làm mặc định cho mọi người</button>}
        <button className="btn primary" onClick={() => onSave(order, hidden, false)}>Lưu</button>
      </div>
    </Modal>
  );
}

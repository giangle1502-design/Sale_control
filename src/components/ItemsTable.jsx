import { useApp } from '../context/AppContext';
import { fmtMoney, num } from '../lib/utils';
import AddFieldButton from './AddFieldButton';

export const blankItem = () => ({ product: '', grade: '', qtyKg: '', priceKg: '', custom: {} });

// Chuẩn hóa dòng hàng trước khi lưu
export function cleanItems(items) {
  return items
    .filter((it) => it.product || num(it.qtyKg))
    .map((it) => ({ ...it, qtyKg: num(it.qtyKg), priceKg: num(it.priceKg), custom: it.custom || {} }));
}

function CellInput({ f, value, onChange }) {
  if (f.type === 'select') {
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required}>
        <option value="">--</option>
        {(f.options || []).map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === 'checkbox') return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  return (
    <input
      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
      step="any" value={value ?? ''} required={f.required} onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Bảng dòng hàng dùng chung cho Báo giá và Đơn hàng, có cột phụ tùy chỉnh (Lot, Nhà sản xuất…)
export default function ItemsTable({ items, onChange }) {
  const { config } = useApp();
  const cols = config.customFields.items || [];
  const setItem = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const setCustom = (i, k, v) => setItem(i, { custom: { ...(items[i].custom || {}), [k]: v } });

  return (
    <>
      <div className="table-wrap items-table">
        <table>
          <thead>
            <tr>
              <th>Loại hạt</th><th>Mã / Grade</th>
              {cols.map((c) => <th key={c.key}>{c.label}</th>)}
              <th className="num">SL (kg)</th><th className="num">Đơn giá (đ/kg)</th><th className="num">Thành tiền</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td style={{ minWidth: 110 }}><input list="product-list" value={it.product} onChange={(e) => setItem(i, { product: e.target.value })} placeholder="PP, PE…" /></td>
                <td style={{ minWidth: 100 }}><input value={it.grade} onChange={(e) => setItem(i, { grade: e.target.value })} placeholder="VD: T30S" /></td>
                {cols.map((c) => (
                  <td key={c.key} style={{ minWidth: 100 }}>
                    <CellInput f={c} value={it.custom?.[c.key]} onChange={(v) => setCustom(i, c.key, v)} />
                  </td>
                ))}
                <td style={{ minWidth: 90 }}><input type="number" step="any" value={it.qtyKg} onChange={(e) => setItem(i, { qtyKg: e.target.value })} /></td>
                <td style={{ minWidth: 110 }}><input type="number" step="any" value={it.priceKg} onChange={(e) => setItem(i, { priceKg: e.target.value })} /></td>
                <td className="num">{fmtMoney(num(it.qtyKg) * num(it.priceKg))}</td>
                <td>{items.length > 1 && <button type="button" className="btn sm danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="product-list">{config.products.map((p) => <option key={p} value={p} />)}</datalist>
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm" onClick={() => onChange([...items, blankItem()])}>+ Thêm dòng</button>
        <AddFieldButton module="items" label="+ Thêm cột (Lot, Nhà sản xuất…)" />
      </div>
    </>
  );
}

// Mô tả dòng hàng dạng chữ (dùng cho bảng, Excel, email)
export function itemText(it, cols = []) {
  const extra = cols.map((c) => (it.custom?.[c.key] ? `${c.label}: ${c.type === 'checkbox' ? '✓' : it.custom[c.key]}` : '')).filter(Boolean).join(', ');
  return `${it.product || ''} ${it.grade || ''}`.trim() + (extra ? ` (${extra})` : '');
}

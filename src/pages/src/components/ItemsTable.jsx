import { useApp } from '../context/AppContext';
import { fmtMoney, num } from '../lib/utils';
import AddFieldButton from './AddFieldButton';
import { useProducts } from '../pages/Products';

export const blankItem = () => ({ productCode: '', product: '', grade: '', qtyKg: '', priceKg: '', custom: {} });

// Chuẩn hóa dòng hàng trước khi lưu
export function cleanItems(items) {
  return items
    .filter((it) => it.product || it.productCode || num(it.qtyKg))
    .map(({ autoPrice, ...it }) => ({ ...it, productCode: it.productCode || '', qtyKg: num(it.qtyKg), priceKg: num(it.priceKg), custom: it.custom || {} }));
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
  const products = useProducts().data;
  const byCode = new Map(products.map((p) => [String(p.code).toLowerCase(), p]));
  // Chọn mã hàng → tự điền tên hàng và giá bán theo danh mục
  const pickCode = (i, v) => {
    const code = v.split(' — ')[0].trim();
    const p = byCode.get(code.toLowerCase());
    const it = items[i];
    if (!p) return setItem(i, { productCode: v });
    setItem(i, {
      productCode: p.code, product: p.name || it.product, category: p.category || '',
      priceKg: it.priceKg === '' || it.priceKg === undefined || it.autoPrice ? p.price ?? '' : it.priceKg,
      listPrice: p.price ?? '', autoPrice: true,
    });
  };
  const setItem = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const setCustom = (i, k, v) => setItem(i, { custom: { ...(items[i].custom || {}), [k]: v } });

  return (
    <>
      <div className="table-wrap items-table">
        <table>
          <thead>
            <tr>
              <th>Mã hàng</th><th>Tên hàng / Loại hạt</th><th>Grade</th>
              {cols.map((c) => <th key={c.key}>{c.label}</th>)}
              <th className="num">SL (kg)</th><th className="num">Đơn giá (đ/kg)</th><th className="num">Thành tiền</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td style={{ minWidth: 120 }}><input list="product-code-list" value={it.productCode || ''} onChange={(e) => pickCode(i, e.target.value)} placeholder="Gõ mã…" /></td>
                <td style={{ minWidth: 140 }}><input list="product-list" value={it.product} onChange={(e) => setItem(i, { product: e.target.value })} placeholder="PP, PE…" /></td>
                <td style={{ minWidth: 100 }}><input value={it.grade} onChange={(e) => setItem(i, { grade: e.target.value })} placeholder="VD: T30S" /></td>
                {cols.map((c) => (
                  <td key={c.key} style={{ minWidth: 100 }}>
                    <CellInput f={c} value={it.custom?.[c.key]} onChange={(v) => setCustom(i, c.key, v)} />
                  </td>
                ))}
                <td style={{ minWidth: 90 }}><input type="number" step="any" value={it.qtyKg} onChange={(e) => setItem(i, { qtyKg: e.target.value })} /></td>
                <td style={{ minWidth: 110 }}>
                  <input type="number" step="any" value={it.priceKg} onChange={(e) => setItem(i, { priceKg: e.target.value, autoPrice: false })} />
                  {it.listPrice !== undefined && it.listPrice !== '' && num(it.listPrice) !== num(it.priceKg) && <div className="small">Giá DM: {fmtMoney(it.listPrice)}</div>}
                </td>
                <td className="num">{fmtMoney(num(it.qtyKg) * num(it.priceKg))}</td>
                <td>{items.length > 1 && <button type="button" className="btn sm danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="product-list">{config.products.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="product-code-list">{products.map((p) => <option key={p.id} value={p.code}>{p.name} · {fmtMoney(p.price)}</option>)}</datalist>
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
  return `${it.productCode ? '[' + it.productCode + '] ' : ''}${it.product || ''} ${it.grade || ''}`.trim() + (extra ? ` (${extra})` : '');
}

import { useMemo, useState } from 'react';
import { collection, deleteDoc, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { fmtDate, fmtMoney, norm, num, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, detectHeaderRow, guessMapping, readWorkbook, sheetRows, toNumber } from '../lib/excelImport';
import AddFieldButton from '../components/AddFieldButton';
import { confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, Modal, Stat } from '../components/ui';

// Danh mục mặt hàng dùng chung (mọi nhân viên xem, quản trị cập nhật)
export function useProducts() {
  return useQuery(() => collection(db, 'products'), []);
}
export const productDocId = (code) => String(code).trim().replace(/[/\s]+/g, '_');

const COLS = [
  { key: 'category', label: 'Tính chất', aliases: ['tinh chat', 'nhom hang', 'loai hang', 'phan loai', 'nhom'] },
  { key: 'code', label: 'Mã hàng', aliases: ['ma hang', 'ma mat hang', 'ma san pham', 'ma sp', 'ma vat tu', 'ma'] },
  { key: 'name', label: 'Tên hàng', aliases: ['ten hang', 'ten mat hang', 'ten san pham', 'ten vat tu', 'ten'] },
  { key: 'unit', label: 'Đơn vị', aliases: ['don vi tinh', 'don vi', 'dvt'] },
  { key: 'price', label: 'Giá bán', aliases: ['gia ban', 'don gia ban', 'don gia', 'gia'] },
  { key: 'note', label: 'Ghi chú', aliases: ['ghi chu'] },
];

export default function Products() {
  const { isAdmin, config } = useApp();
  const fields = config.customFields.products || [];
  const { data, error } = useProducts();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const cats = useMemo(() => [...new Set(data.map((p) => p.category).filter(Boolean))].sort(), [data]);
  const s = norm(search);
  const rows = data
    .filter((p) => (!cat || p.category === cat) && (!s || norm(p.code).includes(s) || norm(p.name).includes(s)))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const exportList = () => exportSheets(`DanhMucMatHang_${today()}`, {
    'Mặt hàng': rows.map((p) => ({
      'Tính chất': p.category, 'Mã hàng': p.code, 'Tên hàng': p.name, 'Đơn vị': p.unit, 'Giá bán': num(p.price),
      'Ngày cập nhật giá': fmtDate(p.priceDate), 'Ghi chú': p.note,
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, p.custom?.[f.key])])),
    })),
  });
  // Mẫu giống màn hình cập nhật giá của Ecount: No. | Mã mặt hàng | Giá bán | Giá bán Bao gồm VAT
  const exportEcount = () => exportSheets(`CapNhatGia_Ecount_${today()}`, {
    'Cập nhật giá': rows.map((p, i) => ({ 'No.': i + 1, 'Mã mặt hàng': p.code, 'Giá bán': num(p.price), 'Giá bán Bao gồm VAT': '' })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Mặt hàng <span className="small">({rows.length})</span></h1>
        <div className="actions">
          <button className="btn" onClick={exportEcount}>⬇ Mẫu cập nhật giá (Ecount)</button>
          <button className="btn" onClick={exportList}>⬇ Danh sách Excel</button>
          {isAdmin && <button className="btn" onClick={() => setImporting(true)}>⬆ Nhập Excel / Cập nhật giá</button>}
          {isAdmin && <button className="btn primary" onClick={() => setEdit({ category: '', code: '', name: '', unit: 'kg', price: '', note: '', custom: {} })}>+ Thêm mặt hàng</button>}
        </div>
      </div>
      <div className="stats">
        <Stat label="Số mặt hàng" value={data.length} />
        <Stat label="Nhóm (tính chất)" value={cats.length} />
        <Stat label="Giá cập nhật gần nhất" value={fmtDate(data.map((p) => p.priceDate).filter(Boolean).sort().pop()) || '-'} tone="green" />
      </div>
      <div className="filters">
        <input placeholder="Tìm mã hoặc tên hàng…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Tất cả tính chất</option>{cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {rows.length === 0 ? <Empty text="Chưa có mặt hàng — quản trị bấm Nhập Excel" /> : (
          <table>
            <thead><tr><th>Tính chất</th><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th className="num">Giá bán</th><th>Cập nhật giá</th>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.category}</td><td className="nowrap"><b>{p.code}</b></td><td>{p.name}</td><td>{p.unit}</td>
                  <td className="num">{fmtMoney(p.price)}
                    {p.prevPrice !== undefined && p.prevPrice !== p.price && <div className="small">trước: {fmtMoney(p.prevPrice)}</div>}
                  </td>
                  <td className="nowrap">{fmtDate(p.priceDate)}</td>
                  {fields.map((f) => <td key={f.key}>{String(customValue(f, p.custom?.[f.key]))}</td>)}
                  {isAdmin && (
                    <td className="nowrap">
                      <button className="btn sm" onClick={() => setEdit(p)}>Sửa</button>{' '}
                      <button className="btn sm danger" onClick={() => confirmDelete('Xóa mặt hàng này?') && deleteDoc(doc(db, 'products', p.id))}>Xóa</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <ProductForm initial={edit} onClose={() => setEdit(null)} />}
      {importing && <ImportProducts existing={data} onClose={() => setImporting(false)} />}
    </>
  );
}

function ProductForm({ initial, onClose }) {
  const { config, email } = useApp();
  const fields = config.customFields.products || [];
  const [f, setF] = useState({ ...initial, custom: initial.custom || {} });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { id, ...rest } = f;
      const price = num(rest.price);
      const priceChanged = !id || price !== num(initial.price);
      const newId = id || productDocId(rest.code);
      await setDoc(doc(db, 'products', newId), {
        ...rest, code: rest.code.trim(), price,
        ...(priceChanged ? { priceDate: today(), prevPrice: id ? num(initial.price) : price } : {}),
        updatedAt: serverTimestamp(), updatedBy: email,
      }, { merge: true });
      onClose();
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <Modal title={f.id ? 'Sửa mặt hàng' : 'Thêm mặt hàng'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Mã hàng" required><input value={f.code} onChange={set('code')} required disabled={!!f.id} /></Field>
          <Field label="Tính chất"><input value={f.category} onChange={set('category')} placeholder="VD: PP, HDPE, Tái sinh…" /></Field>
          <Field label="Tên hàng" required full><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Đơn vị tính"><input value={f.unit} onChange={set('unit')} /></Field>
          <Field label="Giá bán (chưa VAT)"><input type="number" step="any" value={f.price} onChange={set('price')} /></Field>
          <Field label="Ghi chú" full><input value={f.note || ''} onChange={set('note')} /></Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        <div style={{ marginTop: 10 }}><AddFieldButton module="products" label="+ Thêm trường cho mặt hàng" /></div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary">Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportProducts({ existing, onClose }) {
  const { email, config } = useApp();
  const fields = config.customFields.products || [];
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const parse = async (file) => {
    setErr(''); setPlan(null); setDone('');
    try {
      const wb = await readWorkbook(file);
      const rows = sheetRows(wb);
      const hr = detectHeaderRow(rows, ['ma', 'ten', 'gia', 'tinh chat', 'no']);
      const headers = rows[hr].map(cellText);
      // Bỏ qua cột có chữ VAT (Giá bán Bao gồm VAT)
      const forMap = headers.map((h) => (norm(h).includes('vat') ? '' : h));
      const map = guessMapping(forMap, COLS);
      if (map.code === undefined) throw new Error('Không tìm thấy cột "Mã hàng" / "Mã mặt hàng".');
      const priceOnly = map.name === undefined;
      const customMap = {};
      fields.forEach((f) => { const i = headers.findIndex((h) => norm(h) === norm(f.label)); if (i >= 0) customMap[f.key] = i; });
      const byId = new Map(existing.map((p) => [p.id, p]));
      const items = [];
      rows.slice(hr + 1).forEach((r, i) => {
        const get = (k) => (map[k] === undefined ? '' : r[map[k]]);
        const code = cellText(get('code'));
        if (!code) return;
        const found = byId.get(productDocId(code));
        const rawPrice = get('price');
        const hasPrice = cellText(rawPrice) !== '';
        const price = toNumber(rawPrice);
        let action = found ? 'update' : 'create';
        let problem = '';
        if (priceOnly && !found) { action = 'skip'; problem = 'Mã chưa có trong danh mục'; }
        if (priceOnly && !hasPrice) { action = 'skip'; problem = 'Không có giá'; }
        const data = { code };
        if (!priceOnly) {
          ['category', 'name', 'unit', 'note'].forEach((k) => { if (map[k] !== undefined) data[k] = cellText(get(k)); });
          if (!found && !data.unit) data.unit = 'kg';
          const custom = { ...(found?.custom || {}) };
          Object.entries(customMap).forEach(([k, idx]) => { const v = cellText(r[idx]); if (v !== '') custom[k] = v; });
          data.custom = custom;
        }
        if (hasPrice) {
          data.price = price;
          if (!found || num(found.price) !== price) { data.priceDate = today(); data.prevPrice = found ? num(found.price) : price; }
        }
        items.push({ line: hr + i + 2, code, name: data.name || found?.name || '', old: found?.price, price: hasPrice ? price : undefined, action, problem, data });
      });
      setPlan({ items, priceOnly, headerRow: hr + 1 });
    } catch (e) { setErr(e.message); }
  };

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const todo = plan.items.filter((x) => x.action !== 'skip');
      for (let i = 0; i < todo.length; i += 400) {
        const b = writeBatch(db);
        todo.slice(i, i + 400).forEach((x) => b.set(doc(db, 'products', productDocId(x.code)), { ...x.data, updatedAt: serverTimestamp(), updatedBy: email }, { merge: true }));
        await b.commit();
      }
      const changed = todo.filter((x) => x.price !== undefined && x.old !== x.price).length;
      setDone(`Đã cập nhật ${todo.length} mặt hàng (${todo.filter((x) => x.action === 'create').length} mới, ${changed} thay đổi giá).`);
      setPlan(null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const n = (a) => plan?.items.filter((x) => x.action === a).length || 0;
  return (
    <Modal title="Nhập danh mục mặt hàng / cập nhật giá bán" onClose={onClose} wide>
      <p className="small">
        <b>Nhập danh mục:</b> file có các cột <b>Tính chất, Mã hàng, Tên hàng, Giá bán</b> → tạo mới / cập nhật theo Mã hàng.<br />
        <b>Cập nhật giá:</b> dùng đúng mẫu Ecount (<b>No., Mã mặt hàng, Giá bán, Giá bán Bao gồm VAT</b>) → chỉ cập nhật giá theo mã; cột VAT được bỏ qua.
        Có thể bấm "Mẫu cập nhật giá (Ecount)" để tải mẫu có sẵn mã và giá hiện tại.
      </p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && parse(e.target.files[0])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {plan && (
        <>
          <div className="ok-box" style={{ marginTop: 10 }}>
            {plan.priceOnly ? 'Nhận diện: file CẬP NHẬT GIÁ (mẫu Ecount)' : 'Nhận diện: file DANH MỤC MẶT HÀNG'} · dòng tiêu đề {plan.headerRow}
          </div>
          <div className="stats" style={{ marginTop: 10 }}>
            <Stat label="Tạo mới" value={n('create')} tone="green" />
            <Stat label="Cập nhật" value={n('update')} />
            <Stat label="Bỏ qua" value={n('skip')} tone="red" />
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Dòng</th><th>Mã hàng</th><th>Tên hàng</th><th className="num">Giá cũ</th><th className="num">Giá mới</th><th>Thao tác</th></tr></thead>
              <tbody>
                {plan.items.slice(0, 500).map((x) => (
                  <tr key={x.line}>
                    <td>{x.line}</td><td>{x.code}</td><td>{x.name}</td>
                    <td className="num">{x.old !== undefined ? fmtMoney(x.old) : ''}</td>
                    <td className="num">{x.price !== undefined ? <b style={{ color: x.old !== undefined && x.old !== x.price ? 'var(--primary)' : undefined }}>{fmtMoney(x.price)}</b> : ''}</td>
                    <td>{x.action === 'skip' ? <span className="badge red">Bỏ qua: {x.problem}</span> : x.action === 'create' ? <span className="badge green">Tạo mới</span> : <span className="badge blue">Cập nhật</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {plan && <button type="button" className="btn primary" disabled={busy || n('create') + n('update') === 0} onClick={run}>{busy ? 'Đang lưu…' : `Cập nhật ${n('create') + n('update')} mặt hàng`}</button>}
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { fmtDate, fmtMoney, fmtNum, norm, num } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, readWorkbook, sheetRows, toNumber } from '../lib/excelImport';
import { Empty, ErrorBox, Modal, Stat } from '../components/ui';

// ============================================================================
// Phân tích bán hàng theo tháng — nhập file "Chi tiết tình hình bán hàng" (Ecount)
// Lưu Firestore: salesMonths/{YYYY-MM}_{phần} = { month, part, rows: [...] }
// ============================================================================

const PART = 1500; // số dòng tối đa mỗi tài liệu (giữ dưới giới hạn 1MB)
const COLS = {
  co: ['cong ty xuat'], st: ['hien trang'], ds: ['ngay so'], so: ['so so'], wh: ['kho ten'],
  cc: ['ma khach hang nha cung cap', 'ma khach hang'], cn: ['khach hang nha cung cap ten', 'khach hang ten', 'ten khach hang'],
  ic: ['ma hang'], in: ['mat hang ten', 'ten hang'], q: ['so luong da ban'], p: ['don gia'], a: ['thanh tien'], sp: ['sale phu trach ten', 'sale phu trach'],
};
const tons = (kg) => fmtNum(kg / 1000, 1);
const pct = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
const monthLabel = (m) => (m ? `Tháng ${m.slice(5)}/${m.slice(0, 4)}` : '');

// Đọc file Ecount → dòng bán hàng
export function parseSales(rows) {
  const hr = rows.findIndex((r) => r.some((c) => norm(c) === 'ma hang') && r.some((c) => norm(c) === 'so luong da ban'));
  if (hr < 0) throw new Error('Không tìm thấy dòng tiêu đề (cần có cột "Mã hàng" và "Số lượng đã bán"). Hãy dùng báo cáo "Chi tiết tình hình bán hàng" của Ecount.');
  const head = rows[hr].map(norm);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, al]) => [k, head.findIndex((h) => al.includes(h))]));
  if (idx.ic < 0 || idx.q < 0 || idx.a < 0) throw new Error('Thiếu cột Mã hàng / Số lượng đã bán / Thành tiền.');
  const g = (r, k) => (idx[k] >= 0 ? r[idx[k]] : '');
  const out = [];
  let fileTotal = null;
  rows.slice(hr + 1).forEach((r) => {
    const first = cellText(r[0]);
    if (norm(first) === 'tong cong') fileTotal = toNumber(g(r, 'a'));
    const ic = cellText(g(r, 'ic'));
    if (!ic) return;
    const m = cellText(g(r, 'ds')).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return;
    const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    out.push({
      d, co: cellText(g(r, 'co')), st: cellText(g(r, 'st')), so: cellText(g(r, 'so')), wh: cellText(g(r, 'wh')),
      cc: cellText(g(r, 'cc')), cn: cellText(g(r, 'cn')), ic, in: cellText(g(r, 'in')),
      q: toNumber(g(r, 'q')), p: toNumber(g(r, 'p')), a: toNumber(g(r, 'a')), sp: cellText(g(r, 'sp')) || '(chưa ghi sale)',
    });
  });
  return { rows: out, fileTotal };
}

// Tổng hợp theo một khóa
function groupBy(rows, key) {
  const m = new Map();
  rows.forEach((r) => {
    const k = key(r);
    if (!m.has(k)) m.set(k, { k, a: 0, q: 0, cust: new Set(), so: new Set(), minP: Infinity, maxP: 0, rows: [] });
    const x = m.get(k);
    x.a += r.a; x.q += r.q; x.cust.add(r.cc || r.cn); if (r.so) x.so.add(r.so); x.rows.push(r);
    if (r.p > 0) { x.minP = Math.min(x.minP, r.p); x.maxP = Math.max(x.maxP, r.p); }
  });
  return m;
}

const Chg = ({ cur, prev, money }) => {
  if (prev == null) return null;
  const p = pct(cur, prev);
  if (p === null) return <span className="small">mới</span>;
  if (p === 0) return <span className="small">=</span>;
  return <span className="small" style={{ color: p > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{p > 0 ? '▲' : '▼'} {Math.abs(p)}%{money ? '' : ''}</span>;
};

export default function SalesAnalysis() {
  const [docsData, setDocsData] = useState(null);
  const [err, setErr] = useState('');
  const [importing, setImporting] = useState(false);
  const [month, setMonth] = useState('');
  const [cmp, setCmp] = useState('');
  const [co, setCo] = useState('');
  const [st, setSt] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    getDocs(collection(db, 'salesMonths'))
      .then((s) => setDocsData(s.docs.map((d) => d.data())))
      .catch((e) => { setErr(e.message); setDocsData([]); });
  }, [reload]);

  const byMonth = useMemo(() => {
    const m = new Map();
    (docsData || []).forEach((d) => { if (!m.has(d.month)) m.set(d.month, { rows: [], meta: d }); m.get(d.month).rows.push(...(d.rows || [])); });
    return m;
  }, [docsData]);
  const months = [...byMonth.keys()].sort();

  useEffect(() => {
    if (!months.length) return;
    const last = months[months.length - 1];
    if (!month || !byMonth.has(month)) setMonth(last);
  }, [months.join()]);
  useEffect(() => {
    const i = months.indexOf(month);
    setCmp(i > 0 ? months[i - 1] : '');
  }, [month]);

  const filt = (rows) => rows.filter((r) => (!co || r.co === co) && (!st || r.st === st));
  const cur = useMemo(() => filt(byMonth.get(month)?.rows || []), [byMonth, month, co, st]);
  const prev = useMemo(() => (cmp ? filt(byMonth.get(cmp)?.rows || []) : null), [byMonth, cmp, co, st]);
  const companies = [...new Set((byMonth.get(month)?.rows || []).map((r) => r.co).filter(Boolean))].sort();

  const A = useMemo(() => {
    const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
    const custKey = (r) => r.cc || r.cn;
    const k = (rows) => rows && ({
      a: sum(rows, (r) => r.a), q: sum(rows, (r) => r.q),
      cust: new Set(rows.map(custKey)).size, so: new Set(rows.map((r) => r.so).filter(Boolean)).size,
      pending: sum(rows.filter((r) => r.st && r.st !== 'Đã hoàn tất'), (r) => r.a),
    });
    const K = k(cur); const KP = k(prev);
    const prevCust = new Set((prev || []).map(custKey));
    const curCust = new Set(cur.map(custKey));

    const sales = groupBy(cur, (r) => r.sp); const salesP = prev ? groupBy(prev, (r) => r.sp) : new Map();
    const bySale = [...sales.values()].map((x) => ({
      ...x, nCust: x.cust.size, newCust: [...x.cust].filter((c) => prev && !prevCust.has(c)).length, prevA: salesP.get(x.k)?.a ?? (prev ? 0 : null),
    })).sort((x, y) => y.a - x.a);

    const items = groupBy(cur, (r) => r.ic); const itemsP = prev ? groupBy(prev, (r) => r.ic) : new Map();
    const byItem = [...items.values()].map((x) => ({
      ...x, name: x.rows[0].in, avgP: x.q ? x.a / x.q : 0, nCust: x.cust.size, prevQ: itemsP.get(x.k)?.q ?? (prev ? 0 : null),
      prevAvg: itemsP.get(x.k) ? itemsP.get(x.k).a / (itemsP.get(x.k).q || 1) : null,
    })).sort((x, y) => y.a - x.a);

    const custs = groupBy(cur, custKey); const custsP = prev ? groupBy(prev, custKey) : new Map();
    const byCust = [...custs.values()].map((x) => ({
      ...x, name: x.rows[0].cn, code: x.rows[0].cc, sale: [...new Set(x.rows.map((r) => r.sp))].join(', '),
      prevA: custsP.get(x.k)?.a ?? (prev ? 0 : null), isNew: prev ? !prevCust.has(x.k) : false,
    })).sort((x, y) => y.a - x.a);
    const lost = prev ? [...custsP.values()].filter((x) => !curCust.has(x.k)).map((x) => ({
      ...x, name: x.rows[0].cn, code: x.rows[0].cc, sale: [...new Set(x.rows.map((r) => r.sp))].join(', '),
    })).sort((x, y) => y.a - x.a) : [];

    const byCo = [...groupBy(cur, (r) => r.co || '(khác)').values()].sort((x, y) => y.a - x.a);
    const byWh = [...groupBy(cur, (r) => r.wh || '(khác)').values()].sort((x, y) => y.a - x.a);

    // Theo ngày trong tháng (so với tháng trước cùng ngày)
    const days = new Map();
    cur.forEach((r) => { const d = r.d.slice(8); days.set(d, (days.get(d) || { a: 0, q: 0 })); days.get(d).a += r.a; days.get(d).q += r.q; });
    const daysP = new Map();
    (prev || []).forEach((r) => { const d = r.d.slice(8); daysP.set(d, (daysP.get(d) || 0) + r.a); });
    const allDays = [...new Set([...days.keys(), ...daysP.keys()])].sort();
    const daily = allDays.map((d) => ({ d, a: days.get(d)?.a || 0, t: (days.get(d)?.q || 0) / 1000, pa: prev ? daysP.get(d) || 0 : undefined }));

    // Đơn giá bất thường: < 70% giá BQ của mã hàng hoặc ≤ 1.000 đ/kg
    const avgBy = Object.fromEntries(byItem.map((x) => [x.k, x.avgP]));
    const odd = cur.filter((r) => r.q > 0 && (r.p <= 1000 || (avgBy[r.ic] && r.p < avgBy[r.ic] * 0.7)))
      .map((r) => ({ ...r, avg: avgBy[r.ic] || 0 })).sort((x, y) => x.p / (x.avg || 1) - y.p / (y.avg || 1));

    return { K, KP, bySale, byItem, byCust, lost, byCo, byWh, daily, odd };
  }, [cur, prev]);

  if (docsData === null) return <Empty text="Đang tải…" />;

  const doExport = () => exportSheets(`PhanTichBanHang_${month}`, {
    'Theo sale': A.bySale.map((x) => ({ Sale: x.k, 'Doanh thu': Math.round(x.a), 'Sản lượng (tấn)': +(x.q / 1000).toFixed(3), 'Giá BQ (đ/kg)': Math.round(x.q ? x.a / x.q : 0), 'Số KH': x.nCust, 'KH mới': x.newCust, 'Doanh thu tháng trước': x.prevA != null ? Math.round(x.prevA) : '' })),
    'Theo mặt hàng': A.byItem.map((x) => ({ 'Mã hàng': x.k, 'Tên hàng': x.name, 'Sản lượng (tấn)': +(x.q / 1000).toFixed(3), 'Doanh thu': Math.round(x.a), 'Giá BQ': Math.round(x.avgP), 'Giá thấp nhất': x.minP === Infinity ? '' : x.minP, 'Giá cao nhất': x.maxP, 'Số KH': x.nCust, 'Tấn tháng trước': x.prevQ != null ? +(x.prevQ / 1000).toFixed(3) : '' })),
    'Theo khách hàng': A.byCust.map((x) => ({ 'Mã KH': x.code, 'Khách hàng': x.name, Sale: x.sale, 'Doanh thu': Math.round(x.a), 'Sản lượng (tấn)': +(x.q / 1000).toFixed(3), 'Số đơn': x.so.size, 'Doanh thu tháng trước': x.prevA != null ? Math.round(x.prevA) : '', 'Khách mới': x.isNew ? 'Có' : '' })),
    'KH ngừng mua': A.lost.map((x) => ({ 'Mã KH': x.code, 'Khách hàng': x.name, Sale: x.sale, 'Doanh thu tháng trước': Math.round(x.a) })),
    'Đơn giá bất thường': A.odd.map((r) => ({ Ngày: fmtDate(r.d), 'Số SO': r.so, 'Khách hàng': r.cn, 'Mã hàng': r.ic, 'Số lượng': r.q, 'Đơn giá': r.p, 'Giá BQ mã hàng': Math.round(r.avg), Sale: r.sp })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Phân tích bán hàng</h1>
        <div className="actions">
          {months.length > 0 && <button className="btn" onClick={doExport}>⬇ Excel</button>}
          <button className="btn primary" onClick={() => setImporting(true)}>⬆ Nhập báo cáo bán hàng (Ecount)</button>
        </div>
      </div>
      <ErrorBox error={err} />
      {!months.length ? (
        <Empty text='Chưa có dữ liệu. Bấm "Nhập báo cáo bán hàng" và chọn file "Chi tiết tình hình bán hàng" xuất từ Ecount.' />
      ) : (
        <>
          <div className="filters">
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {[...months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <span>so với</span>
            <select value={cmp} onChange={(e) => setCmp(e.target.value)}>
              <option value="">(không so sánh)</option>
              {months.filter((m) => m < month).reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select value={co} onChange={(e) => setCo(e.target.value)}>
              <option value="">Tất cả công ty</option>
              {companies.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={st} onChange={(e) => setSt(e.target.value)}>
              <option value="">Mọi trạng thái</option>
              <option>Đã hoàn tất</option>
              <option>Đang xử lý</option>
            </select>
            <span className="small">Dữ liệu tới ngày {fmtDate(byMonth.get(month)?.rows.reduce((m, r) => (r.d > m ? r.d : m), ''))}</span>
          </div>

          <div className="stats">
            <Stat label="Doanh thu (trước thuế)" value={fmtMoney(A.K.a) + ' đ'} sub={<>{A.KP && <Chg cur={A.K.a} prev={A.KP.a} />} {A.KP && <span className="small">({monthLabel(cmp)}: {fmtMoney(A.KP.a)})</span>}</>} tone="green" />
            <Stat label="Sản lượng" value={tons(A.K.q) + ' tấn'} sub={A.KP && <><Chg cur={A.K.q} prev={A.KP.q} /> <span className="small">(trước: {tons(A.KP.q)} tấn)</span></>} tone="green" />
            <Stat label="Giá bán bình quân" value={fmtMoney(A.K.q ? A.K.a / A.K.q : 0) + ' đ/kg'} sub={A.KP && A.KP.q ? <span className="small">Tháng trước: {fmtMoney(A.KP.a / A.KP.q)} đ/kg</span> : ''} />
            <Stat label="Khách hàng mua" value={A.K.cust} sub={A.KP && <><Chg cur={A.K.cust} prev={A.KP.cust} /> <span className="small">· {A.byCust.filter((x) => x.isNew).length} KH mới · {A.lost.length} KH ngừng mua</span></>} />
            <Stat label="Số đơn (SO)" value={A.K.so} sub={A.K.pending ? `Đang xử lý: ${fmtMoney(A.K.pending)} đ` : ''} tone="amber" />
          </div>

          <div className="chart-card" style={{ marginBottom: 14 }}>
            <h4>Doanh thu theo ngày {cmp && `(so với ${monthLabel(cmp).toLowerCase()})`}</h4>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={A.daily} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#eef1f5" />
                <XAxis dataKey="d" tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={{ stroke: '#e3e7ed' }} />
                <YAxis tickFormatter={(v) => fmtNum(v / 1e6, 0) + ' tr'} tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={false} width={64} />
                <Tooltip formatter={(v, n) => [fmtMoney(v) + ' đ', n]} labelFormatter={(l) => 'Ngày ' + l} />
                <Legend />
                <Bar dataKey="a" name={monthLabel(month)} fill="#1565c0" radius={[3, 3, 0, 0]} maxBarSize={22} />
                {cmp && <Line dataKey="pa" name={monthLabel(cmp)} stroke="#9aa5b1" strokeWidth={2} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="section-title">Theo nhân viên sale</div>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead><tr><th>Sale</th><th className="num">Doanh thu</th><th className="num">% tổng</th><th className="num">Tấn</th><th className="num">Giá BQ</th><th className="num">Số KH</th><th className="num">KH mới</th><th className="num">Số đơn</th>{cmp && <th className="num">So tháng trước</th>}</tr></thead>
              <tbody>
                {A.bySale.map((x) => (
                  <tr key={x.k}>
                    <td><b>{x.k}</b></td><td className="num"><b>{fmtMoney(x.a)}</b></td><td className="num">{A.K.a ? Math.round((x.a / A.K.a) * 100) : 0}%</td>
                    <td className="num">{tons(x.q)}</td><td className="num">{fmtMoney(x.q ? x.a / x.q : 0)}</td><td className="num">{x.nCust}</td>
                    <td className="num">{cmp ? x.newCust : '-'}</td><td className="num">{x.so.size}</td>
                    {cmp && <td className="num"><Chg cur={x.a} prev={x.prevA} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">Theo mặt hàng</div>
          <div className="table-wrap" style={{ marginBottom: 14, maxHeight: 420, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Mã hàng</th><th>Tên hàng</th><th className="num">Tấn</th><th className="num">Doanh thu</th><th className="num">Giá BQ</th><th className="num">Giá thấp – cao</th><th className="num">Số KH</th>{cmp && <><th className="num">Tấn tháng trước</th><th className="num">Giá BQ trước</th></>}</tr></thead>
              <tbody>
                {A.byItem.map((x) => (
                  <tr key={x.k}>
                    <td className="nowrap"><b>{x.k}</b></td><td className="small">{x.name}</td>
                    <td className="num">{tons(x.q)}</td><td className="num">{fmtMoney(x.a)}</td><td className="num"><b>{fmtMoney(x.avgP)}</b></td>
                    <td className="num small">{x.minP === Infinity ? '-' : `${fmtMoney(x.minP)} – ${fmtMoney(x.maxP)}`}</td><td className="num">{x.nCust}</td>
                    {cmp && <><td className="num">{x.prevQ ? tons(x.prevQ) : '-'} <Chg cur={x.q} prev={x.prevQ} /></td><td className="num">{x.prevAvg ? fmtMoney(x.prevAvg) : '-'}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">Top 20 khách hàng</div>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead><tr><th>Khách hàng</th><th>Sale</th><th className="num">Doanh thu</th><th className="num">Tấn</th><th className="num">Số đơn</th>{cmp && <th className="num">So tháng trước</th>}</tr></thead>
              <tbody>
                {A.byCust.slice(0, 20).map((x) => (
                  <tr key={x.k}>
                    <td>{x.name}{x.isNew && <> <span className="badge green">KH mới</span></>}<div className="small">{x.code}</div></td><td className="small">{x.sale}</td>
                    <td className="num"><b>{fmtMoney(x.a)}</b></td><td className="num">{tons(x.q)}</td><td className="num">{x.so.size}</td>
                    {cmp && <td className="num"><Chg cur={x.a} prev={x.prevA} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cmp && (
            <div className="grid2" style={{ marginBottom: 14 }}>
              <div>
                <div className="section-title">🆕 Khách mới mua trong tháng ({A.byCust.filter((x) => x.isNew).length})</div>
                <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
                  <table><thead><tr><th>Khách hàng</th><th>Sale</th><th className="num">Doanh thu</th></tr></thead>
                    <tbody>{A.byCust.filter((x) => x.isNew).map((x) => (
                      <tr key={x.k}><td>{x.name}</td><td className="small">{x.sale}</td><td className="num">{fmtMoney(x.a)}</td></tr>
                    ))}</tbody></table>
                </div>
              </div>
              <div>
                <div className="section-title">⚠ Khách tháng trước có mua, tháng này chưa mua ({A.lost.length})</div>
                <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
                  {A.lost.length === 0 ? <Empty text="Không có" /> : (
                    <table><thead><tr><th>Khách hàng</th><th>Sale</th><th className="num">DT tháng trước</th></tr></thead>
                      <tbody>{A.lost.map((x) => (
                        <tr key={x.k}><td>{x.name}</td><td className="small">{x.sale}</td><td className="num">{fmtMoney(x.a)}</td></tr>
                      ))}</tbody></table>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid2" style={{ marginBottom: 14 }}>
            <div>
              <div className="section-title">Theo công ty xuất</div>
              <div className="table-wrap">
                <table><thead><tr><th>Công ty</th><th className="num">Doanh thu</th><th className="num">Tấn</th><th className="num">% DT</th></tr></thead>
                  <tbody>{A.byCo.map((x) => (
                    <tr key={x.k}><td><b>{x.k}</b></td><td className="num">{fmtMoney(x.a)}</td><td className="num">{tons(x.q)}</td><td className="num">{A.K.a ? Math.round((x.a / A.K.a) * 100) : 0}%</td></tr>
                  ))}</tbody></table>
              </div>
            </div>
            <div>
              <div className="section-title">Theo kho xuất</div>
              <div className="table-wrap">
                <table><thead><tr><th>Kho</th><th className="num">Tấn</th><th className="num">Doanh thu</th></tr></thead>
                  <tbody>{A.byWh.map((x) => (
                    <tr key={x.k}><td className="small">{x.k}</td><td className="num">{tons(x.q)}</td><td className="num">{fmtMoney(x.a)}</td></tr>
                  ))}</tbody></table>
              </div>
            </div>
          </div>

          <div className="section-title">🔎 Đơn giá bất thường ({A.odd.length}) <span className="small">— thấp hơn 70% giá bình quân của mã hàng hoặc ≤ 1.000 đ/kg</span></div>
          <div className="table-wrap">
            {A.odd.length === 0 ? <Empty text="Không có" /> : (
              <table><thead><tr><th>Ngày</th><th>Số SO</th><th>Khách hàng</th><th>Mã hàng</th><th className="num">Số lượng (kg)</th><th className="num">Đơn giá</th><th className="num">Giá BQ mã hàng</th><th>Sale</th></tr></thead>
                <tbody>{A.odd.slice(0, 50).map((r, i) => (
                  <tr key={i}><td className="nowrap">{fmtDate(r.d)}</td><td className="small">{r.so}</td><td className="small">{r.cn}</td><td>{r.ic}</td>
                    <td className="num">{fmtMoney(r.q)}</td><td className="num"><b style={{ color: 'var(--red)' }}>{fmtMoney(r.p)}</b></td><td className="num">{fmtMoney(r.avg)}</td><td className="small">{r.sp}</td></tr>
                ))}</tbody></table>
            )}
          </div>
        </>
      )}
      {importing && <ImportSales onClose={() => setImporting(false)} onDone={() => setReload((x) => x + 1)} />}
    </>
  );
}

function ImportSales({ onClose, onDone }) {
  const { email } = useApp();
  const [res, setRes] = useState(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const load = async (file) => {
    setErr(''); setDone(''); setRes(null);
    try {
      const wb = await readWorkbook(file);
      const r = parseSales(sheetRows(wb, wb.SheetNames[0]));
      if (!r.rows.length) throw new Error('Không đọc được dòng bán hàng nào.');
      setRes(r); setFileName(file.name);
    } catch (e) { setErr(e.message); }
  };

  const months = useMemo(() => {
    if (!res) return [];
    const m = new Map();
    res.rows.forEach((r) => { const k = r.d.slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()].sort();
  }, [res]);
  const total = res ? res.rows.reduce((s, r) => s + r.a, 0) : 0;

  const run = async () => {
    setBusy('Đang ghi dữ liệu…'); setErr('');
    try {
      // Xóa phần cũ của các tháng có trong file rồi ghi lại
      const existing = await getDocs(collection(db, 'salesMonths'));
      const monthsInFile = new Set(months.map(([m]) => m));
      const b = writeBatch(db);
      existing.docs.filter((d) => monthsInFile.has(d.data().month)).forEach((d) => b.delete(d.ref));
      months.forEach(([m, rows]) => {
        for (let i = 0, part = 0; i < rows.length; i += PART, part++) {
          b.set(doc(db, 'salesMonths', `${m}_${part}`), {
            month: m, part, rows: rows.slice(i, i + PART), fileName, importedAt: serverTimestamp(), importedBy: email,
          });
        }
      });
      await b.commit();
      setDone(`Đã nhập ${res.rows.length} dòng bán hàng của ${months.map(([m]) => monthLabel(m)).join(', ')}.`);
      setRes(null);
      onDone();
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <Modal title="Nhập báo cáo bán hàng (Ecount)" onClose={onClose} wide>
      <p className="small">
        Trên Ecount: xuất báo cáo <b>Chi tiết tình hình bán hàng</b> (có cột Ngày-Số, Số SO, Khách hàng, Mã hàng, Số lượng đã bán, Đơn giá, Thành tiền, Sale phụ trách) ra Excel rồi chọn file ở đây.
        File có thể chứa nhiều tháng; tháng nào có trong file sẽ được <b>thay thế</b> bằng số liệu mới, các tháng khác giữ nguyên.
      </p>
      <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {res && (
        <>
          <div className="stats" style={{ marginTop: 12 }}>
            <Stat label="Số dòng" value={res.rows.length} />
            <Stat label="Tổng thành tiền" value={fmtMoney(total)} tone="green"
              sub={res.fileTotal != null ? (Math.abs(res.fileTotal - total) < 2 ? '✔ Khớp dòng Tổng cộng trong file' : `⚠ Tổng cộng trong file: ${fmtMoney(res.fileTotal)}`) : ''} />
            <Stat label="Sản lượng" value={tons(res.rows.reduce((s, r) => s + r.q, 0)) + ' tấn'} />
          </div>
          <div className="table-wrap">
            <table><thead><tr><th>Tháng</th><th className="num">Số dòng</th><th className="num">Doanh thu</th><th className="num">Tấn</th><th className="num">Số KH</th></tr></thead>
              <tbody>{months.map(([m, rows]) => (
                <tr key={m}><td><b>{monthLabel(m)}</b></td><td className="num">{rows.length}</td><td className="num">{fmtMoney(rows.reduce((s, r) => s + r.a, 0))}</td>
                  <td className="num">{tons(rows.reduce((s, r) => s + r.q, 0))}</td><td className="num">{new Set(rows.map((r) => r.cc || r.cn)).size}</td></tr>
              ))}</tbody></table>
          </div>
        </>
      )}
      {busy && <div className="ok-box" style={{ marginTop: 10 }}>{busy}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {res && <button type="button" className="btn primary" disabled={!!busy} onClick={run}>Nhập {res.rows.length} dòng</button>}
      </div>
    </Modal>
  );
}

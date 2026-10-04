import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { addDays, fmtDate, fmtMoney, fmtNum, monthStart, norm, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { readWorkbook, sheetRows } from '../lib/excelImport';
import { Empty, ErrorBox, Modal, Stat } from '../components/ui';
import { parseSales } from './SalesAnalysis';
import { staffForGroup } from './Receivables';

// ============================================================================
// Hàng đã xuất — nhập file Ecount "Chi tiết tình hình bán hàng" theo ngày/tuần.
// Lưu riêng ở shipments/{phiếu giao_mã hàng_lot}: cộng dồn, trùng thì ghi đè.
// KHÔNG đụng dữ liệu Phân tích bán hàng tháng (salesMonths).
// ============================================================================

const EXTRA = {
  dn: ['so phieu giao hang'], lot: ['batch lot'], oq: ['tong so luong hang dat ban'],
  tr: ['don vi van tai ten'], truck: ['so xe'],
};
const tons = (kg) => fmtNum(kg / 1000, 2);
const safeId = (s) => String(s).replace(/[/\s.#$[\]]+/g, '_').slice(0, 300);
const DONE = 'Đã hoàn tất';

const PRESETS = [
  ['Hôm nay', () => [today(), today()]],
  ['7 ngày', () => [addDays(today(), -6), today()]],
  ['Tháng này', () => [monthStart(), today()]],
  ['Tháng trước', () => { const e = addDays(monthStart(), -1); return [monthStart(e), e]; }],
  ['Tất cả', () => ['', '']],
];

function sum(rows) {
  return rows.reduce((t, r) => ({ q: t.q + r.q, a: t.a + r.a }), { q: 0, a: 0 });
}
function group(rows, key) {
  const m = new Map();
  rows.forEach((r) => {
    const k = key(r);
    if (!m.has(k)) m.set(k, { k, q: 0, a: 0, n: 0, cust: new Set(), dn: new Set(), rows: [] });
    const x = m.get(k);
    x.q += r.q; x.a += r.a; x.n += 1; x.cust.add(r.cc || r.cn); if (r.dn) x.dn.add(r.dn); x.rows.push(r);
  });
  return [...m.values()].sort((a, b) => b.q - a.q);
}

export default function Shipments() {
  const { email, isAdmin, staffList, staffName } = useApp();
  const [all, setAll] = useState(null);
  const [err, setErr] = useState('');
  const [reload, setReload] = useState(0);
  const [range, setRange] = useState(() => { const [f, t] = PRESETS[2][1](); return { from: f, to: t }; });
  const [staff, setStaff] = useState('');
  const [st, setSt] = useState('');
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const q = isAdmin ? collection(db, 'shipments') : query(collection(db, 'shipments'), where('ownerEmail', '==', email));
    getDocs(q).then((s) => setAll(s.docs.map((d) => ({ id: d.id, ...d.data() })))).catch((e) => { setErr(e.message); setAll([]); });
  }, [reload, isAdmin, email]);

  // Gán lại sale khi admin thêm/đổi tên nhân viên (khớp "Sale phụ trách" với Họ tên nhân viên)
  useEffect(() => {
    if (!isAdmin || !all?.length || !staffList.length) return;
    const todo = all.map((r) => [r, staffForGroup(staffList, r.sp, r.sp)?.email || '']).filter(([r, e]) => e !== (r.ownerEmail || ''));
    if (!todo.length) return;
    (async () => {
      try {
        for (let i = 0; i < todo.length; i += 400) {
          const b = writeBatch(db);
          todo.slice(i, i + 400).forEach(([r, e]) => b.update(doc(db, 'shipments', r.id), { ownerEmail: e }));
          await b.commit();
        }
        setMsg(`Đã gán sale cho ${todo.length} dòng hàng đã xuất theo tên "Sale phụ trách".`);
        setAll((x) => x.map((r) => { const t = todo.find(([y]) => y.id === r.id); return t ? { ...r, ownerEmail: t[1] } : r; }));
      } catch (e) { setMsg('Không gán được sale: ' + e.message); }
    })();
  }, [all?.length, staffList]);

  const s = norm(search);
  const rows = useMemo(() => (all || []).filter((r) => (!range.from || r.d >= range.from) && (!range.to || r.d <= range.to)
    && (!staff || r.ownerEmail === staff || (staff === '__none' && !r.ownerEmail)) && (!st || r.st === st)
    && (!s || [r.cn, r.cc, r.ic, r.in, r.so, r.dn, r.sp].some((v) => norm(v).includes(s))))
    .sort((a, b) => b.d.localeCompare(a.d) || String(b.dn).localeCompare(String(a.dn))), [all, range, staff, st, s]);

  const tot = sum(rows);
  const dnCount = new Set(rows.map((r) => r.dn).filter(Boolean)).size;
  const custCount = new Set(rows.map((r) => r.cc || r.cn)).size;
  const pending = rows.filter((r) => r.st && r.st !== DONE);
  const byDay = group(rows, (r) => r.d).sort((a, b) => a.k.localeCompare(b.k)).map((x) => ({ d: fmtDate(x.k).slice(0, 5), t: +(x.q / 1000).toFixed(2), a: x.a }));
  const bySale = group(rows, (r) => r.ownerEmail || 'n:' + r.sp);
  const byCust = group(rows, (r) => r.cc || r.cn);
  const byItem = group(rows, (r) => r.ic);
  const byWh = group(rows, (r) => r.wh || '(không ghi kho)');
  const statuses = [...new Set((all || []).map((r) => r.st).filter(Boolean))];
  const saleName = (x) => (x.rows[0].ownerEmail ? staffName(x.rows[0].ownerEmail) : x.rows[0].sp);
  const lastDate = (all || []).reduce((m, r) => (r.d > m ? r.d : m), '');

  const doExport = () => exportSheets(`HangDaXuat_${range.from || 'all'}_${range.to || ''}`, {
    'Chi tiết': rows.map((r) => ({
      Ngày: fmtDate(r.d), 'Số phiếu giao': r.dn, 'Số SO': r.so, 'Hiện trạng': r.st, Kho: r.wh, 'Mã KH': r.cc, 'Khách hàng': r.cn,
      'Mã hàng': r.ic, 'Tên hàng': r.in, Lot: r.lot, 'SL đặt': r.oq, 'SL đã xuất (kg)': r.q, 'Đơn giá': r.p, 'Thành tiền': r.a,
      Sale: r.ownerEmail ? staffName(r.ownerEmail) : r.sp, 'Vận tải': r.tr, 'Số xe': r.truck,
    })),
    'Theo khách hàng': byCust.map((x) => ({ 'Khách hàng': x.rows[0].cn, 'Mã KH': x.rows[0].cc, 'Tấn': +(x.q / 1000).toFixed(3), 'Thành tiền': x.a, 'Số phiếu': x.dn.size })),
    'Theo mã hàng': byItem.map((x) => ({ 'Mã hàng': x.k, 'Tên hàng': x.rows[0].in, 'Tấn': +(x.q / 1000).toFixed(3), 'Thành tiền': x.a, 'Giá BQ': x.q ? Math.round(x.a / x.q) : 0 })),
  });

  if (all === null) return <Empty text="Đang tải…" />;

  return (
    <>
      <div className="page-head">
        <h1>🚚 Hàng đã xuất {isAdmin ? '' : 'của tôi'}</h1>
        <div className="actions">
          <button className="btn" onClick={doExport} disabled={!rows.length}>⬇ Excel</button>
          {isAdmin && <button className="btn primary" onClick={() => setImporting(true)}>⬆ Nhập file hàng đã xuất (Ecount)</button>}
        </div>
      </div>
      <div className="filters">
        <div className="presets">
          {PRESETS.map(([l, fn]) => {
            const [f, t] = fn();
            return <button key={l} className={'chip' + (range.from === f && range.to === t ? ' on' : '')} onClick={() => setRange({ from: f, to: t })}>{l}</button>;
          })}
        </div>
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span>→</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        {isAdmin && (
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">Tất cả sale</option>
            {staffList.filter((x) => x.role !== 'accountant').map((x) => <option key={x.email} value={x.email}>{x.name || x.email}</option>)}
            <option value="__none">(Chưa khớp nhân viên)</option>
          </select>
        )}
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">Mọi hiện trạng</option>{statuses.map((x) => <option key={x}>{x}</option>)}
        </select>
        <input placeholder="Tìm KH, mã hàng, SO, phiếu…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="small" style={{ margin: '0 0 8px' }}>
        Số liệu xuất kho từ Ecount, cập nhật đến ngày <b>{fmtDate(lastDate) || '—'}</b>. Báo cáo này lưu riêng, không ảnh hưởng mục Phân tích bán hàng theo tháng.
      </p>
      <ErrorBox error={err} />
      {msg && <div className="ok-box" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="stats">
        <Stat label="Đã xuất" value={tons(tot.q) + ' tấn'} sub={`${fmtNum(tot.q, 0)} kg`} tone="green" />
        <Stat label="Thành tiền (trước thuế)" value={fmtMoney(tot.a) + ' đ'} tone="green" />
        <Stat label="Số phiếu giao / khách hàng" value={`${dnCount} / ${custCount}`} />
        <Stat label="Phiếu chưa hoàn tất" value={pending.length} sub={tons(sum(pending).q) + ' tấn đang xử lý'} tone="amber" onClick={() => setSt(st ? '' : statuses.find((x) => x !== DONE) || '')} active={!!st} />
      </div>

      {rows.length === 0 ? <Empty text={all.length ? 'Không có hàng xuất trong khoảng này' : (isAdmin ? 'Bấm "Nhập file hàng đã xuất" để tải file Ecount' : 'Chưa có dữ liệu')} /> : (
        <>
          {byDay.length > 1 && (
            <div className="chart-card" style={{ marginBottom: 14 }}>
              <h4>Sản lượng xuất theo ngày (tấn)</h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDay} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="#eef1f5" />
                  <XAxis dataKey="d" tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip formatter={(v, n, p) => [`${v} tấn · ${fmtMoney(p.payload.a)} đ`, 'Đã xuất']} />
                  <Bar dataKey="t" fill="#2e7d32" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid2" style={{ marginBottom: 14 }}>
            {isAdmin && (
              <div>
                <div className="section-title">Theo sale</div>
                <div className="table-wrap">
                  <table><thead><tr><th>Sale</th><th className="num">Tấn</th><th className="num">Thành tiền</th><th className="num">Phiếu</th><th className="num">KH</th></tr></thead>
                    <tbody>{bySale.map((x) => (
                      <tr key={x.k} style={{ cursor: x.rows[0].ownerEmail ? 'pointer' : undefined }} onClick={() => x.rows[0].ownerEmail && setStaff(x.rows[0].ownerEmail)}>
                        <td>{x.rows[0].ownerEmail ? <b>{saleName(x)}</b> : <span className="badge red" title="Thêm nhân viên có Họ tên trùng tên này">{x.rows[0].sp}</span>}</td>
                        <td className="num"><b>{tons(x.q)}</b></td><td className="num">{fmtMoney(x.a)}</td><td className="num">{x.dn.size}</td><td className="num">{x.cust.size}</td>
                      </tr>
                    ))}</tbody></table>
                </div>
              </div>
            )}
            <div>
              <div className="section-title">Theo mã hàng</div>
              <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
                <table><thead><tr><th>Mã hàng</th><th className="num">Tấn</th><th className="num">Thành tiền</th><th className="num">Giá BQ</th></tr></thead>
                  <tbody>{byItem.map((x) => (
                    <tr key={x.k}><td><b>{x.k}</b><div className="small">{x.rows[0].in}</div></td><td className="num"><b>{tons(x.q)}</b></td>
                      <td className="num">{fmtMoney(x.a)}</td><td className="num">{x.q ? fmtMoney(Math.round(x.a / x.q)) : '-'}</td></tr>
                  ))}</tbody></table>
              </div>
            </div>
            <div>
              <div className="section-title">Theo khách hàng</div>
              <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
                <table><thead><tr><th>Khách hàng</th><th className="num">Tấn</th><th className="num">Thành tiền</th><th className="num">Phiếu</th></tr></thead>
                  <tbody>{byCust.map((x) => (
                    <tr key={x.k}><td><b>{x.rows[0].cn}</b><div className="small">{x.rows[0].cc}</div></td><td className="num"><b>{tons(x.q)}</b></td>
                      <td className="num">{fmtMoney(x.a)}</td><td className="num">{x.dn.size}</td></tr>
                  ))}</tbody></table>
              </div>
            </div>
            <div>
              <div className="section-title">Theo kho</div>
              <div className="table-wrap">
                <table><thead><tr><th>Kho</th><th className="num">Tấn</th><th className="num">Thành tiền</th><th className="num">Phiếu</th></tr></thead>
                  <tbody>{byWh.map((x) => (
                    <tr key={x.k}><td>{x.k}</td><td className="num"><b>{tons(x.q)}</b></td><td className="num">{fmtMoney(x.a)}</td><td className="num">{x.dn.size}</td></tr>
                  ))}</tbody></table>
              </div>
            </div>
          </div>

          <p className="small">Số lượng <b>còn phải giao theo từng đơn</b> xem ở mục <Link to="/ton-kho">🏭 Tồn kho & Hàng về → ③ Đơn chưa giao</Link> (lấy chính xác từ Ecount).</p>

          <div className="section-title">Chi tiết phiếu xuất ({rows.length} dòng)</div>
          <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
            <table><thead><tr><th>Ngày</th><th>Phiếu giao / SO</th><th>Khách hàng</th><th>Mã hàng</th><th className="num">SL (kg)</th><th className="num">Đơn giá</th><th className="num">Thành tiền</th><th>Hiện trạng</th>{isAdmin && <th>Sale</th>}<th>Kho / Xe</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.d)}</td>
                  <td className="nowrap small">{r.dn}<div>{r.so}</div></td>
                  <td>{r.cn}</td>
                  <td><b>{r.ic}</b>{r.lot && <div className="small">{r.lot}</div>}</td>
                  <td className="num"><b>{fmtNum(r.q, 0)}</b>{r.oq > r.q && <div className="small">/ {fmtNum(r.oq, 0)} đặt</div>}</td>
                  <td className="num">{fmtMoney(r.p)}</td>
                  <td className="num">{fmtMoney(r.a)}</td>
                  <td><span className={'badge ' + (r.st === DONE ? 'green' : 'amber')}>{r.st || '-'}</span></td>
                  {isAdmin && <td>{r.ownerEmail ? staffName(r.ownerEmail) : <span className="small">{r.sp}</span>}</td>}
                  <td className="small">{r.wh}{(r.tr || r.truck) && <div>{[r.tr, r.truck].filter(Boolean).join(' · ')}</div>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={4}>Tổng</td><td className="num">{fmtNum(tot.q, 0)}</td><td></td><td className="num">{fmtMoney(tot.a)}</td><td colSpan={isAdmin ? 3 : 2}></td></tr></tfoot>
            </table>
          </div>
        </>
      )}
      {importing && <ImportShipments onClose={() => setImporting(false)} onDone={() => setReload((x) => x + 1)} />}
    </>
  );
}

function ImportShipments({ onClose, onDone }) {
  const { email, staffList } = useApp();
  const [res, setRes] = useState(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const load = async (file) => {
    setErr(''); setDone(''); setRes(null);
    try {
      const wb = await readWorkbook(file);
      const r = parseSales(sheetRows(wb, wb.SheetNames[0]), EXTRA, ['oq']);
      if (!r.rows.length) throw new Error('Không đọc được dòng hàng xuất nào.');
      // Khóa chống trùng: Số phiếu giao + Mã hàng + Lot (trùng trong cùng file thì đánh số thêm)
      const seen = new Map();
      r.rows.forEach((x) => {
        const base = safeId(x.dn ? `${x.dn}_${x.ic}_${x.lot || ''}` : `${x.d}_${x.so}_${x.ic}_${x.cc}_${x.q}`);
        const n = (seen.get(base) || 0) + 1; seen.set(base, n);
        x.id = n > 1 ? `${base}_${n}` : base;
        x.ownerEmail = staffForGroup(staffList, x.sp, x.sp)?.email || '';
      });
      setRes(r); setFileName(file.name);
    } catch (e) { setErr(e.message); }
  };

  const total = res ? res.rows.reduce((s, r) => s + r.a, 0) : 0;
  const dates = res ? res.rows.map((r) => r.d).sort() : [];
  const unmatched = res ? [...new Set(res.rows.filter((r) => !r.ownerEmail).map((r) => r.sp))] : [];

  const run = async () => {
    setBusy('Đang ghi dữ liệu…'); setErr('');
    try {
      const existing = new Set((await getDocs(collection(db, 'shipments'))).docs.map((d) => d.id));
      let added = 0; let updated = 0;
      for (let i = 0; i < res.rows.length; i += 400) {
        const b = writeBatch(db);
        res.rows.slice(i, i + 400).forEach(({ id, ...x }) => {
          if (existing.has(id)) updated += 1; else added += 1;
          b.set(doc(db, 'shipments', id), { ...x, fileName, importedAt: serverTimestamp(), importedBy: email });
        });
        await b.commit();
        setBusy(`Đã ghi ${Math.min(i + 400, res.rows.length)}/${res.rows.length} dòng…`);
      }
      setDone(`Xong: thêm mới ${added} dòng, cập nhật ${updated} dòng đã có (từ ${fmtDate(dates[0])} đến ${fmtDate(dates[dates.length - 1])}).`);
      setRes(null);
      onDone();
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <Modal title="Nhập file hàng đã xuất (Ecount)" onClose={onClose} wide>
      <p className="small">
        Trên Ecount xuất báo cáo <b>Chi tiết tình hình bán hàng</b> cho khoảng ngày cần (VD hôm qua, tuần này) rồi chọn file ở đây.
        Dữ liệu được <b>cộng dồn</b>: dòng trùng <b>Số phiếu giao hàng + Mã hàng + Lot</b> sẽ được cập nhật, nên nhập lại file cũ không bị nhân đôi.
        Báo cáo này <b>không</b> ảnh hưởng mục Phân tích bán hàng theo tháng.
      </p>
      <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {res && (
        <>
          <div className="stats" style={{ marginTop: 12 }}>
            <Stat label="Số dòng" value={res.rows.length} sub={`${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}`} />
            <Stat label="Đã xuất" value={tons(res.rows.reduce((s, r) => s + r.q, 0)) + ' tấn'} tone="green" />
            <Stat label="Tổng thành tiền" value={fmtMoney(total)} tone="green"
              sub={res.fileTotal != null ? (Math.abs(res.fileTotal - total) < 2 ? '✔ Khớp dòng Tổng cộng trong file' : `Tổng cộng trong file: ${fmtMoney(res.fileTotal)}`) : ''} />
          </div>
          {unmatched.length > 0 && (
            <p className="small">Sale chưa khớp nhân viên: <b>{unmatched.join(', ')}</b> — vẫn nhập được; khi thêm nhân viên có Họ tên trùng, dữ liệu sẽ tự gán.</p>
          )}
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

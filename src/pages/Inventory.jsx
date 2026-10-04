import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { addDays, fmtDate, fmtMoney, fmtNum, norm, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, readWorkbook, sheetRows, toNumber } from '../lib/excelImport';
import { Empty, ErrorBox, Modal, Stat } from '../components/ui';
import { staffForGroup } from './Receivables';

// ============================================================================
// Tồn kho & Hàng về — 3 báo cáo Ecount (số liệu tại thời điểm, nhập lần mới thay bản cũ):
//  • Số dư hàng tồn kho (cho sale)  → stockSnap/stock_{n}   (mọi nhân viên xem)
//  • Hàng chưa về (ETA)             → stockSnap/incoming_{n} (mọi nhân viên xem)
//  • Đơn bán hàng chưa xuất kho     → openOrders/{id}        (sale chỉ xem đơn của mình)
// ============================================================================

const PART = 800;
const t3 = (kg) => fmtNum((kg || 0) / 1000, 1);
const ymd = (s) => { const m = cellText(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const ageDays = (d) => (d ? Math.round((Date.parse(today()) - Date.parse(d)) / 86400000) : null);
const monday = (d) => { const x = new Date(d + 'T00:00:00Z'); const w = (x.getUTCDay() + 6) % 7; return addDays(d, -w); };
const entityOf = (wh) => {
  const n = norm(wh);
  if (n.includes('diamond')) return 'DAM';
  const p = String(wh).split('-')[0].trim().toUpperCase();
  if (p === 'DM') return 'DAM';
  return p.length <= 4 ? p : n === 'kho tong' ? 'Kho tổng' : 'Khác';
};
const AGE = [['0–30 ngày', 0, 30], ['31–60 ngày', 31, 60], ['61–90 ngày', 61, 90], ['Trên 90 ngày', 91, 1e9]];

// Tìm cột theo tiêu đề (không dấu)
function headIdx(rows, must) {
  const hr = rows.findIndex((r) => must.every((m) => r.some((c) => norm(c) === m)));
  if (hr < 0) return null;
  const head = rows[hr].map(norm);
  return { hr, head, col: (...al) => head.findIndex((h) => al.includes(h)) };
}
const fileDate = (rows) => { for (const r of rows.slice(0, 3)) for (const c of r) { const m = cellText(c).match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(\/|$)/); if (m) return ymd(m[1]); } return ''; };

// Nhận diện & đọc 1 trong 3 file
export function parseEcountFile(rows) {
  let h = headIdx(rows, ['ma mat hang', 'ton kho thuc te']);
  if (h) {
    const c = { cat: h.col('tinh chat'), ic: h.col('ma mat hang'), in: h.col('ten mat hang'), price: h.col('gia ban'), onHand: h.col('ton kho thuc te'),
      unshipped: h.col('so luong hang chua giao'), incoming: h.col('so hang hang chua ve', 'so luong hang chua ve'), avail: h.col('sl co the ban') };
    const firstWh = Math.max(...Object.values(c)) + 1;
    const whs = rows[h.hr].map((x, i) => [i, cellText(x)]).filter(([i, n]) => i >= firstWh && n);
    const out = [];
    rows.slice(h.hr + 1).forEach((r) => {
      const ic = cellText(r[c.ic]);
      if (!ic || norm(r[0]) === 'tong') return;
      const wh = {};
      whs.forEach(([i, n]) => { const q = toNumber(r[i]); if (q) wh[n] = q; });
      const x = { cat: cellText(r[c.cat]), ic, in: cellText(r[c.in]), price: toNumber(r[c.price]), onHand: toNumber(r[c.onHand]),
        unshipped: toNumber(r[c.unshipped]), incoming: toNumber(r[c.incoming]), wh };
      x.avail = c.avail >= 0 && cellText(r[c.avail]) !== '' ? toNumber(r[c.avail]) : x.onHand - x.unshipped + x.incoming;
      out.push(x);
    });
    return { type: 'stock', rows: out, asOf: fileDate(rows) };
  }
  h = headIdx(rows, ['so luong hang chua giao', 'ma hang']);
  if (h) {
    const c = { st: h.col('hien trang'), dd: h.col('ngay giao hang'), ds: h.col('ngay so'), so: h.col('so don ban hang'), note: h.col('ghi chu'),
      cc: h.col('ma khach hang nha cung cap'), cn: h.col('ten khach hang nha cung cap'), wh: h.col('ten kho'), ic: h.col('ma hang'), in: h.col('ten hang'),
      p: h.col('don gia'), oq: h.col('tong so luong don hang'), dq: h.col('sl da giao'), left: h.col('so luong hang chua giao'),
      a: h.col('so tien truoc thue hang chua ban'), sp: h.col('ten nguoi phu trach'), info: h.col('thong tin tu sale') };
    const out = [];
    rows.slice(h.hr + 1).forEach((r) => {
      const ic = cellText(r[c.ic]);
      if (!ic) return;
      const g = (k) => (c[k] >= 0 ? r[c[k]] : '');
      out.push({ st: cellText(g('st')), dd: ymd(g('dd')), od: ymd(g('ds')), so: cellText(g('so')), note: cellText(g('note')), cc: cellText(g('cc')), cn: cellText(g('cn')),
        wh: cellText(g('wh')), ic, in: cellText(g('in')), p: toNumber(g('p')), oq: toNumber(g('oq')), dq: toNumber(g('dq')), left: toNumber(g('left')),
        a: toNumber(g('a')), sp: cellText(g('sp')) || '(chưa ghi)', info: cellText(g('info')) });
    });
    return { type: 'orders', rows: out, asOf: fileDate(rows) || today() };
  }
  h = headIdx(rows, ['ma mat hang', 'eta']);
  if (h) {
    const c = { co: h.col('ma cong ty'), sup: h.col('ma khach hang nha cung cap'), ic: h.col('ma mat hang'), q: h.col('so luong'),
      left: h.col('so luong chua mua hang'), eta: h.col('eta'), port: h.col('cang den'), origin: h.col('xuat xu') };
    const out = [];
    rows.slice(h.hr + 1).forEach((r) => {
      const ic = cellText(r[c.ic]);
      if (!ic || norm(r[0]) === 'tong cong') return;
      const g = (k) => (c[k] >= 0 ? r[c[k]] : '');
      const left = c.left >= 0 ? toNumber(g('left')) : toNumber(g('q'));
      if (!left) return;
      out.push({ co: cellText(g('co')), sup: cellText(g('sup')), ic, q: toNumber(g('q')), left, eta: ymd(g('eta')), port: cellText(g('port')), origin: cellText(g('origin')) });
    });
    return { type: 'incoming', rows: out, asOf: today() };
  }
  throw new Error('Không nhận ra file. Cần 1 trong 3 báo cáo Ecount: Số dư hàng tồn kho (cho sale), Đơn bán hàng chưa xuất kho, Tình hình chưa mua hàng (Hàng chưa về).');
}

function useSnap(reload) {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    getDocs(collection(db, 'stockSnap')).then((s) => {
      const out = { stock: [], incoming: [], meta: {} };
      s.docs.forEach((d) => {
        const x = d.data();
        if (d.id === 'meta') out.meta = x;
        else if (x.type === 'stock') out.stock.push(...(x.rows || []));
        else if (x.type === 'incoming') out.incoming.push(...(x.rows || []));
      });
      setSnap(out);
    }).catch((e) => { setErr(e.message); setSnap({ stock: [], incoming: [], meta: {} }); });
  }, [reload]);
  return [snap, err];
}

const TABS = [['avail', '① Có thể bán'], ['wh', '② Tồn theo kho'], ['orders', '③ Đơn chưa giao'], ['incoming', '④ Hàng chưa về']];

export default function Inventory() {
  const { email, isAdmin } = useApp();
  const [tab, setTab] = useState('avail');
  const [reload, setReload] = useState(0);
  const [snap, err] = useSnap(reload);
  const [orders, setOrders] = useState(null);
  const [oErr, setOErr] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const q = isAdmin ? collection(db, 'openOrders') : query(collection(db, 'openOrders'), where('ownerEmail', '==', email));
    getDocs(q).then((s) => setOrders(s.docs.map((d) => ({ id: d.id, ...d.data() })))).catch((e) => { setOErr(e.message); setOrders([]); });
  }, [reload, isAdmin, email]);

  if (!snap || !orders) return <Empty text="Đang tải…" />;
  const m = snap.meta || {};
  const stockBy = new Map(snap.stock.map((x) => [x.ic, x]));

  return (
    <>
      <div className="page-head">
        <h1>🏭 Tồn kho & Hàng về</h1>
        <div className="actions">{isAdmin && <button className="btn primary" onClick={() => setImporting(true)}>⬆ Nhập file Ecount (tồn kho / đơn chưa giao / hàng chưa về)</button>}</div>
      </div>
      <p className="small" style={{ margin: '0 0 8px' }}>
        Tồn kho: <b>{m.stockAt ? fmtDate(m.stockAt) : 'chưa nhập'}</b> · Đơn chưa giao: <b>{m.ordersAt ? fmtDate(m.ordersAt) : 'chưa nhập'}</b> · Hàng chưa về: <b>{m.incomingAt ? fmtDate(m.incomingAt) : 'chưa nhập'}</b>
      </p>
      <div className="presets" style={{ marginBottom: 10 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <ErrorBox error={err || oErr} />
      {tab === 'avail' && <AvailTab stock={snap.stock} incoming={snap.incoming} orders={orders} />}
      {tab === 'wh' && <WarehouseTab stock={snap.stock} />}
      {tab === 'orders' && <OrdersTab orders={orders} stockBy={stockBy} />}
      {tab === 'incoming' && <IncomingTab incoming={snap.incoming} stockBy={stockBy} />}
      {importing && <ImportInventory onClose={() => setImporting(false)} onDone={() => setReload((x) => x + 1)} />}
    </>
  );
}

// ① Có thể bán ---------------------------------------------------------------
function AvailTab({ stock, incoming, orders }) {
  const { isAdmin, staffName } = useApp();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [only, setOnly] = useState('active');
  const [open, setOpen] = useState('');
  const inc = useMemo(() => {
    const mp = new Map();
    incoming.forEach((r) => { if (!mp.has(r.ic)) mp.set(r.ic, []); mp.get(r.ic).push(r); });
    mp.forEach((l) => l.sort((a, b) => (a.eta || '9').localeCompare(b.eta || '9')));
    return mp;
  }, [incoming]);
  const cats = [...new Set(stock.map((x) => x.cat).filter(Boolean))].sort();
  const s = norm(search);
  const rows = stock.filter((x) => (!cat || x.cat === cat) && (!s || norm(x.ic).includes(s) || norm(x.in).includes(s) || norm(x.cat).includes(s))
    && (only === 'all' || (only === 'active' ? x.onHand || x.unshipped || x.incoming : only === 'short' ? x.avail < 0 : only === 'over' ? x.unshipped > x.onHand : x.avail > 0)))
    .sort((a, b) => b.onHand - a.onHand || b.avail - a.avail);
  const sum = (k, l = stock) => l.reduce((t, x) => t + (x[k] || 0), 0);
  const nextEta = (ic) => (inc.get(ic) || []).find((r) => r.eta && r.eta >= today());

  const doExport = () => exportSheets(`CoTheBan_${today()}`, {
    'Có thể bán': rows.map((x) => ({ 'Tính chất': x.cat, 'Mã hàng': x.ic, 'Tên hàng': x.in, 'Giá bán': x.price, 'Tồn thực tế': x.onHand, 'Chưa giao': x.unshipped, 'Chưa về': x.incoming, 'Có thể bán': x.avail,
      'Hàng về gần nhất': nextEta(x.ic) ? fmtDate(nextEta(x.ic).eta) : '', ...x.wh })),
  });

  return (
    <>
      <div className="stats">
        <Stat label="Tồn kho thực tế" value={t3(sum('onHand')) + ' tấn'} sub={`${stock.filter((x) => x.onHand > 0).length} mã có tồn`} tone="green" />
        <Stat label="Đơn chưa giao (đã hứa khách)" value={t3(sum('unshipped')) + ' tấn'} tone="amber" />
        <Stat label="Hàng chưa về" value={t3(sum('incoming')) + ' tấn'} />
        <Stat label="Có thể bán thêm" value={t3(stock.reduce((t, x) => t + Math.max(0, x.avail), 0)) + ' tấn'} tone="green" sub="Tồn − chưa giao + chưa về (mã dương)" />
        <Stat label="Mã thiếu hàng (âm)" value={stock.filter((x) => x.avail < 0).length} sub={t3(-stock.reduce((t, x) => t + Math.min(0, x.avail), 0)) + ' tấn thiếu'} tone="red"
          onClick={() => setOnly(only === 'short' ? 'active' : 'short')} active={only === 'short'} />
      </div>
      <div className="filters">
        <input placeholder="Tìm mã / tên hàng / tính chất…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Mọi tính chất</option>{cats.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="active">Mã có tồn / đơn / hàng về</option><option value="sell">Còn bán được (dương)</option>
          <option value="short">Thiếu hàng (âm)</option><option value="over">Đơn chưa giao &gt; tồn hiện có</option><option value="all">Tất cả mã</option>
        </select>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={doExport} disabled={!rows.length}>⬇ Excel</button>
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? <Empty text={stock.length ? 'Không có mã phù hợp' : 'Chưa nhập Báo cáo tồn kho'} /> : (
          <table>
            <thead><tr><th>Mã hàng</th><th>Tính chất</th><th className="num">Giá bán</th><th className="num">Tồn thực tế</th><th className="num">Chưa giao</th>
              <th className="num">Chưa về</th><th className="num">Có thể bán</th><th>Hàng về gần nhất</th></tr></thead>
            <tbody>
              {rows.map((x) => {
                const ne = nextEta(x.ic);
                const isOpen = open === x.ic;
                const myOrders = orders.filter((o) => o.ic === x.ic);
                return (
                  <Fragment key={x.ic}>
                    <tr onClick={() => setOpen(isOpen ? '' : x.ic)} style={{ cursor: 'pointer', background: x.avail < 0 ? 'var(--red-soft)' : isOpen ? 'var(--primary-soft)' : undefined }}>
                      <td><b>{isOpen ? '▾' : '▸'} {x.ic}</b><div className="small">{x.in}</div></td>
                      <td className="small">{x.cat}</td>
                      <td className="num">{x.price ? fmtMoney(x.price) : '-'}</td>
                      <td className="num"><b>{fmtNum(x.onHand, 0)}</b></td>
                      <td className="num">{x.unshipped ? <span style={{ color: x.unshipped > x.onHand ? 'var(--red)' : undefined }}>{fmtNum(x.unshipped, 0)}</span> : '-'}</td>
                      <td className="num">{x.incoming ? fmtNum(x.incoming, 0) : '-'}</td>
                      <td className="num"><b style={{ color: x.avail < 0 ? 'var(--red)' : x.avail > 0 ? 'var(--green)' : undefined }}>{fmtNum(x.avail, 0)}</b></td>
                      <td className="nowrap small">{ne ? <>{fmtDate(ne.eta)} · {t3(ne.left)} t</> : (inc.get(x.ic)?.length ? 'Chưa có ETA' : '-')}</td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={8} style={{ background: '#fafbfd' }}>
                        <div className="grid2">
                          <div>
                            <div className="small"><b>Tồn từng kho</b></div>
                            {Object.keys(x.wh || {}).length ? Object.entries(x.wh).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                              <div key={k} className="small">{k}: <b>{fmtNum(v, 0)}</b> kg</div>)) : <div className="small">Không có tồn</div>}
                          </div>
                          <div>
                            <div className="small"><b>Hàng đang về ({(inc.get(x.ic) || []).length} lô)</b></div>
                            {(inc.get(x.ic) || []).map((r, i) => (
                              <div key={i} className="small">{r.eta ? fmtDate(r.eta) : 'Chưa có ETA'} · <b>{fmtNum(r.left, 0)}</b> kg · {r.port || '-'} · {r.origin} · NCC {r.sup}</div>
                            ))}
                          </div>
                        </div>
                        {myOrders.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div className="small"><b>Đơn chưa giao{isAdmin ? '' : ' của bạn'}</b></div>
                            {myOrders.map((o) => <div key={o.id} className="small">{fmtDate(o.od)} · {o.so} · {o.cn} · còn <b>{fmtNum(o.left, 0)}</b> kg{isAdmin ? ' · ' + (o.ownerEmail ? staffName(o.ownerEmail) : o.sp) : ''}</div>)}
                          </div>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="small">Bấm vào một mã để xem tồn từng kho, các lô hàng đang về và đơn chưa giao. Đơn vị: kg.</p>
    </>
  );
}

// ② Tồn theo kho -------------------------------------------------------------
function WarehouseTab({ stock }) {
  const [sel, setSel] = useState('');
  const whs = useMemo(() => {
    const mp = new Map();
    stock.forEach((x) => Object.entries(x.wh || {}).forEach(([k, v]) => {
      if (!mp.has(k)) mp.set(k, { k, ent: entityOf(k), q: 0, items: [] });
      const w = mp.get(k); w.q += v; if (v > 0) w.items.push({ ...x, q: v });
    }));
    return [...mp.values()].sort((a, b) => b.q - a.q);
  }, [stock]);
  const ents = useMemo(() => {
    const mp = new Map();
    whs.forEach((w) => { if (!mp.has(w.ent)) mp.set(w.ent, 0); mp.set(w.ent, mp.get(w.ent) + w.q); });
    return [...mp.entries()].sort((a, b) => b[1] - a[1]);
  }, [whs]);
  const cur = whs.find((w) => w.k === sel);
  const doExport = () => exportSheets(`TonTheoKho_${today()}`, {
    'Theo kho': whs.map((w) => ({ 'Pháp nhân': w.ent, Kho: w.k, 'Tồn (kg)': w.q, 'Số mã': w.items.length })),
    ...(cur ? { [cur.k.slice(0, 28)]: cur.items.map((x) => ({ 'Mã hàng': x.ic, 'Tên hàng': x.in, 'Tồn (kg)': x.q })) } : {}),
  });
  if (!stock.length) return <Empty text="Chưa nhập Báo cáo tồn kho" />;
  return (
    <>
      <div className="stats">{ents.map(([e, q]) => <Stat key={e} label={'Tồn ' + e} value={t3(q) + ' tấn'} tone={e === 'VAP' ? 'green' : e === 'PLA' ? 'amber' : ''} />)}</div>
      <div className="grid2">
        <div>
          <div className="section-title">Tồn theo kho <button className="btn sm" style={{ float: 'right' }} onClick={doExport}>⬇ Excel</button></div>
          <div className="table-wrap">
            <table><thead><tr><th>Pháp nhân</th><th>Kho</th><th className="num">Tấn</th><th className="num">Số mã</th></tr></thead>
              <tbody>{whs.map((w) => (
                <tr key={w.k} onClick={() => setSel(w.k)} style={{ cursor: 'pointer', background: sel === w.k ? 'var(--primary-soft)' : undefined }}>
                  <td><span className={'badge ' + (w.ent === 'VAP' ? 'blue' : w.ent === 'PLA' ? 'amber' : '')}>{w.ent}</span></td>
                  <td>{w.k}</td><td className="num"><b>{t3(w.q)}</b></td><td className="num">{w.items.length}</td>
                </tr>
              ))}</tbody></table>
          </div>
        </div>
        <div>
          <div className="section-title">{cur ? `Mã hàng trong ${cur.k}` : 'Bấm vào một kho để xem mã hàng'}</div>
          {cur && (
            <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
              <table><thead><tr><th>Mã hàng</th><th className="num">Tồn (kg)</th><th className="num">Có thể bán (toàn cty)</th></tr></thead>
                <tbody>{cur.items.sort((a, b) => b.q - a.q).map((x) => (
                  <tr key={x.ic}><td><b>{x.ic}</b><div className="small">{x.in}</div></td><td className="num"><b>{fmtNum(x.q, 0)}</b></td>
                    <td className="num" style={{ color: x.avail < 0 ? 'var(--red)' : undefined }}>{fmtNum(x.avail, 0)}</td></tr>
                ))}</tbody></table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ③ Đơn chưa giao ------------------------------------------------------------
function OrdersTab({ orders, stockBy }) {
  const { isAdmin, staffName } = useApp();
  const [age, setAge] = useState('');
  const [search, setSearch] = useState('');
  const [short, setShort] = useState(false);
  const itemLeft = useMemo(() => { const mp = new Map(); orders.forEach((o) => mp.set(o.ic, (mp.get(o.ic) || 0) + o.left)); return mp; }, [orders]);
  // Thiếu hàng: kể cả hàng đang về vẫn không đủ (SL có thể bán âm). Chờ hàng về: tồn hiện tại chưa đủ nhưng hàng về sẽ đủ.
  const isShort = (o) => { const s = stockBy.get(o.ic); return s ? s.avail < 0 : false; };
  const isWait = (o) => { const s = stockBy.get(o.ic); return s ? !isShort(o) && s.onHand < (s.unshipped || itemLeft.get(o.ic)) : false; };
  const s = norm(search);
  const all = orders.map((o) => ({ ...o, age: ageDays(o.od || o.dd) })).sort((a, b) => (b.age || 0) - (a.age || 0));
  const rows = all.filter((o) => (!age || (o.age >= AGE.find((x) => x[0] === age)[1] && o.age <= AGE.find((x) => x[0] === age)[2]))
    && (!short || isShort(o)) && (!s || [o.cn, o.cc, o.ic, o.so, o.sp].some((v) => norm(v).includes(s))));
  const tot = (l) => l.reduce((t, o) => ({ q: t.q + o.left, a: t.a + o.a }), { q: 0, a: 0 });
  const T = tot(all);
  const grp = (key) => { const mp = new Map(); rows.forEach((o) => { const k = key(o); if (!mp.has(k)) mp.set(k, { k, q: 0, a: 0, n: 0, o }); const x = mp.get(k); x.q += o.left; x.a += o.a; x.n += 1; }); return [...mp.values()].sort((a, b) => b.q - a.q); };
  const bySale = grp((o) => o.ownerEmail || 'n:' + o.sp);
  const byCust = grp((o) => o.cc || o.cn);
  const byItem = grp((o) => o.ic);
  const doExport = () => exportSheets(`DonChuaGiao_${today()}`, {
    'Đơn chưa giao': rows.map((o) => ({ 'Ngày đơn': fmtDate(o.od), 'Ngày giao': fmtDate(o.dd), 'Số ngày': o.age, 'Số đơn': o.so, 'Khách hàng': o.cn, 'Mã hàng': o.ic, 'SL đặt': o.oq,
      'Đã giao': o.dq, 'Còn phải giao': o.left, 'Đơn giá': o.p, 'Tiền chưa giao': o.a, Sale: o.ownerEmail ? staffName(o.ownerEmail) : o.sp, Kho: o.wh, 'Tình trạng hàng': isShort(o) ? 'Thiếu hàng' : isWait(o) ? 'Chờ hàng về' : 'Đủ tồn', 'Thông tin từ sale': o.info })),
  });
  if (!orders.length) return <Empty text={isAdmin ? 'Chưa nhập file Đơn chưa giao' : 'Bạn không có đơn chưa giao'} />;
  return (
    <>
      <div className="stats">
        <Stat label="Còn phải giao" value={t3(T.q) + ' tấn'} sub={`${all.length} dòng · ${new Set(all.map((o) => o.so)).size} đơn`} tone="amber" />
        <Stat label="Giá trị chưa giao (trước thuế)" value={fmtMoney(T.a) + ' đ'} />
        {AGE.slice(1).map(([l, f, t]) => { const l2 = all.filter((o) => o.age >= f && o.age <= t); return (
          <Stat key={l} label={'Đơn để ' + l.toLowerCase()} value={l2.length} sub={t3(tot(l2).q) + ' tấn'} tone="red" onClick={() => setAge(age === l ? '' : l)} active={age === l} />); })}
        <Stat label="Dòng thiếu hàng" value={all.filter(isShort).length} sub={`Kể cả hàng về vẫn không đủ · ${all.filter(isWait).length} dòng chờ hàng về`} tone="red" onClick={() => setShort(!short)} active={short} />
      </div>
      <div className="filters">
        <input placeholder="Tìm khách hàng, mã hàng, số đơn…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={age} onChange={(e) => setAge(e.target.value)}><option value="">Mọi tuổi đơn</option>{AGE.map(([l]) => <option key={l}>{l}</option>)}</select>
        <label className="nowrap"><input type="checkbox" checked={short} onChange={(e) => setShort(e.target.checked)} /> Chỉ dòng thiếu hàng</label>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={doExport}>⬇ Excel</button>
      </div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        {isAdmin && (
          <div><div className="section-title">Theo sale</div><div className="table-wrap">
            <table><thead><tr><th>Sale</th><th className="num">Tấn</th><th className="num">Giá trị</th><th className="num">Dòng</th></tr></thead>
              <tbody>{bySale.map((x) => <tr key={x.k}><td>{x.o.ownerEmail ? <b>{staffName(x.o.ownerEmail)}</b> : <span className="badge red">{x.o.sp}</span>}</td><td className="num"><b>{t3(x.q)}</b></td><td className="num">{fmtMoney(x.a)}</td><td className="num">{x.n}</td></tr>)}</tbody></table>
          </div></div>
        )}
        <div><div className="section-title">Theo mã hàng</div><div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
          <table><thead><tr><th>Mã hàng</th><th className="num">Còn giao (t)</th><th className="num">Tồn hiện có (t)</th></tr></thead>
            <tbody>{byItem.map((x) => { const st = stockBy.get(x.k); return (
              <tr key={x.k}><td><b>{x.k}</b></td><td className="num"><b>{t3(x.q)}</b></td>
                <td className="num" style={{ color: st && st.onHand < x.q ? 'var(--red)' : undefined }}>{st ? t3(st.onHand) : '-'}</td></tr>); })}</tbody></table>
        </div></div>
        <div><div className="section-title">Theo khách hàng</div><div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
          <table><thead><tr><th>Khách hàng</th><th className="num">Còn giao (t)</th><th className="num">Giá trị</th></tr></thead>
            <tbody>{byCust.map((x) => <tr key={x.k}><td>{x.o.cn}</td><td className="num"><b>{t3(x.q)}</b></td><td className="num">{fmtMoney(x.a)}</td></tr>)}</tbody></table>
        </div></div>
      </div>
      <div className="section-title">Chi tiết ({rows.length} dòng)</div>
      <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
        <table><thead><tr><th>Ngày đơn</th><th>Số đơn</th><th>Khách hàng</th><th>Mã hàng</th><th className="num">Đặt</th><th className="num">Đã giao</th><th className="num">Còn giao</th><th className="num">Giá trị</th>{isAdmin && <th>Sale</th>}<th>Ghi chú sale</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td className="nowrap">{fmtDate(o.od)}<div><span className={'badge ' + (o.age > 90 ? 'red' : o.age > 30 ? 'amber' : '')}>{o.age} ngày</span></div></td>
              <td className="small">{o.so}</td><td>{o.cn}</td>
              <td><b>{o.ic}</b>{isShort(o) ? <div><span className="badge red">Thiếu hàng</span></div> : isWait(o) ? <div><span className="badge amber">Chờ hàng về</span></div> : null}</td>
              <td className="num">{fmtNum(o.oq, 0)}</td><td className="num">{fmtNum(o.dq, 0)}</td><td className="num"><b>{fmtNum(o.left, 0)}</b></td>
              <td className="num">{fmtMoney(o.a)}</td>{isAdmin && <td>{o.ownerEmail ? staffName(o.ownerEmail) : o.sp}</td>}<td className="small">{o.info}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </>
  );
}

// ④ Hàng chưa về -------------------------------------------------------------
function IncomingTab({ incoming, stockBy }) {
  const [search, setSearch] = useState('');
  const [week, setWeek] = useState('');
  const t = today();
  const s = norm(search);
  const all = [...incoming].sort((a, b) => (a.eta || '9').localeCompare(b.eta || '9'));
  const wk = (r) => (r.eta ? monday(r.eta) : 'none');
  const rows = all.filter((r) => (!week || wk(r) === week) && (!s || [r.ic, r.sup, r.port, r.origin].some((v) => norm(v).includes(s))));
  const sum = (l) => l.reduce((x, r) => x + r.left, 0);
  const in7 = all.filter((r) => r.eta && r.eta >= t && r.eta <= addDays(t, 7));
  const in30 = all.filter((r) => r.eta && r.eta >= t && r.eta <= addDays(t, 30));
  const late = all.filter((r) => r.eta && r.eta < t);
  const noEta = all.filter((r) => !r.eta);
  const weeks = useMemo(() => {
    const mp = new Map();
    all.forEach((r) => { const k = wk(r); mp.set(k, (mp.get(k) || 0) + r.left); });
    return [...mp.entries()].sort((a, b) => (a[0] === 'none' ? 1 : b[0] === 'none' ? -1 : a[0].localeCompare(b[0])))
      .map(([k, q]) => ({ k, label: k === 'none' ? 'Chưa ETA' : fmtDate(k).slice(0, 5), t: +(q / 1000).toFixed(1) }));
  }, [incoming]);
  const grp = (key) => { const mp = new Map(); rows.forEach((r) => { const k = key(r) || '(trống)'; mp.set(k, (mp.get(k) || 0) + r.left); }); return [...mp.entries()].sort((a, b) => b[1] - a[1]); };
  const doExport = () => exportSheets(`HangChuaVe_${today()}`, {
    'Hàng chưa về': rows.map((r) => ({ ETA: fmtDate(r.eta), 'Mã hàng': r.ic, 'Tên hàng': stockBy.get(r.ic)?.in || '', 'SL chưa về (kg)': r.left, NCC: r.sup, 'Cảng đến': r.port, 'Xuất xứ': r.origin, 'Công ty': r.co })),
  });
  if (!incoming.length) return <Empty text="Chưa nhập file Hàng chưa về" />;
  return (
    <>
      <div className="stats">
        <Stat label="Tổng hàng chưa về" value={t3(sum(all)) + ' tấn'} sub={`${all.length} lô`} />
        <Stat label="Về trong 7 ngày tới" value={t3(sum(in7)) + ' tấn'} sub={`${in7.length} lô`} tone="green" />
        <Stat label="Về trong 30 ngày tới" value={t3(sum(in30)) + ' tấn'} tone="green" />
        <Stat label="Quá ETA chưa về" value={late.length} sub={t3(sum(late)) + ' tấn'} tone="red" />
        <Stat label="Chưa có ETA" value={noEta.length} sub={t3(sum(noEta)) + ' tấn — cần cập nhật'} tone="amber" onClick={() => setWeek(week === 'none' ? '' : 'none')} active={week === 'none'} />
      </div>
      <div className="chart-card" style={{ marginBottom: 14 }}>
        <h4>Lịch hàng về theo tuần (tấn, theo ETA) — bấm cột để lọc</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weeks} margin={{ left: 0, right: 8, top: 4 }} onClick={(e) => e?.activePayload && setWeek(e.activePayload[0].payload.k === week ? '' : e.activePayload[0].payload.k)}>
            <CartesianGrid vertical={false} stroke="#eef1f5" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={false} width={44} />
            <Tooltip formatter={(v) => [v + ' tấn', 'Hàng về']} labelFormatter={(l) => (l === 'Chưa ETA' ? l : 'Tuần từ ' + l)} />
            <Bar dataKey="t" fill="#1565c0" radius={[4, 4, 0, 0]} maxBarSize={36} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="filters">
        <input placeholder="Tìm mã hàng, NCC, cảng, xuất xứ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {week && <span className="badge blue">{week === 'none' ? 'Chưa có ETA' : 'Tuần từ ' + fmtDate(week)} <a onClick={() => setWeek('')}>✕</a></span>}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={doExport}>⬇ Excel</button>
      </div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        {[['Theo cảng đến', grp((r) => r.port)], ['Theo nhà cung cấp', grp((r) => r.sup)], ['Theo xuất xứ', grp((r) => r.origin)], ['Theo mã hàng', grp((r) => r.ic)]].map(([title, list]) => (
          <div key={title}><div className="section-title">{title}</div><div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table><tbody>{list.map(([k, q]) => <tr key={k}><td>{k}</td><td className="num"><b>{t3(q)}</b> t</td></tr>)}</tbody></table>
          </div></div>
        ))}
      </div>
      <div className="section-title">Chi tiết lô hàng ({rows.length})</div>
      <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
        <table><thead><tr><th>ETA</th><th>Mã hàng</th><th className="num">Chưa về (kg)</th><th>NCC</th><th>Cảng đến</th><th>Xuất xứ</th><th className="num">Tồn hiện tại</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} style={r.eta && r.eta < t ? { background: 'var(--red-soft)' } : undefined}>
              <td className="nowrap">{r.eta ? fmtDate(r.eta) : <span className="badge amber">Chưa có ETA</span>}{r.eta && r.eta < t && <div><span className="badge red">Quá ETA</span></div>}</td>
              <td><b>{r.ic}</b><div className="small">{stockBy.get(r.ic)?.in}</div></td>
              <td className="num"><b>{fmtNum(r.left, 0)}</b></td><td>{r.sup}</td><td>{r.port}</td><td>{r.origin}</td>
              <td className="num">{stockBy.get(r.ic) ? fmtNum(stockBy.get(r.ic).onHand, 0) : '-'}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </>
  );
}

// Nhập file ------------------------------------------------------------------
function ImportInventory({ onClose, onDone }) {
  const { email, staffList } = useApp();
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  const LABEL = { stock: 'Báo cáo tồn kho', orders: 'Đơn chưa giao', incoming: 'Hàng chưa về' };

  const load = async (list) => {
    setErr(''); setDone('');
    const out = [];
    for (const f of list) {
      try {
        const wb = await readWorkbook(f);
        const r = parseEcountFile(sheetRows(wb, wb.SheetNames[0]));
        if (!r.rows.length) throw new Error('không có dòng dữ liệu');
        out.push({ ...r, fileName: f.name });
      } catch (e) { out.push({ fileName: f.name, error: e.message }); }
    }
    setFiles(out);
  };

  const run = async () => {
    setBusy('Đang ghi dữ liệu…'); setErr('');
    try {
      const old = await getDocs(collection(db, 'stockSnap'));
      const meta = {};
      for (const f of files.filter((x) => !x.error)) {
        if (f.type === 'orders') {
          const prev = await getDocs(collection(db, 'openOrders'));
          for (let i = 0; i < prev.docs.length; i += 400) { const b = writeBatch(db); prev.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); }
          for (let i = 0; i < f.rows.length; i += 400) {
            const b = writeBatch(db);
            f.rows.slice(i, i + 400).forEach((r, j) => b.set(doc(db, 'openOrders', `o${i + j}`), { ...r, ownerEmail: staffForGroup(staffList, r.sp, r.sp)?.email || '' }));
            await b.commit();
          }
          meta.ordersAt = f.asOf; meta.ordersFile = f.fileName;
        } else {
          const b = writeBatch(db);
          old.docs.filter((d) => d.data().type === f.type).forEach((d) => b.delete(d.ref));
          for (let i = 0, n = 0; i < f.rows.length; i += PART, n++) b.set(doc(db, 'stockSnap', `${f.type}_${n}`), { type: f.type, rows: f.rows.slice(i, i + PART) });
          await b.commit();
          meta[f.type + 'At'] = f.asOf; meta[f.type + 'File'] = f.fileName;
        }
      }
      await setDoc(doc(db, 'stockSnap', 'meta'), { ...meta, importedAt: serverTimestamp(), importedBy: email }, { merge: true });
      setDone('Đã nhập: ' + files.filter((x) => !x.error).map((f) => `${LABEL[f.type]} (${f.rows.length} dòng)`).join(', ') + '.');
      setFiles([]);
      onDone();
    } catch (e) { setErr(e.message); }
    setBusy('');
  };
  const ok = files.filter((x) => !x.error);

  return (
    <Modal title="Nhập file Ecount: Tồn kho / Đơn chưa giao / Hàng chưa về" onClose={onClose} wide>
      <p className="small">
        Chọn <b>1, 2 hoặc cả 3 file</b> cùng lúc (giữ Ctrl để chọn nhiều) — app tự nhận loại file. Mỗi loại là số liệu tại thời điểm xuất, nên lần nhập mới
        sẽ <b>thay thế</b> bản cũ của đúng loại đó. Không ảnh hưởng Phân tích bán hàng và Hàng đã xuất.
      </p>
      <input type="file" multiple accept=".xlsx,.xls" onChange={(e) => e.target.files.length && load([...e.target.files])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {files.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table><thead><tr><th>File</th><th>Loại</th><th className="num">Số dòng</th><th>Tổng</th></tr></thead>
            <tbody>{files.map((f) => (
              <tr key={f.fileName}><td>{f.fileName}</td>
                {f.error ? <td colSpan={3}><span className="badge red">Lỗi: {f.error}</span></td> : <>
                  <td><span className="badge green">{LABEL[f.type]}</span></td><td className="num">{f.rows.length}</td>
                  <td className="small">{f.type === 'stock' ? `Tồn ${t3(f.rows.reduce((t, r) => t + r.onHand, 0))} t · Chưa giao ${t3(f.rows.reduce((t, r) => t + r.unshipped, 0))} t · Chưa về ${t3(f.rows.reduce((t, r) => t + r.incoming, 0))} t`
                    : f.type === 'orders' ? `Còn giao ${t3(f.rows.reduce((t, r) => t + r.left, 0))} t · ${fmtMoney(f.rows.reduce((t, r) => t + r.a, 0))} đ`
                      : `Chưa về ${t3(f.rows.reduce((t, r) => t + r.left, 0))} t · ${f.rows.filter((r) => !r.eta).length} lô chưa có ETA`}</td>
                </>}
              </tr>
            ))}</tbody></table>
        </div>
      )}
      {busy && <div className="ok-box" style={{ marginTop: 10 }}>{busy}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {ok.length > 0 && <button type="button" className="btn primary" disabled={!!busy} onClick={run}>Nhập {ok.length} file</button>}
      </div>
    </Modal>
  );
}

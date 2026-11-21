import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { fmtDate, norm, num, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, readWorkbook, sheetRows, toNumber, toYmd } from '../lib/excelImport';
import { Empty, ErrorBox, Modal, Stat } from '../components/ui';
import { LastNote, NoteModal, useDebtNotes } from './DebtNotes';
import { DEFAULT_BUCKETS, ENTITIES, entityLabel, entityMetas, saveSnapshot } from './Receivables';

// Tuổi nợ tính từ file chi tiết theo hóa đơn: số ngày quá hạn = ngày tính − hạn thanh toán (không có hạn thì lấy ngày hóa đơn)
const BUCKET_MAX = [3, 10, 15, 30, Infinity]; // khớp DEFAULT_BUCKETS: 1-3, 4-10, 11-15, 16-30, Trên 30 ngày
export function agingFromInvoices(rows, asOf) {
  const m = new Map();
  rows.forEach((r) => {
    const rem = num(r.remaining); if (!rem) return;
    const k = r.customerKey;
    if (!m.has(k)) m.set(k, { customerCode: '', customerName: r.customerName, address: '', amount: 0, overdue: 0, notDue: 0, aging: DEFAULT_BUCKETS.map(() => 0), saleGroup: '', saleGroupName: '', ownerEmail: r.ownerEmail || '', ownerName: r.ownerName || '', invoices: 0 });
    const x = m.get(k); x.amount += rem; x.invoices++;
    const late = daysLate(r.dueDate || r.date, asOf);
    if (late > 0 && rem > 0) { x.overdue += rem; x.aging[BUCKET_MAX.findIndex((b) => late <= b)] += rem; } else x.notDue += rem;
  });
  return [...m.values()].filter((x) => Math.round(x.amount) !== 0);
}

// ============================================================================
// Công nợ phải thu CHI TIẾT THEO HÓA ĐƠN — nhập từ MISA "Chi tiết công nợ phải thu theo hóa đơn"
// File không có tên sale → gán sale theo tên khách hàng: khớp với công nợ tuổi nợ đã nhập (có sale),
// rồi đến bảng ghép tên đã lưu (settings/invoiceDebtAlias). Khách chưa khớp: kế toán chọn sale 1 lần, app nhớ.
// ============================================================================

const money = (v) => Math.round(num(v)).toLocaleString('en-US');
const squash = (s) => norm(String(s || '').replace(/^tên khách hàng\s*:\s*/i, '')).replace(/ /g, '');
// Bỏ phần loại hình công ty để so tên: "CÔNG TY TNHH MTV SX TM BẢO QUYÊN" ~ "CTY BẢO QUYÊN"
const LEGAL = ['trach nhiem huu han', 'doanh nghiep tu nhan', 'doanh nghiep tn', 'ho kinh doanh', 'mot thanh vien', 'xuat nhap khau', 'chi nhanh', 'cong ty', 'co phan', 'san xuat', 'thuong mai', 'dich vu', 'dau tu', 'doanh nghiep', 'viet nam', 'vietnam', 'co so', 'tnhh', 'dntn', 'cty', 'mtv', 'xnk', 'cp', 'sx', 'tm', 'dv', 'vn', 'va'];
const core = (s) => { let x = ' ' + norm(String(s || '').replace(/^tên khách hàng\s*:\s*/i, '')) + ' '; LEGAL.forEach((w) => { x = x.split(' ' + w + ' ').join(' '); }); return x.replace(/ /g, ''); };
const COMPANY = { VAP: 'CÔNG TY TNHH VIỆT AN PHA', PLA: 'CÔNG TY PLASTICS VIỆT NAM' };
const daysLate = (due, ref = today()) => (due && due < ref ? Math.round((Date.parse(ref) - Date.parse(due)) / 864e5) : 0);

// Đọc file MISA → { period, rows: [{ customerName, date, voucher, invoiceNo, desc, dueDate, openBal, amount, returns, discount, paid, remaining }] }
export function parseInvoiceDebt(rows) {
  const hr = rows.findIndex((r) => r.some((c) => norm(c) === 'so hoa don') && r.some((c) => norm(c) === 'so con phai thu'));
  if (hr < 0) throw new Error('Không thấy dòng tiêu đề "Số hóa đơn … Số còn phải thu". Hãy dùng báo cáo "Chi tiết công nợ phải thu theo hóa đơn" của MISA.');
  const h = rows[hr].map(norm);
  const c = (pred) => h.findIndex(pred);
  const C = {
    date: c((x) => x.startsWith('ngay hach toan') || x === 'ngay chung tu'), voucher: c((x) => x === 'so chung tu'), inv: c((x) => x === 'so hoa don'),
    desc: c((x) => x === 'dien giai'), due: c((x) => x.startsWith('han thanh toan')), open: c((x) => x.startsWith('so con phai thu dk') || x.includes('dau ky')),
    amount: c((x) => x.startsWith('gia tri hoa don')), ret: c((x) => x.startsWith('tra lai')), disc: c((x) => x.startsWith('ck thanh toan') || x.includes('giam tru khac')),
    paid: c((x) => x === 'so da thu'), rem: c((x) => x === 'so con phai thu'),
  };
  let period = '';
  rows.slice(0, hr).forEach((r) => r.forEach((v) => {
    const s = String(v || '');
    const m = s.match(/tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i) || s.match(/quý\s*(\d)\s*năm\s*(\d{4})/i);
    if (m && !period) period = /quý/i.test(s) ? `Quý ${m[1]}/${m[2]}` : `Tháng ${m[1]}/${m[2]}`;
    const d = s.match(/từ ngày\s*(\d{1,2}\/\d{1,2}\/\d{4}).*đến ngày\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (d && !period) period = `${d[1]} – ${d[2]}`;
  }));
  const out = []; let cust = '';
  rows.slice(hr + 1).forEach((r) => {
    const first = cellText(r.find((x) => cellText(x) !== '') ?? '');
    if (/^tên khách hàng\s*:/i.test(first)) { cust = first.replace(/^tên khách hàng\s*:\s*/i, '').trim(); return; }
    if (/^tổng cộng/i.test(first) || !cust) return;
    const date = toYmd(r[C.date]);
    if (!date) return;
    const g = (k) => (C[k] >= 0 ? toNumber(r[C[k]]) : 0);
    out.push({
      customerName: cust, date, voucher: cellText(r[C.voucher]), invoiceNo: cellText(r[C.inv]), desc: cellText(r[C.desc]), dueDate: C.due >= 0 ? toYmd(r[C.due]) : '',
      openBal: g('open'), amount: g('amount'), returns: g('ret'), discount: g('disc'), paid: g('paid'), remaining: g('rem'),
    });
  });
  if (!out.length) throw new Error('Không đọc được dòng hóa đơn nào.');
  return { period, rows: out };
}

function useMeta(id) {
  const [m, setM] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'settings', id), (s) => setM(s.data() || {}), () => setM({})), [id]);
  return m;
}

// ----------------------------------------------------------------------------
export default function InvoiceDebts({ staffFilter }) {
  const { email, isAdmin, isAccountant, staffName } = useApp();
  const seeAll = isAdmin || isAccountant;
  const meta = useMeta('invoiceDebts');
  const metas = meta?.entities || {};
  const [ent, setEnt] = useState('ALL');
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [onlyLate, setOnlyLate] = useState(false);
  const [imp, setImp] = useState(false);
  const [card, setCard] = useState(null);
  const [open, setOpen] = useState({});
  const [noteFor, setNoteFor] = useState(null);
  const [chg, setChg] = useState(null);
  const notesQ = useDebtNotes();
  const notesBy = useMemo(() => { const m = new Map(); notesQ.data.forEach((n) => { const k = n.entity + '|' + n.customerKey; if (!m.has(k)) m.set(k, []); m.get(k).push(n); }); return m; }, [notesQ.data]);

  const ents = ENTITIES.map((e) => e[0]).filter((e) => metas[e]?.batchId);
  const shown = ent === 'ALL' ? ents : ents.filter((e) => e === ent);
  const batchIds = shown.map((e) => metas[e].batchId);
  const owner = seeAll ? staffFilter : email;
  const { data, loading, error } = useQuery(
    () => (batchIds.length ? query(collection(db, 'invoiceDebts'), where('batchId', 'in', batchIds), ...(owner ? [where('ownerEmail', '==', owner)] : [])) : null),
    [batchIds.join(','), owner]
  );

  const ref = today();
  const custs = useMemo(() => {
    const k = norm(q);
    const m = new Map();
    data.forEach((r) => {
      const hit = !k || norm(r.customerName).includes(k) || norm(r.invoiceNo).includes(k) || norm(r.voucher).includes(k);
      if (!hit) return;
      if (onlyOpen && num(r.remaining) <= 0) return;
      if (onlyLate && !(num(r.remaining) > 0 && daysLate(r.dueDate, ref))) return;
      const key = r.entity + '|' + r.customerKey;
      if (!m.has(key)) m.set(key, { key, entity: r.entity, customerName: r.customerName, ownerEmail: r.ownerEmail, list: [] });
      m.get(key).list.push(r);
    });
    return [...m.values()].map((x) => {
      const list = x.list.sort((a, b) => a.date.localeCompare(b.date) || String(a.invoiceNo).localeCompare(String(b.invoiceNo), undefined, { numeric: true }));
      const s = (f) => list.reduce((t, r) => t + num(r[f]), 0);
      const late = list.filter((r) => num(r.remaining) > 0 && daysLate(r.dueDate, ref)).reduce((t, r) => t + num(r.remaining), 0);
      return { ...x, list, amount: s('amount'), paid: s('paid'), less: s('returns') + s('discount'), remaining: s('remaining'), late };
    }).sort((a, b) => b.remaining - a.remaining);
  }, [data, q, onlyOpen, onlyLate, ref]);
  const tot = (f) => custs.reduce((t, c) => t + c[f], 0);

  const doExport = () => exportSheets('CongNo_TheoHoaDon', {
    'Theo hóa đơn': custs.flatMap((c) => c.list.map((r) => ({
      'Pháp nhân': r.entity, 'Khách hàng': r.customerName, ...(seeAll ? { Sale: r.ownerEmail ? staffName(r.ownerEmail) : '' } : {}), 'Ngày HĐ': fmtDate(r.date), 'Số chứng từ': r.voucher, 'Số hóa đơn': r.invoiceNo,
      'Hạn thanh toán': fmtDate(r.dueDate), 'Giá trị hóa đơn': num(r.amount), 'Trả lại/giảm trừ': num(r.returns) + num(r.discount), 'Đã thu': num(r.paid), 'Còn phải thu': num(r.remaining), 'Quá hạn (ngày)': num(r.remaining) > 0 ? daysLate(r.dueDate, ref) : 0,
    }))),
  });

  if (meta === null) return null;
  return (
    <>
      <div className="filters" style={{ marginBottom: 10 }}>
        <div className="presets">
          {['ALL', ...ents].map((k) => <button key={k} className={'chip' + (ent === k ? ' on' : '')} onClick={() => setEnt(k)}>{k === 'ALL' ? '∑ Tất cả' : '🏢 ' + entityLabel(k)}</button>)}
        </div>
        <input placeholder="🔍 Tìm khách hàng / số hóa đơn" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <label className="nowrap"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Chỉ hóa đơn còn nợ</label>
        <label className="nowrap"><input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} /> Chỉ quá hạn</label>
        <button className="btn" onClick={doExport} disabled={!custs.length}>⬇ Excel</button>
        {seeAll && <button className="btn primary" onClick={() => setImp(true)}>⬆ Nhập file chi tiết theo hóa đơn</button>}
      </div>
      <div className="small" style={{ marginBottom: 8 }}>
        {ents.length ? ents.map((e) => `${e}: ${metas[e].period || ''} · cập nhật ${fmtDate(metas[e].asOf)}`).join('  |  ') : 'Chưa có số liệu.'}
      </div>
      <ErrorBox error={error} />
      <div className="stats">
        <Stat label="Giá trị hóa đơn" value={money(tot('amount'))} />
        <Stat label="Khách đã thanh toán" value={money(tot('paid'))} tone="green" />
        <Stat label="Còn phải thu" value={money(tot('remaining'))} tone="amber" />
        <Stat label="Trong đó quá hạn" value={money(tot('late'))} tone="red" />
      </div>
      {loading ? <p className="small">Đang tải…</p> : !custs.length ? <Empty text={ents.length ? 'Không có hóa đơn phù hợp' : 'Kế toán chưa nhập file "Chi tiết công nợ phải thu theo hóa đơn"'} /> : custs.map((c) => (
        <div key={c.key} className="card" style={{ marginBottom: 10 }}>
          <div className="filters" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen({ ...open, [c.key]: !open[c.key] })}>
            <div>
              <b style={{ color: 'var(--primary)' }}>{open[c.key] ? '▾' : '▸'} {c.customerName}</b>
              <span className="badge" style={{ marginLeft: 6 }}>{c.entity}</span>
              {seeAll && <span className="small" style={{ marginLeft: 6 }}>Sale: {c.ownerEmail ? staffName(c.ownerEmail) : <span className="badge red">Chưa gán</span>}
                <button className="btn sm" style={{ marginLeft: 6, padding: '1px 8px' }} title="Đổi sale phụ trách khách này" onClick={(e) => { e.stopPropagation(); setChg(c); }}>✎ Đổi sale</button></span>}
            </div>
            <div className="nowrap">
              <span className="small">HĐ </span><b>{money(c.amount)}</b>
              <span className="small"> · Đã thu </span><b style={{ color: 'var(--green)' }}>{money(c.paid)}</b>
              <span className="small"> · Còn nợ </span><b style={{ color: 'var(--red)' }}>{money(c.remaining)}</b>
              {c.late > 0 && <span className="badge red" style={{ marginLeft: 6 }}>Quá hạn {money(c.late)}</span>}
              <button className="btn sm" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); setNoteFor(c); }}>📝 Ghi nhận{notesBy.get(c.key)?.length ? ` (${notesBy.get(c.key).length})` : ''}</button>
              <button className="btn sm primary" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); setCard(c); }}>📷 Bảng gửi khách</button>
            </div>
          </div>
          <LastNote notes={notesBy.get(c.key) || []} />
          {open[c.key] && <InvoiceTable list={c.list} ref0={ref} />}
        </div>
      ))}
      {imp && <ImportInvoiceDebts metas={metas} onClose={() => setImp(false)} />}
      {chg && <ChangeSale c={chg} onClose={() => setChg(null)} />}
      {noteFor && <NoteModal c={noteFor} notes={notesBy.get(noteFor.key) || []} onClose={() => setNoteFor(null)} />}
      {card && <Statement c={card} period={metas[card.entity]?.period} asOf={metas[card.entity]?.asOf} onClose={() => setCard(null)} onlyOpen={onlyOpen} />}
    </>
  );
}

// Đổi sale phụ trách 1 khách: cập nhật hóa đơn, công nợ tuổi nợ, lịch sử ghi nhận, và nhớ cho các lần nhập sau
function ChangeSale({ c, onClose }) {
  const { email, staffList, staffName } = useApp();
  const sales = staffList.filter((s) => s.role !== 'accountant' && s.active !== false);
  const [to, setTo] = useState(c.ownerEmail || '');
  const [both, setBoth] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const k = c.list[0]?.customerKey || squash(c.customerName);
  const run = async () => {
    if (!to || to === c.ownerEmail) return onClose();
    setBusy('Đang cập nhật…'); setErr('');
    try {
      const name = sales.find((s) => s.email === to)?.name || '';
      const ok = (e) => both || e === c.entity;
      const ups = [];
      (await getDocs(query(collection(db, 'invoiceDebts'), where('customerKey', '==', k)))).docs.forEach((d) => { if (ok(d.data().entity)) ups.push([d.ref, { ownerEmail: to, ownerName: name }]); });
      (await getDocs(collection(db, 'receivables'))).docs.forEach((d) => { const x = d.data(); if (squash(x.customerName) === k && ok(x.entity)) ups.push([d.ref, { ownerEmail: to, ownerName: name }]); });
      (await getDocs(query(collection(db, 'debtNotes'), where('customerKey', '==', k)))).docs.forEach((d) => { if (ok(d.data().entity)) ups.push([d.ref, { custOwner: to }]); });
      for (let i = 0; i < ups.length; i += 400) { const b = writeBatch(db); ups.slice(i, i + 400).forEach(([ref, v]) => b.update(ref, v)); await b.commit(); }
      await setDoc(doc(db, 'settings', 'invoiceDebtAlias'), { map: { [k]: to }, updatedAt: serverTimestamp(), updatedBy: email }, { merge: true });
      onClose();
    } catch (e) { setErr(e.message); setBusy(''); }
  };
  return (
    <Modal title={'Đổi sale phụ trách – ' + c.customerName} onClose={onClose}>
      <p className="small">Đang gán: <b>{c.ownerEmail ? staffName(c.ownerEmail) : 'Chưa gán'}</b>. Sau khi đổi, sale mới thấy toàn bộ hóa đơn, công nợ và lịch sử ghi nhận của khách này; sale cũ không còn thấy. Các lần nhập file sau app tự gán theo sale mới.</p>
      <div className="form-grid">
        <label>Sale mới
          <select value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%' }}>
            <option value="">— Chọn —</option>
            {sales.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </select>
        </label>
        <label className="nowrap" style={{ alignSelf: 'end' }}><input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} /> Áp dụng cho cả VAP và PLA (nếu khách mua ở cả 2)</label>
      </div>
      {err && <div className="error-box" style={{ marginTop: 8 }}>{err}</div>}
      <div className="form-actions" style={{ marginTop: 10 }}>{busy && <span className="small">{busy}</span>}<button className="btn" onClick={onClose}>Hủy</button><button className="btn primary" disabled={!!busy || !to} onClick={run}>Lưu</button></div>
    </Modal>
  );
}

function InvoiceTable({ list, ref0, plain }) {
  const s = (f) => list.reduce((t, r) => t + num(r[f]), 0);
  return (
    <div className="table-wrap" style={plain ? { overflow: 'visible' } : undefined}>
      <table>
        <thead><tr><th>STT</th><th>Ngày HĐ</th><th>Số hóa đơn</th><th>Hạn thanh toán</th><th className="num">Giá trị hóa đơn</th><th className="num">Đã thanh toán</th><th className="num">Còn phải thu</th>{!plain && <th>Tình trạng</th>}</tr></thead>
        <tbody>{list.map((r, i) => {
          const late = num(r.remaining) > 0 ? daysLate(r.dueDate, ref0) : 0;
          return (
            <tr key={r.id || i}>
              <td>{i + 1}</td><td>{fmtDate(r.date)}</td><td><b>{r.invoiceNo || r.voucher}</b>{!plain && r.invoiceNo && <span className="small"> ({r.voucher})</span>}</td><td>{fmtDate(r.dueDate)}</td>
              <td className="num">{money(r.amount)}</td><td className="num">{money(num(r.paid) + num(r.returns) + num(r.discount))}</td><td className="num"><b>{money(r.remaining)}</b></td>
              {!plain && <td>{num(r.remaining) <= 0 ? <span className="badge green">Đã thu đủ</span> : late ? <span className="badge red">Quá hạn {late} ngày</span> : <span className="badge">Trong hạn</span>}</td>}
            </tr>
          );
        })}</tbody>
        <tfoot><tr><td colSpan={4}><b>Tổng cộng</b></td><td className="num"><b>{money(s('amount'))}</b></td><td className="num"><b>{money(s('paid') + s('returns') + s('discount'))}</b></td><td className="num"><b>{money(s('remaining'))}</b></td>{!plain && <td />}</tr></tfoot>
      </table>
    </div>
  );
}

// Bảng gửi khách: chụp hình / tải ảnh / sao chép gửi Zalo
function Statement({ c, period, asOf, onClose, onlyOpen }) {
  const [openOnly, setOpenOnly] = useState(onlyOpen);
  const [msg, setMsg] = useState('');
  const box = useRef(null);
  const list = c.list.filter((r) => !openOnly || num(r.remaining) > 0);
  const s = (f) => list.reduce((t, r) => t + num(r[f]), 0);
  const paid = s('paid') + s('returns') + s('discount');
  const saveImg = async () => {
    try {
      const { toPng } = await import('html-to-image');
      const url = await toPng(box.current, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const a = document.createElement('a'); a.href = url; a.download = `CongNo_${squash(c.customerName).slice(0, 30)}_${today()}.png`; a.click();
      setMsg('Đã tải ảnh — gửi khách qua Zalo / email.');
    } catch (e) { setMsg('Không tạo được ảnh: ' + e.message + ' — hãy chụp màn hình bảng bên dưới.'); }
  };
  const copy = async () => {
    const t = [`ĐỐI CHIẾU CÔNG NỢ – ${c.customerName}`, `${COMPANY[c.entity] || c.entity}${period ? ' · ' + period : ''}`, ...list.map((r, i) => `${i + 1}. HĐ ${r.invoiceNo || r.voucher} ngày ${fmtDate(r.date)}${r.dueDate ? ', hạn ' + fmtDate(r.dueDate) : ''}: ${money(r.amount)} – đã TT ${money(num(r.paid) + num(r.returns) + num(r.discount))} – còn ${money(r.remaining)}`),
      `Tổng: ${money(s('amount'))} – đã thanh toán ${money(paid)} – CÒN PHẢI THU ${money(s('remaining'))} đ`];
    try { await navigator.clipboard.writeText(t.join('\n')); setMsg('Đã sao chép — dán vào Zalo để gửi khách.'); } catch { setMsg('Trình duyệt không cho sao chép.'); }
  };
  return (
    <Modal title="Bảng công nợ gửi khách" onClose={onClose} wide>
      <div className="filters" style={{ marginBottom: 10 }}>
        <label className="nowrap"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Chỉ hóa đơn còn nợ</label>
        <button className="btn primary" onClick={saveImg}>🖼 Tải ảnh</button>
        <button className="btn" onClick={copy}>📋 Sao chép chữ (Zalo)</button>
        {msg && <span className="small">{msg}</span>}
      </div>
      <div ref={box} style={{ background: '#fff', color: '#111', padding: 20, border: '1px solid #d8dee8', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, color: '#1f4e9e' }}>{COMPANY[c.entity] || entityLabel(c.entity)}</div>
        <h2 style={{ textAlign: 'center', margin: '10px 0 2px', color: '#1f4e9e' }}>BẢNG ĐỐI CHIẾU CÔNG NỢ</h2>
        <div style={{ textAlign: 'center', fontSize: 13, marginBottom: 12 }}>{period ? period + ' · ' : ''}Số liệu đến ngày {fmtDate(asOf)}</div>
        <div style={{ marginBottom: 10 }}><span style={{ color: '#1f4e9e', fontWeight: 600 }}>Kính gửi: </span><b>{c.customerName}</b></div>
        <InvoiceTable list={list} ref0={today()} plain />
        <table style={{ marginTop: 12, marginLeft: 'auto', fontSize: 15 }}><tbody>
          <tr><td style={{ color: '#1f4e9e', paddingRight: 16 }}>Tổng giá trị hóa đơn:</td><td className="num"><b>{money(s('amount'))}</b></td></tr>
          <tr><td style={{ color: '#1f4e9e', paddingRight: 16 }}>Quý khách đã thanh toán:</td><td className="num"><b>{money(paid)}</b></td></tr>
          <tr><td style={{ color: '#b42318', paddingRight: 16, fontWeight: 700 }}>CÒN PHẢI THANH TOÁN:</td><td className="num" style={{ color: '#b42318', fontSize: 17 }}><b>{money(s('remaining'))} đ</b></td></tr>
        </tbody></table>
        <div style={{ fontSize: 12, marginTop: 12, color: '#555' }}>Kính đề nghị Quý khách kiểm tra, đối chiếu và thanh toán các hóa đơn đến hạn. Xin cảm ơn!</div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// Dùng ở tab Theo hóa đơn, và khi kế toán chọn file chi tiết theo hóa đơn ở nút nhập công nợ cũ (initialFile)
export function ImportInvoiceDebts({ metas: metas0, onClose, initialFile, defaultEntity }) {
  const { email, staffList } = useApp();
  const invMeta = useMeta('invoiceDebts');
  const metas = metas0 || invMeta?.entities || {};
  const sales = staffList.filter((s) => s.role !== 'accountant' && s.active !== false);
  const [entity, setEntity] = useState(defaultEntity || '');
  const [res, setRes] = useState(null);
  const [fileName, setFileName] = useState('');
  const [pick, setPick] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [withAging, setWithAging] = useState(true);
  const [agingDate, setAgingDate] = useState(today());
  const recMeta = useMeta('receivables');
  const [done, setDone] = useState('');
  const alias = useMeta('invoiceDebtAlias');
  const rec = useQuery(() => collection(db, 'receivables'), []);
  const cus = useQuery(() => collection(db, 'customers'), []); // chỉ quản trị đọc được; kế toán dùng bảng ghép đã lưu
  // tên rút gọn (bỏ "Công ty TNHH…") → sale; chỉ nhận khi duy nhất 1 sale
  const coreMap = useMemo(() => {
    const m = new Map(); const add = (n, o) => { const k = core(n); if (k.length < 4 || !o) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(o); };
    rec.data.forEach((r) => add(r.customerName, r.ownerEmail)); cus.data.forEach((c) => add(c.name, c.ownerEmail));
    return m;
  }, [rec.data, cus.data]);
  const fuzzy = (n) => {
    const k = core(n); if (k.length < 5) return '';
    const os = new Set(); coreMap.forEach((v, key) => { if (key.length >= 5 && key !== k && (k.includes(key) || key.includes(k))) v.forEach((o) => os.add(o)); });
    return os.size === 1 ? [...os][0] : '';
  };

  // tên khách (đã chuẩn hóa) → sale, theo công nợ tuổi nợ đã nhập; ưu tiên cùng pháp nhân
  const recMap = useMemo(() => {
    const m = { any: new Map() };
    rec.data.forEach((r) => {
      if (!r.ownerEmail) return; const k = squash(r.customerName); if (!k) return;
      m.any.set(k, r.ownerEmail); if (r.entity) { m[r.entity] = m[r.entity] || new Map(); m[r.entity].set(k, r.ownerEmail); }
    });
    return m;
  }, [rec.data]);
  // đoán pháp nhân: bên nào có nhiều tên khách trùng hơn
  const guess = useMemo(() => {
    if (!res) return '';
    const names = [...new Set(res.rows.map((r) => squash(r.customerName)))];
    const sc = ENTITIES.map(([e]) => [e, names.filter((n) => recMap[e]?.has(n)).length]).sort((a, b) => b[1] - a[1]);
    return sc[0][1] > (sc[1]?.[1] || 0) ? sc[0][0] : '';
  }, [res, recMap]);
  useEffect(() => { if (guess && !entity) setEntity(guess); }, [guess]);

  const custs = useMemo(() => {
    if (!res) return [];
    const m = new Map();
    res.rows.forEach((r) => { const k = squash(r.customerName); if (!m.has(k)) m.set(k, { k, name: r.customerName, n: 0, remaining: 0 }); const x = m.get(k); x.n++; x.remaining += r.remaining; });
    return [...m.values()].map((x) => {
      const cs = coreMap.get(core(x.name));
      const auto = (entity && recMap[entity]?.get(x.k)) || (alias?.map || {})[x.k] || recMap.any.get(x.k) || (cs?.size === 1 ? [...cs][0] : '') || '';
      return { ...x, auto, sugg: auto ? '' : fuzzy(x.name), owner: pick[x.k] ?? auto };
    }).sort((a, b) => (!!a.owner - !!b.owner) || b.remaining - a.remaining);
  }, [res, entity, recMap, alias, pick, coreMap]); // eslint-disable-line
  const missing = custs.filter((x) => !x.owner);

  const load = async (file) => {
    setErr(''); setDone(''); setRes(null); setPick({});
    try { const wb = await readWorkbook(file); setRes(parseInvoiceDebt(sheetRows(wb, wb.SheetNames[0]))); setFileName(file.name); } catch (e) { setErr(e.message); }
  };
  useEffect(() => { if (initialFile) load(initialFile); }, [initialFile]);
  const run = async () => {
    if (!entity) return setErr('Chọn pháp nhân (VAP hoặc PLA) của file này.');
    if (missing.length && !window.confirm(`${missing.length} khách chưa gán sale — sale sẽ không thấy các khách này (quản trị / kế toán vẫn thấy). Vẫn nhập?`)) return;
    setBusy('Đang ghi…'); setErr('');
    try {
      const owner = Object.fromEntries(custs.map((x) => [x.k, x.owner]));
      const name = (e) => sales.find((s) => s.email === e)?.name || '';
      const batchId = Date.now().toString(36);
      const list = res.rows.map((r) => ({ ...r, customerKey: squash(r.customerName), entity, batchId, asOf: today(), ownerEmail: owner[squash(r.customerName)] || '', ownerName: name(owner[squash(r.customerName)]) }));
      for (let i = 0; i < list.length; i += 400) {
        const b = writeBatch(db); list.slice(i, i + 400).forEach((r) => b.set(doc(collection(db, 'invoiceDebts')), r)); await b.commit();
        setBusy(`Đã ghi ${Math.min(i + 400, list.length)}/${list.length} dòng…`);
      }
      // nhớ ghép tên khách ↔ sale (cả tự khớp lẫn chọn tay) để lần sau, kể cả kế toán, khớp ngay
      const learned = Object.fromEntries(custs.filter((x) => x.owner).map((x) => [x.k, x.owner]));
      await setDoc(doc(db, 'settings', 'invoiceDebtAlias'), { map: { ...(alias?.map || {}), ...learned }, updatedAt: serverTimestamp(), updatedBy: email }, { merge: true });
      // Cập nhật luôn tab Công nợ (tuổi nợ) + Phân tích tuần từ chính file này
      let agingNote = '';
      if (withAging) {
        setBusy('Đang tính tuổi nợ…');
        const ag = agingFromInvoices(list, agingDate);
        const rmetas = entityMetas(recMeta || {});
        const rb = 'i' + batchId;
        for (let i = 0; i < ag.length; i += 400) { const b = writeBatch(db); ag.slice(i, i + 400).forEach((x) => b.set(doc(collection(db, 'receivables')), { ...x, entity, batchId: rb, asOf: agingDate, source: 'invoice' })); await b.commit(); }
        const agTotal = ag.reduce((t, x) => t + x.amount, 0);
        await setDoc(doc(db, 'settings', 'receivables'), { entities: { ...rmetas, [entity]: { batchId: rb, asOf: agingDate, fileName, company: COMPANY[entity] || '', format: 'invoice-detail', buckets: DEFAULT_BUCKETS, rowCount: ag.length, total: agTotal, importedAt: serverTimestamp(), importedBy: email } } });
        await saveSnapshot(entity, agingDate, DEFAULT_BUCKETS, ag);
        const oldR = rmetas[entity]?.batchId;
        if (oldR) { const o = await getDocs(query(collection(db, 'receivables'), where('batchId', '==', oldR))); for (let i = 0; i < o.docs.length; i += 400) { const b = writeBatch(db); o.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); } }
        agingNote = ` Đã cập nhật tab Công nợ (tuổi nợ đến ${fmtDate(agingDate)}): ${ag.length} khách, quá hạn ${money(ag.reduce((t, x) => t + x.overdue, 0))} đ.`;
      }
      const old = metas[entity]?.batchId;
      const total = list.reduce((t, r) => t + r.remaining, 0);
      await setDoc(doc(db, 'settings', 'invoiceDebts'), { entities: { ...metas, [entity]: { batchId, asOf: today(), period: res.period, fileName, rowCount: list.length, total, importedAt: serverTimestamp(), importedBy: email } } });
      if (old) {
        setBusy('Đang dọn số liệu cũ…');
        const o = await getDocs(query(collection(db, 'invoiceDebts'), where('batchId', '==', old)));
        for (let i = 0; i < o.docs.length; i += 400) { const b = writeBatch(db); o.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); }
      }
      setDone(`Đã nhập ${entity}: ${list.length} dòng hóa đơn của ${custs.length} khách, còn phải thu ${money(total)} đ.${agingNote}`); setRes(null);
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <Modal title={'Nhập công nợ chi tiết theo hóa đơn (MISA)' + (entity ? ' – ' + entity : '')} onClose={onClose} wide>
      <p className="small">Trên MISA: <b>Báo cáo → Chi tiết công nợ phải thu theo hóa đơn</b> (TK 131), xuất Excel rồi chọn file ở đây. Mỗi pháp nhân nhập <b>1 file riêng</b>; lần nhập mới thay thế số liệu cũ của pháp nhân đó.
        File không có tên sale: app <b>tự gán sale theo tên khách hàng</b> (khớp công nợ tuổi nợ đã nhập). Khách chưa khớp: chọn sale 1 lần, app nhớ cho lần sau.</p>
      <div className="filters" style={{ marginBottom: 10 }}>
        <b>Pháp nhân:</b>
        {ENTITIES.map(([k]) => (
          <label key={k} className="nowrap" style={{ fontWeight: entity === k ? 700 : 400 }}>
            <input type="radio" name="ient" checked={entity === k} onChange={() => setEntity(k)} /> {entityLabel(k)}{guess === k && ' (đoán theo tên khách)'}
            {metas[k]?.asOf && <span className="small"> · đang có {metas[k].period || ''} nhập {fmtDate(metas[k].asOf)}</span>}
          </label>
        ))}
      </div>
      <div className="filters" style={{ marginBottom: 10 }}>
        <label className="nowrap"><input type="checkbox" checked={withAging} onChange={(e) => setWithAging(e.target.checked)} /> Cập nhật luôn tab <b>Công nợ (tuổi nợ)</b> và <b>Phân tích tuần</b> từ file này — không cần nhập file tuổi nợ</label>
        {withAging && <label className="nowrap">Tính tuổi nợ đến ngày <input type="date" value={agingDate} onChange={(e) => setAgingDate(e.target.value || today())} /></label>}
      </div>
      {withAging && <p className="small" style={{ marginTop: -4 }}>Số ngày quá hạn = ngày tính − <b>hạn thanh toán</b> của từng hóa đơn (hóa đơn không có hạn thì tính từ <b>ngày xuất hóa đơn</b>). Chia nhóm 1-3, 4-10, 11-15, 16-30, trên 30 ngày; chưa đến hạn = trong hạn.</p>}
      <input type="file" accept=".xlsx,.xls" onChange={(e) => { if (e.target.files[0]) load(e.target.files[0]); e.target.value = ''; }} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {busy && <p className="small">{busy}</p>}
      {res && (
        <>
          <p style={{ marginTop: 10 }}><b>{res.period || 'Không rõ kỳ'}</b> · {res.rows.length} dòng · {custs.length} khách · còn phải thu <b>{money(res.rows.reduce((t, r) => t + r.remaining, 0))}</b>
            {missing.length > 0 && <span className="badge red" style={{ marginLeft: 8 }}>{missing.length} khách chưa gán sale</span>}</p>
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table>
              <thead><tr><th>Khách hàng</th><th className="num">Số dòng</th><th className="num">Còn phải thu</th><th>Sale phụ trách</th></tr></thead>
              <tbody>{custs.map((x) => (
                <tr key={x.k}>
                  <td>{x.name}</td><td className="num">{x.n}</td><td className="num">{money(x.remaining)}</td>
                  <td>
                    <select value={x.owner} onChange={(e) => setPick({ ...pick, [x.k]: e.target.value })} style={!x.owner ? { borderColor: 'var(--red)' } : undefined}>
                      <option value="">— Chưa gán —</option>
                      {sales.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
                    </select>
                    {x.auto && pick[x.k] === undefined && <span className="small"> tự khớp</span>}
                    {!x.owner && x.sugg && <button className="btn sm" style={{ marginLeft: 6 }} title="Tên gần giống khách của sale này — kiểm tra trước khi chọn" onClick={() => setPick({ ...pick, [x.k]: x.sugg })}>Gợi ý: {sales.find((s) => s.email === x.sugg)?.name || x.sugg}</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="form-actions" style={{ marginTop: 10 }}><button className="btn primary" disabled={!!busy} onClick={run}>Nhập {res.rows.length} dòng vào {entity || '…'}</button></div>
        </>
      )}
    </Modal>
  );
}

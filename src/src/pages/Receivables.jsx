import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { scopedQuery } from '../lib/data';
import { fmtDate, fmtMoney, norm, num, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, detectHeaderRow, guessMapping, readWorkbook, sheetRows, toNumber, toYmd } from '../lib/excelImport';
import { useCustomers } from '../components/CustomerPicker';
import { Empty, ErrorBox, Field, Modal, Stat } from '../components/ui';

// Các cột cần lấy từ file công nợ của phần mềm kế toán (MISA, Fast, Bravo…)
const FIELDS = [
  { key: 'amount', label: 'Số tiền còn phải thu *', aliases: ['so du cuoi ky no', 'du no cuoi ky', 'con phai thu', 'so con phai thu', 'so tien con no', 'con no', 'so du no', 'du no', 'so con lai', 'con lai', 'phai thu', 'so du cuoi ky', 'so tien'] },
  { key: 'code', label: 'Mã khách hàng', aliases: ['ma khach hang', 'ma kh', 'ma doi tuong', 'ma dt'] },
  { key: 'name', label: 'Tên khách hàng *', aliases: ['ten khach hang', 'ten kh', 'ten doi tuong', 'khach hang', 'doi tuong', 'ten'] },
  { key: 'docNo', label: 'Số hóa đơn / chứng từ', aliases: ['so hoa don', 'so hd', 'so chung tu', 'so ct'] },
  { key: 'docDate', label: 'Ngày hóa đơn / chứng từ', aliases: ['ngay hoa don', 'ngay hd', 'ngay chung tu', 'ngay ct', 'ngay hach toan'] },
  { key: 'dueDate', label: 'Hạn thanh toán', aliases: ['han thanh toan', 'ngay den han', 'han tt', 'han no', 'ngay han'] },
  { key: 'overdueDays', label: 'Số ngày quá hạn', aliases: ['so ngay qua han', 'qua han ngay', 'so ngay no qua han', 'qua han'] },
  { key: 'staff', label: 'Nhân viên bán hàng', aliases: ['nhan vien ban hang', 'nv ban hang', 'nhan vien kinh doanh', 'nvkd', 'nhan vien'] },
  { key: 'note', label: 'Diễn giải / Ghi chú', aliases: ['dien giai', 'ghi chu'] },
];
const KEYWORDS = ['khach', 'doi tuong', 'ma', 'no', 'du', 'phai thu', 'hoa don', 'chung tu', 'han'];

const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const lineOverdue = (r, asOf) => (r.dueDate ? Math.max(0, dayDiff(asOf, r.dueDate)) : Number(r.overdueDays) || 0);

// Ghép tiêu đề 2 tầng kiểu MISA ("Số dư cuối kỳ" / "Nợ" "Có")
function buildHeaders(rows, hr) {
  const top = rows[hr] || [];
  const next = rows[hr + 1] || [];
  const nextCells = next.map(cellText).filter(Boolean);
  const isSub = nextCells.length >= 2 && nextCells.every((c) => isNaN(toNumber(c)) || toNumber(c) === 0) &&
    nextCells.every((c) => c.length <= 25) && nextCells.some((c) => ['no', 'co', 'so tien', 'so luong'].includes(norm(c)));
  if (!isSub) return { headers: top.map(cellText), start: hr + 1 };
  const width = Math.max(top.length, next.length);
  const headers = [];
  let carry = '';
  for (let i = 0; i < width; i++) {
    const t = cellText(top[i]);
    const n = cellText(next[i]);
    if (t) carry = t;
    headers.push(n ? `${t || carry} ${n}`.trim() : t);
  }
  return { headers, start: hr + 2 };
}

const toMs = (v) => (v?.toMillis ? v.toMillis() : Date.parse(v) || 0);

export default function Receivables({ staffFilter, onCollect }) {
  const { email, isAdmin, staffName } = useApp();
  const [meta, setMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [expand, setExpand] = useState({});
  const [importing, setImporting] = useState(false);

  const m = useDocSnap('receivables');
  const batchId = (meta || m)?.batchId;
  const asOf = (meta || m)?.asOf || today();
  const owner = isAdmin ? staffFilter : email;
  const { data, error } = useQuery(
    () => (batchId ? query(collection(db, 'receivables'), where('batchId', '==', batchId), ...(owner ? [where('ownerEmail', '==', owner)] : [])) : null),
    [batchId, owner]
  );

  // Phiếu thu ghi trên app SAU lần nhập số liệu kế toán → trừ vào công nợ còn lại
  const importedAt = toMs((meta || m)?.importedAt);
  const paysQ = useQuery(
    () => (batchId ? scopedQuery('payments', { me: email, isAdmin, staffFilter, from: asOf }) : null),
    [batchId, email, isAdmin, staffFilter, asOf]
  );
  const newPays = useMemo(() => paysQ.data.filter((p) => !importedAt || toMs(p.createdAt) > importedAt), [paysQ.data, importedAt]);

  const groups = useMemo(() => {
    const g = new Map();
    data.forEach((r) => {
      const k = r.customerCode ? 'c:' + norm(r.customerCode) : 'n:' + norm(r.customerName);
      if (!g.has(k)) g.set(k, { key: k, code: r.customerCode, name: r.customerName, customerId: r.customerId || '', ownerEmail: r.ownerEmail, lines: [], total: 0, overdue: 0, maxDays: 0, nextDue: '', paid: 0 });
      const x = g.get(k);
      const od = lineOverdue(r, asOf);
      x.lines.push({ ...r, od });
      x.total += r.amount;
      if (od > 0) x.overdue += r.amount;
      x.maxDays = Math.max(x.maxDays, od);
      if (r.dueDate && r.dueDate >= asOf && (!x.nextDue || r.dueDate < x.nextDue)) x.nextDue = r.dueDate;
    });
    const all = [...g.values()];
    newPays.forEach((p) => {
      const x = all.find((y) => (p.customerId && y.customerId === p.customerId) || norm(y.name) === norm(p.customerName));
      if (x) x.paid += num(p.amount);
    });
    all.forEach((x) => { x.remaining = Math.max(0, x.total - x.paid); });
    const s = norm(search);
    return all
      .filter((x) => (!s || norm(x.name).includes(s) || norm(x.code).includes(s)) && (!onlyOverdue || x.overdue > 0))
      .sort((a, b) => b.total - a.total);
  }, [data, search, onlyOverdue, asOf, newPays]);

  const tot = {
    total: groups.reduce((s, x) => s + x.total, 0),
    overdue: groups.reduce((s, x) => s + x.overdue, 0),
    paid: groups.reduce((s, x) => s + x.paid, 0),
    remaining: groups.reduce((s, x) => s + x.remaining, 0),
    unassigned: groups.filter((x) => !x.ownerEmail).length,
  };

  const doExport = () => exportSheets(`CongNo_KeToan_${asOf}`, {
    'Theo khách hàng': groups.map((x) => ({
      'Mã KH': x.code, 'Khách hàng': x.name, 'NV phụ trách': x.ownerEmail ? staffName(x.ownerEmail) : '(chưa gán)',
      'Số chứng từ': x.lines.length, 'Tổng nợ': Math.round(x.total), 'Đã thu trên app': Math.round(x.paid), 'Còn lại': Math.round(x.remaining), 'Quá hạn': Math.round(x.overdue), 'Quá hạn lâu nhất (ngày)': x.maxDays,
    })),
    'Chi tiết': groups.flatMap((x) => x.lines.map((r) => ({
      'Mã KH': r.customerCode, 'Khách hàng': r.customerName, 'NV phụ trách': r.ownerEmail ? staffName(r.ownerEmail) : '',
      'Số HĐ/CT': r.docNo, 'Ngày HĐ': fmtDate(r.docDate), 'Hạn TT': fmtDate(r.dueDate), 'Số tiền': Math.round(r.amount), 'Quá hạn (ngày)': r.od, 'Diễn giải': r.note,
    }))),
  });

  return (
    <>
      <div className="filters">
        <input placeholder="Tìm khách hàng / mã KH…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="nowrap"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> Chỉ khách quá hạn</label>
        <span className="small">
          {batchId ? <>Số liệu kế toán đến ngày <b>{fmtDate(asOf)}</b> · file "{(meta || m)?.fileName}"</> : 'Chưa nhập số liệu công nợ từ kế toán.'}
        </span>
        <div className="actions" style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={doExport} disabled={!groups.length}>⬇ Excel</button>
          {isAdmin && <button className="btn primary" onClick={() => setImporting(true)}>⬆ Nhập công nợ từ Excel kế toán</button>}
        </div>
      </div>
      <div className="stats">
        <Stat label="Tổng phải thu" value={fmtMoney(tot.total) + ' đ'} sub={`${groups.length} khách hàng`} tone="amber" />
        <Stat label="Đã thu (ghi trên app sau ngày số liệu)" value={fmtMoney(tot.paid) + ' đ'} sub={`Còn lại ${fmtMoney(tot.remaining)} đ`} tone="green" />
        <Stat label="Quá hạn" value={fmtMoney(tot.overdue) + ' đ'} sub={tot.total ? Math.round((tot.overdue / tot.total) * 100) + '% tổng nợ' : ''} tone="red" />
        {isAdmin && <Stat label="Khách chưa gán NV" value={tot.unassigned} sub="Thêm Mã KH / tên khớp ở mục Khách hàng rồi nhập lại" />}
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {groups.length === 0 ? <Empty text={batchId ? 'Không có công nợ' : 'Quản trị bấm "Nhập công nợ từ Excel kế toán" để tải danh sách'} /> : (
          <table>
            <thead><tr><th></th><th>Mã KH</th><th>Khách hàng</th>{isAdmin && <th>NV phụ trách</th>}<th className="num">Số CT</th>
              <th className="num">Tổng nợ</th><th className="num">Đã thu</th><th className="num">Còn lại</th><th className="num">Quá hạn</th><th className="num">Quá hạn lâu nhất</th><th>Hạn kế tiếp</th><th></th></tr></thead>
            <tbody>
              {groups.map((x) => (
                <FragmentRows key={x.key} x={x} open={!!expand[x.key]} toggle={() => setExpand({ ...expand, [x.key]: !expand[x.key] })} isAdmin={isAdmin} staffName={staffName} canCollect={isAdmin || x.ownerEmail === email} onCollect={onCollect} />
              ))}
            </tbody>
            <tfoot><tr><td></td><td></td><td>Tổng</td>{isAdmin && <td></td>}<td></td>
              <td className="num">{fmtMoney(tot.total)}</td><td className="num">{fmtMoney(tot.paid)}</td><td className="num">{fmtMoney(tot.remaining)}</td><td className="num">{fmtMoney(tot.overdue)}</td><td></td><td></td><td></td></tr></tfoot>
          </table>
        )}
      </div>
      {importing && <ImportReceivables current={meta || m} onClose={() => setImporting(false)} onDone={setMeta} />}
    </>
  );
}

function FragmentRows({ x, open, toggle, isAdmin, staffName, canCollect, onCollect }) {
  const cust = { customerId: x.customerId, customerName: x.name };
  return (
    <>
      <tr>
        <td><button className="btn sm ghost" onClick={toggle}>{open ? '▾' : '▸'}</button></td>
        <td className="nowrap">{x.code}</td>
        <td><b>{x.name}</b></td>
        {isAdmin && <td>{x.ownerEmail ? staffName(x.ownerEmail) : <span className="badge red">Chưa gán</span>}</td>}
        <td className="num">{x.lines.length}</td>
        <td className="num">{fmtMoney(x.total)}</td>
        <td className="num">{x.paid > 0 ? <span style={{ color: 'var(--green)' }}>{fmtMoney(x.paid)}</span> : '-'}</td>
        <td className="num"><b>{fmtMoney(x.remaining)}</b></td>
        <td className="num">{x.overdue > 0 ? <span className="badge red">{fmtMoney(x.overdue)}</span> : '-'}</td>
        <td className="num">{x.maxDays > 0 ? x.maxDays + ' ngày' : '-'}</td>
        <td>{fmtDate(x.nextDue)}</td>
        <td className="nowrap">
          {canCollect && onCollect && x.remaining > 0 && (
            <button className="btn sm primary" onClick={() => onCollect(cust, x.remaining)}>💰 Ghi thu tiền</button>
          )}
        </td>
      </tr>
      {open && x.lines.map((r) => (
        <tr key={r.id} style={{ background: '#fafbfd' }}>
          <td></td><td className="small">{r.docNo}</td>
          <td className="small">Ngày {fmtDate(r.docDate)}{r.note && ' · ' + r.note}</td>
          {isAdmin && <td></td>}<td></td>
          <td className="num small">{fmtMoney(r.amount)}</td><td></td><td></td>
          <td className="num small">{r.od > 0 ? <span style={{ color: 'var(--red)' }}>{fmtMoney(r.amount)}</span> : ''}</td>
          <td className="num small">{r.od > 0 ? r.od + ' ngày' : ''}</td>
          <td className="small">{fmtDate(r.dueDate)}</td>
          <td className="nowrap">
            {canCollect && onCollect && (
              <button className="btn sm" onClick={() => onCollect({ ...cust, orderNo: r.docNo || '' }, r.amount)}>Thu HĐ này</button>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

// Đọc realtime tài liệu settings/<id>
function useDocSnap(id) {
  const [v, setV] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'settings', id), (s) => setV(s.exists() ? s.data() : null), () => setV(null)), [id]);
  return v;
}

function ImportReceivables({ current, onClose, onDone }) {
  const { email, staffList } = useApp();
  const customers = useCustomers('').data;
  const [wb, setWb] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState('');
  const [hr, setHr] = useState(0);
  const [map, setMap] = useState({});
  const [asOf, setAsOf] = useState(today());
  const [skipZero, setSkipZero] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const rows = useMemo(() => (wb ? sheetRows(wb, sheet) : []), [wb, sheet]);
  const { headers, start } = useMemo(() => (rows.length ? buildHeaders(rows, hr) : { headers: [], start: 0 }), [rows, hr]);

  const load = async (file) => {
    setErr(''); setDone('');
    try {
      const w = await readWorkbook(file);
      setWb(w); setFileName(file.name);
      const sh = w.SheetNames[0];
      setSheet(sh);
      const r = sheetRows(w, sh);
      const h = detectHeaderRow(r, KEYWORDS);
      setHr(h);
      const { headers: hd } = buildHeaders(r, h);
      const saved = current?.mapping || {};
      const guess = guessMapping(hd, FIELDS);
      Object.entries(saved).forEach(([k, label]) => { const i = hd.findIndex((x) => norm(x) === norm(label)); if (i >= 0) guess[k] = i; });
      setMap(guess);
    } catch (e) { setErr(e.message); }
  };

  const reguess = (newHr, newSheet = sheet) => {
    const r = sheetRows(wb, newSheet);
    const { headers: hd } = buildHeaders(r, newHr);
    setMap(guessMapping(hd, FIELDS));
  };

  const parsed = useMemo(() => {
    if (!rows.length || map.amount === undefined || (map.name === undefined && map.code === undefined)) return [];
    const byCode = new Map(customers.filter((c) => c.code).map((c) => [norm(c.code), c]));
    const byName = new Map(customers.map((c) => [norm(c.name), c]));
    const staffByName = new Map(staffList.map((s) => [norm(s.name), s.email]));
    const staffByEmail = new Map(staffList.map((s) => [norm(s.email), s.email]));
    const out = [];
    let lastCode = '';
    let lastName = '';
    rows.slice(start).forEach((r, i) => {
      const get = (k) => (map[k] === undefined ? '' : r[map[k]]);
      let code = cellText(get('code'));
      let name = cellText(get('name'));
      const nk = norm(name || code);
      // Dòng tổng cộng (thường không có mã KH): "Tổng cộng", "Cộng", "Total"…
      if (!code && /^(tong|cong|total|so du dau|luy ke)( |$)/.test(nk) && !/^cong ty/.test(nk)) return;
      // Báo cáo chi tiết theo hóa đơn: dòng con có thể để trống tên KH → lấy theo dòng trên
      if (!code && !name && (get('docNo') || get('docDate'))) { code = lastCode; name = lastName; }
      if (!code && !name) return;
      lastCode = code; lastName = name;
      const amount = toNumber(get('amount'));
      if (skipZero && !amount) return;
      const cust = (code && byCode.get(norm(code))) || byName.get(norm(name));
      const st = norm(cellText(get('staff')));
      const ownerEmail = cust?.ownerEmail || staffByName.get(st) || staffByEmail.get(st) || '';
      out.push({
        line: start + i + 1, customerCode: code, customerName: name || cust?.name || code, customerId: cust?.id || '',
        ownerEmail, amount, docNo: cellText(get('docNo')), docDate: toYmd(get('docDate')), dueDate: toYmd(get('dueDate')),
        overdueDays: toNumber(get('overdueDays')), note: cellText(get('note')),
      });
    });
    return out;
  }, [rows, start, map, customers, staffList, skipZero]);

  const run = async () => {
    setBusy('Đang ghi dữ liệu…'); setErr('');
    try {
      const batchId = Date.now().toString(36);
      const nameOf = (e) => staffList.find((s) => s.email === e)?.name || e;
      for (let i = 0; i < parsed.length; i += 400) {
        const b = writeBatch(db);
        parsed.slice(i, i + 400).forEach(({ line, ...r }) => {
          b.set(doc(collection(db, 'receivables')), { ...r, ownerName: r.ownerEmail ? nameOf(r.ownerEmail) : '', batchId, asOf });
        });
        await b.commit();
        setBusy(`Đã ghi ${Math.min(i + 400, parsed.length)}/${parsed.length} dòng…`);
      }
      const mapping = Object.fromEntries(Object.entries(map).map(([k, i]) => [k, headers[i]]));
      const meta = {
        batchId, asOf, fileName, mapping, rowCount: parsed.length,
        total: parsed.reduce((s, r) => s + r.amount, 0), importedAt: serverTimestamp(), importedBy: email,
      };
      await setDoc(doc(db, 'settings', 'receivables'), meta);
      onDone(meta);
      // Xóa bộ số liệu cũ
      if (current?.batchId) {
        setBusy('Đang dọn số liệu cũ…');
        const old = await getDocs(query(collection(db, 'receivables'), where('batchId', '==', current.batchId)));
        for (let i = 0; i < old.docs.length; i += 400) {
          const b = writeBatch(db);
          old.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      setDone(`Đã nhập ${parsed.length} dòng công nợ, tổng ${fmtMoney(meta.total)} đ.`);
      setWb(null);
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  const unassigned = parsed.filter((r) => !r.ownerEmail).length;

  return (
    <Modal title="Nhập công nợ từ file Excel của phần mềm kế toán" onClose={onClose} wide>
      <p className="small">
        Xuất báo cáo <b>Tổng hợp / Chi tiết công nợ phải thu</b> từ phần mềm kế toán (MISA, Fast, Bravo…) ra Excel rồi chọn file ở đây.
        Hệ thống tự tìm dòng tiêu đề và đoán cột; anh kiểm tra lại phần ghép cột bên dưới. Lần nhập mới sẽ <b>thay thế</b> toàn bộ số liệu lần trước.
        Nhân viên phụ trách được gán theo <b>Mã KH / Tên KH</b> trong mục Khách hàng (hoặc cột Nhân viên bán hàng trong file).
      </p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {wb && (
        <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            {wb.SheetNames.length > 1 && (
              <Field label="Sheet">
                <select value={sheet} onChange={(e) => { setSheet(e.target.value); const r = sheetRows(wb, e.target.value); const h = detectHeaderRow(r, KEYWORDS); setHr(h); reguess(h, e.target.value); }}>
                  {wb.SheetNames.map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
            )}
            <Field label="Dòng tiêu đề (số dòng trong Excel)">
              <input type="number" min="1" value={hr + 1} onChange={(e) => { const v = Math.max(0, Number(e.target.value) - 1); setHr(v); reguess(v); }} />
            </Field>
            <Field label="Số liệu tính đến ngày">
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
            <Field label="Bỏ dòng có số dư = 0">
              <input type="checkbox" checked={skipZero} onChange={(e) => setSkipZero(e.target.checked)} />
            </Field>
          </div>
          <div className="section-title">Ghép cột</div>
          <div className="form-grid">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <select value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">— Không dùng —</option>
                  {headers.map((h, i) => h && <option key={i} value={i}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <div className="stats" style={{ marginTop: 12 }}>
            <Stat label="Số dòng hợp lệ" value={parsed.length} />
            <Stat label="Tổng tiền" value={fmtMoney(parsed.reduce((s, r) => s + r.amount, 0))} tone="amber" />
            <Stat label="Chưa gán được NV" value={unassigned} tone={unassigned ? 'red' : 'green'} />
          </div>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
            {parsed.length === 0 ? <Empty text="Chưa đọc được dòng nào — kiểm tra dòng tiêu đề và cột Số tiền / Tên KH" /> : (
              <table>
                <thead><tr><th>Dòng</th><th>Mã KH</th><th>Khách hàng</th><th>Số HĐ</th><th>Ngày HĐ</th><th>Hạn TT</th><th className="num">Số tiền</th><th>NV phụ trách</th></tr></thead>
                <tbody>
                  {parsed.slice(0, 200).map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td><td>{r.customerCode}</td><td>{r.customerName}</td><td>{r.docNo}</td>
                      <td>{fmtDate(r.docDate)}</td><td>{fmtDate(r.dueDate)}</td><td className="num">{fmtMoney(r.amount)}</td>
                      <td>{r.ownerEmail ? staffList.find((s) => s.email === r.ownerEmail)?.name || r.ownerEmail : <span className="badge red">Chưa gán</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {busy && <div className="ok-box" style={{ marginTop: 10 }}>{busy}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {wb && <button type="button" className="btn primary" disabled={!!busy || !parsed.length} onClick={run}>Nhập {parsed.length} dòng công nợ</button>}
      </div>
    </Modal>
  );
}

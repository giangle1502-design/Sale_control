import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { scopedQuery } from '../lib/data';
import { fmtDate, fmtMoney, norm, num, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { cellText, readWorkbook, sheetRows, toNumber } from '../lib/excelImport';
import { useCustomers } from '../components/CustomerPicker';
import { Empty, ErrorBox, Modal, Stat } from '../components/ui';

// ============================================================================
// Công nợ phải thu theo tuổi nợ — nhập từ báo cáo MISA AMIS
// "Phân tích công nợ phải thu theo tuổi nợ" (nhóm theo "Mã nhóm khách hàng" = sale)
// ============================================================================

const DEFAULT_BUCKETS = ['1-3 ngày', '4-10 ngày', '11-15 ngày', '16-30 ngày', 'Trên 30 ngày'];
const toMs = (v) => (v?.toMillis ? v.toMillis() : Date.parse(v) || 0);
const squash = (s) => norm(s).replace(/ /g, '');

// Bản chụp công nợ (mỗi ngày số liệu 1 bản) để phân tích theo tuần
export const snapRow = (r) => ({
  k: r.customerCode ? 'c:' + norm(r.customerCode) : 'n:' + norm(r.customerName),
  code: r.customerCode || '', name: r.customerName || '', group: r.saleGroup || '', owner: r.ownerEmail || '',
  amount: num(r.amount), overdue: num(r.overdue), notDue: num(r.notDue), aging: (r.aging || []).map(num),
});
export const saveSnapshot = (asOf, buckets, rows) => setDoc(doc(db, 'receivableSnapshots', asOf), {
  asOf, buckets, rows: rows.map(snapRow), savedAt: serverTimestamp(),
});

// Tìm nhân viên theo mã/tên nhóm khách hàng trong file kế toán (VD: DAUQUANGTHANG / ĐẬU QUANG THẮNG)
export function staffForGroup(staffList, code, name) {
  const keys = [squash(code), squash(name)].filter(Boolean);
  if (!keys.length) return null;
  return staffList.find((s) => keys.includes(squash(s.name)) || keys.includes(squash(s.email.split('@')[0]))) || null;
}

// Đọc file báo cáo tuổi nợ → { asOf, buckets, groups, rows }
export function parseAging(rows) {
  const txt = (r, i) => cellText(r?.[i]);
  // Ngày số liệu: "Tài khoản: 131, Đến ngày 28/09/2026"
  let asOf = '';
  rows.slice(0, 10).forEach((r) => r.forEach((c) => {
    const m = String(c || '').match(/đến ngày\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (m && !asOf) asOf = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }));
  // Dòng tiêu đề chính
  const hr = rows.findIndex((r) => r.some((c) => norm(c) === 'ma khach hang') && r.some((c) => norm(c).startsWith('tong no')));
  if (hr < 0) throw new Error('Không tìm thấy dòng tiêu đề "Mã khách hàng … Tổng nợ". Hãy dùng báo cáo "Phân tích công nợ phải thu theo tuổi nợ" của MISA.');
  const head = rows[hr].map(norm);
  const col = (pred) => head.findIndex(pred);
  const cCode = col((h) => h === 'ma khach hang');
  const cName = col((h) => h === 'ten khach hang');
  const cAddr = col((h) => h === 'dia chi');
  const cTotal = col((h) => h.startsWith('tong no'));
  const cOver = col((h) => h.startsWith('no qua han'));
  const cNotDue = col((h) => h.includes('chua den han') || h.includes('trong han'));
  // Dòng tiêu đề phụ chứa các khoảng tuổi nợ (1-3 ngày, 4-10 ngày…)
  let sub = -1;
  for (let i = hr; i < Math.min(hr + 4, rows.length); i++) {
    if (rows[i].some((c) => /\d+\s*-\s*\d+\s*ngày|trên\s*\d+\s*ngày/i.test(String(c)))) { sub = i; break; }
  }
  const buckets = [];
  let cOverTotal = -1;
  if (sub >= 0) {
    rows[sub].forEach((c, i) => {
      const t = cellText(c);
      if (i < cOver && cOver >= 0) return;
      if (/\d+\s*-\s*\d+\s*ngày|trên\s*\d+\s*ngày/i.test(t)) buckets.push({ label: t, col: i });
      else if (norm(t) === 'tong' && buckets.length) cOverTotal = i;
    });
  }
  if (cOverTotal < 0) cOverTotal = cOver;
  const start = (sub >= 0 ? sub : hr) + 1;

  const out = [];
  const groups = new Map();
  let group = { code: '', name: '' };
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const a = txt(r, 0);
    const na = norm(a);
    if (na.startsWith('ma nhom khach hang')) {
      const nameCell = r.map(cellText).find((c) => norm(c).startsWith('ten nhom khach hang')) || '';
      group = { code: a.split(':').slice(1).join(':').trim(), name: nameCell.split(':').slice(1).join(':').trim() };
      if (!groups.has(group.code)) groups.set(group.code, { ...group, count: 0, total: 0 });
      continue;
    }
    if (na.startsWith('cong nhom') || na.startsWith('tong cong') || na === 'ma khach hang' || na.startsWith('nguoi lap')) continue;
    const code = txt(r, cCode);
    const name = txt(r, cName);
    const rawTotal = r[cTotal];
    if (!code || !name || rawTotal === '' || rawTotal == null) continue;
    const total = toNumber(rawTotal);
    const aging = buckets.map((b) => toNumber(r[b.col]));
    const overdue = cOverTotal >= 0 ? toNumber(r[cOverTotal]) : aging.reduce((s, v) => s + v, 0);
    if (!total && !overdue) continue;
    const notDue = cNotDue >= 0 ? toNumber(r[cNotDue]) : total - overdue;
    out.push({
      line: i + 1, customerCode: code, customerName: name, address: cAddr >= 0 ? txt(r, cAddr) : '',
      amount: total, overdue, notDue, aging, saleGroup: group.code, saleGroupName: group.name,
    });
    if (groups.has(group.code)) { const g = groups.get(group.code); g.count += 1; g.total += total; }
  }
  // Tổng cộng trong file để đối chiếu
  const totalRow = rows.find((r) => norm(r[0]).startsWith('tong cong'));
  return {
    asOf, rows: out, groups: [...groups.values()],
    buckets: buckets.length ? buckets.map((b) => b.label) : DEFAULT_BUCKETS,
    fileTotal: totalRow ? toNumber(totalRow[cTotal]) : null,
  };
}

export default function Receivables({ staffFilter, setStaffFilter, onCollect }) {
  const { email, isAdmin, isAccountant, staffName, staffList } = useApp();
  const seeAll = isAdmin || isAccountant; // quản trị & kế toán xem mọi sale
  const [meta, setMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [only30, setOnly30] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const m = useDocSnap('receivables');
  const info = meta || m;
  const batchId = info?.batchId;
  const asOf = info?.asOf || today();
  const buckets = info?.buckets || DEFAULT_BUCKETS;
  const lastIdx = buckets.length - 1;
  const owner = seeAll ? staffFilter : email;
  const { data, error } = useQuery(
    () => (batchId ? query(collection(db, 'receivables'), where('batchId', '==', batchId), ...(owner ? [where('ownerEmail', '==', owner)] : [])) : null),
    [batchId, owner]
  );

  // Gán sale theo nhóm khách hàng trong file (khi admin thêm nhân viên mới có đúng tên nhóm → tự gán)
  useEffect(() => {
    if (!seeAll || owner || !data.length || !staffList.length) return;
    const todo = [];
    data.forEach((r) => {
      if (!r.saleGroup) return;
      const s = staffForGroup(staffList, r.saleGroup, r.saleGroupName);
      if (s && s.email !== r.ownerEmail) todo.push([r.id, { ownerEmail: s.email, ownerName: s.name || '' }]);
    });
    if (!todo.length) return;
    (async () => {
      try {
        for (let i = 0; i < todo.length; i += 400) {
          const b = writeBatch(db);
          todo.slice(i, i + 400).forEach(([id, v]) => b.update(doc(db, 'receivables', id), v));
          await b.commit();
        }
        setSyncMsg(`Đã gán sale cho ${todo.length} khách hàng theo nhóm trong file kế toán.`);
      } catch (e) { setSyncMsg('Không gán được sale: ' + e.message); }
    })();
  }, [seeAll, owner, data, staffList]);

  // Lưu bản chụp cho số liệu hiện tại nếu chưa có (dữ liệu nhập trước khi có tính năng phân tích tuần)
  useEffect(() => {
    if (!seeAll || owner || !batchId || !data.length || !info?.buckets) return;
    getDoc(doc(db, 'receivableSnapshots', asOf))
      .then((s) => { if (!s.exists()) return saveSnapshot(asOf, info.buckets, data); })
      .catch(() => {});
  }, [seeAll, owner, batchId, data.length, asOf]);

  // Phiếu thu ghi trên app SAU lần nhập số liệu kế toán → trừ vào công nợ còn lại
  const importedAt = toMs(info?.importedAt);
  const paysQ = useQuery(
    () => (batchId ? scopedQuery('payments', { me: email, isAdmin: seeAll, staffFilter, from: asOf }) : null),
    [batchId, email, seeAll, staffFilter, asOf]
  );
  const newPays = useMemo(() => paysQ.data.filter((p) => !importedAt || toMs(p.createdAt) > importedAt), [paysQ.data, importedAt]);

  // Liên kết với danh sách Khách hàng (theo Mã KH / MST / tên) để ghi thu tiền đúng khách, không tạo khách trùng
  const custList = useCustomers(isAdmin ? '' : email).data;
  const findCust = useMemo(() => {
    const byCode = new Map();
    custList.forEach((c) => { if (c.code) byCode.set(norm(c.code), c); if (c.taxCode) byCode.set(norm(c.taxCode), c); });
    const byName = new Map(custList.map((c) => [norm(c.name), c]));
    return (r) => byCode.get(norm(r.customerCode)) || byName.get(norm(r.customerName)) || null;
  }, [custList]);

  const saleLabel = (r) => (r.ownerEmail ? staffName(r.ownerEmail) : `Chưa gán${r.saleGroup ? ' (' + r.saleGroup + ')' : ''}`);

  const custs = useMemo(() => {
    const list = data.map((r) => ({
      ...r, customerId: r.customerId || findCust(r)?.id || '', aging: buckets.map((_, i) => num(r.aging?.[i])), overdue: num(r.overdue), notDue: num(r.notDue ?? (r.amount - num(r.overdue))), paid: 0,
    }));
    newPays.forEach((p) => {
      const x = list.find((y) => (p.customerId && y.customerId === p.customerId) || norm(y.customerName) === norm(p.customerName) || (y.customerCode && norm(y.customerCode) === norm(p.customerCode)));
      if (x) x.paid += num(p.amount);
    });
    list.forEach((x) => { x.remaining = Math.max(0, x.amount - x.paid); });
    const s = norm(search);
    return list
      .filter((x) => (!s || norm(x.customerName).includes(s) || norm(x.customerCode).includes(s) || norm(saleLabel(x)).includes(s))
        && (!onlyOverdue || x.overdue > 0) && (!only30 || x.aging[lastIdx] > 0))
      .sort((a, b) => b.overdue - a.overdue || b.amount - a.amount);
  }, [data, newPays, search, onlyOverdue, only30, buckets.length, staffList, findCust]);

  const sumOf = (list) => list.reduce((t, x) => ({
    count: t.count + 1, amount: t.amount + x.amount, notDue: t.notDue + x.notDue, overdue: t.overdue + x.overdue,
    paid: t.paid + x.paid, remaining: t.remaining + x.remaining, overdueCust: t.overdueCust + (x.overdue > 0 ? 1 : 0),
    aging: t.aging.map((v, i) => v + x.aging[i]),
  }), { count: 0, amount: 0, notDue: 0, overdue: 0, paid: 0, remaining: 0, overdueCust: 0, aging: buckets.map(() => 0) });

  const tot = sumOf(custs);
  const bySale = useMemo(() => {
    const g = new Map();
    custs.forEach((x) => {
      const k = x.ownerEmail || 'group:' + (x.saleGroup || '');
      if (!g.has(k)) g.set(k, { key: k, ownerEmail: x.ownerEmail || '', saleGroup: x.saleGroup, list: [] });
      g.get(k).list.push(x);
    });
    return [...g.values()].map((x) => ({ ...x, ...sumOf(x.list) })).sort((a, b) => b.overdue - a.overdue);
  }, [custs]);

  const agingCols = (x) => ({
    'Tổng nợ': Math.round(x.amount), 'Trong hạn': Math.round(x.notDue),
    ...Object.fromEntries(buckets.map((b, i) => ['Quá hạn ' + b, Math.round(x.aging[i])])),
    'Tổng quá hạn': Math.round(x.overdue), 'Đã thu trên app': Math.round(x.paid), 'Còn lại': Math.round(x.remaining),
  });
  const doExport = () => exportSheets(`CongNo_TuoiNo_${asOf}`, {
    'Theo sale': bySale.map((x) => ({ 'Nhân viên': saleLabel(x), 'Nhóm KH (kế toán)': x.saleGroup || '', 'Số KH': x.count, ...agingCols(x) })),
    'Theo khách hàng': custs.map((x) => ({
      'Mã KH': x.customerCode, 'Khách hàng': x.customerName, 'Địa chỉ': x.address, 'Nhân viên': saleLabel(x), 'Nhóm KH (kế toán)': x.saleGroup || '', ...agingCols(x),
    })),
  });

  const AgingHead = () => (
    <>
      <th className="num">Tổng nợ</th><th className="num">Trong hạn</th>
      {buckets.map((b) => <th key={b} className="num">QH {b.replace(' ngày', 'n')}</th>)}
      <th className="num">Tổng quá hạn</th><th className="num">Đã thu</th><th className="num">Còn lại</th>
    </>
  );
  const AgingCells = ({ x, bold }) => (
    <>
      <td className="num">{fmtMoney(x.amount)}</td>
      <td className="num">{x.notDue ? fmtMoney(x.notDue) : '-'}</td>
      {x.aging.map((v, i) => (
        <td key={i} className="num">{v ? <span style={{ color: i === lastIdx ? 'var(--red)' : i >= lastIdx - 1 ? 'var(--amber)' : undefined, fontWeight: i === lastIdx ? 700 : undefined }}>{fmtMoney(v)}</span> : '-'}</td>
      ))}
      <td className="num">{x.overdue > 0 ? <span className="badge red">{fmtMoney(x.overdue)}</span> : '-'}</td>
      <td className="num">{x.paid > 0 ? <span style={{ color: 'var(--green)' }}>{fmtMoney(x.paid)}</span> : '-'}</td>
      <td className="num">{bold ? <b>{fmtMoney(x.remaining)}</b> : fmtMoney(x.remaining)}</td>
    </>
  );

  return (
    <>
      <div className="filters">
        <input placeholder={seeAll ? 'Tìm khách hàng / mã KH / tên sale…' : 'Tìm khách hàng / mã KH…'} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="nowrap"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> Chỉ khách quá hạn</label>
        <label className="nowrap"><input type="checkbox" checked={only30} onChange={(e) => setOnly30(e.target.checked)} /> Chỉ nợ {buckets[lastIdx]?.toLowerCase()}</label>
        <span className="small">
          {batchId ? <>Số liệu kế toán đến ngày <b>{fmtDate(asOf)}</b> · file "{info?.fileName}"</> : 'Chưa nhập số liệu công nợ từ kế toán.'}
        </span>
        <div className="actions" style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={doExport} disabled={!custs.length}>⬇ Excel</button>
          {seeAll && <button className="btn primary" onClick={() => setImporting(true)}>⬆ Nhập công nợ (MISA tuổi nợ)</button>}
        </div>
      </div>
      <div className="stats">
        <Stat label="Tổng phải thu" value={fmtMoney(tot.amount) + ' đ'} sub={`${tot.count} khách hàng`} tone="amber" />
        <Stat label="Quá hạn" value={fmtMoney(tot.overdue) + ' đ'} sub={`${tot.overdueCust} KH · ${tot.amount ? Math.round((tot.overdue / tot.amount) * 100) : 0}% tổng nợ`} tone="red" />
        <Stat label={'Quá hạn ' + (buckets[lastIdx] || '').toLowerCase()} value={fmtMoney(tot.aging[lastIdx] || 0) + ' đ'} tone="red" />
        <Stat label="Đã thu (ghi trên app sau ngày số liệu)" value={fmtMoney(tot.paid) + ' đ'} sub={`Còn lại ${fmtMoney(tot.remaining)} đ`} tone="green" />
      </div>
      <ErrorBox error={error} />
      {syncMsg && <div className="ok-box" style={{ marginBottom: 10 }}>{syncMsg}</div>}

      {seeAll && batchId && (
        <>
          <div className="section-title">
            Công nợ theo nhân viên sale
            {staffFilter && setStaffFilter && <> · <a href="#" className="small" onClick={(e) => { e.preventDefault(); setStaffFilter(''); }}>Xem tất cả sale</a></>}
          </div>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            {bySale.length === 0 ? <Empty /> : (
              <table>
                <thead><tr><th>Nhân viên</th><th className="num">Số KH</th><AgingHead /><th></th></tr></thead>
                <tbody>
                  {bySale.map((x) => (
                    <tr key={x.key} style={staffFilter && staffFilter === x.ownerEmail ? { background: 'var(--primary-soft)' } : undefined}>
                      <td>{x.ownerEmail ? <b>{staffName(x.ownerEmail)}</b> : <span className="badge red" title="Thêm nhân viên có Họ tên đúng bằng mã nhóm này ở mục Nhân viên">{saleLabel(x)}</span>}</td>
                      <td className="num">{x.count}</td>
                      <AgingCells x={x} bold />
                      <td className="nowrap">
                        {x.ownerEmail && setStaffFilter && staffFilter !== x.ownerEmail && (
                          <button className="btn sm" onClick={() => setStaffFilter(x.ownerEmail)}>Xem chi tiết ›</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {bySale.length > 1 && <tfoot><tr><td>Tổng</td><td className="num">{tot.count}</td><AgingCells x={tot} bold /><td></td></tr></tfoot>}
              </table>
            )}
          </div>
          <div className="section-title">Chi tiết theo khách hàng{staffFilter ? ' – ' + staffName(staffFilter) : ''}</div>
        </>
      )}

      <div className="table-wrap">
        {custs.length === 0 ? <Empty text={batchId ? 'Không có công nợ' : 'Quản trị bấm "Nhập công nợ (MISA tuổi nợ)" để tải danh sách'} /> : (
          <table>
            <thead><tr><th>Mã KH</th><th>Khách hàng</th>{seeAll && <th>NV phụ trách</th>}<AgingHead /><th></th></tr></thead>
            <tbody>
              {custs.map((x) => (
                <tr key={x.id}>
                  <td className="nowrap">{x.customerCode}</td>
                  <td><b>{x.customerName}</b>{x.address && <div className="small">{x.address}</div>}</td>
                  {seeAll && <td>{x.ownerEmail ? staffName(x.ownerEmail) : <span className="badge red">{saleLabel(x)}</span>}</td>}
                  <AgingCells x={x} bold />
                  <td className="nowrap">
                    {onCollect && (isAdmin || x.ownerEmail === email) && x.remaining > 0 && (
                      <button className="btn sm primary" onClick={() => onCollect({ customerId: x.customerId || '', customerName: x.customerName }, x.remaining)}>💰 Ghi thu tiền</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td></td><td>Tổng ({tot.count} KH)</td>{seeAll && <td></td>}<AgingCells x={tot} bold /><td></td></tr></tfoot>
          </table>
        )}
      </div>
      {importing && <ImportReceivables current={info} onClose={() => setImporting(false)} onDone={setMeta} />}
    </>
  );
}

function ImportReceivables({ current, onClose, onDone }) {
  const { email, staffList } = useApp();
  const [fileName, setFileName] = useState('');
  const [res, setRes] = useState(null);
  const [asOf, setAsOf] = useState(today());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const load = async (file) => {
    setErr(''); setDone(''); setRes(null);
    try {
      const wb = await readWorkbook(file);
      const r = parseAging(sheetRows(wb, wb.SheetNames[0]));
      if (!r.rows.length) throw new Error('Không đọc được dòng khách hàng nào trong file.');
      setRes(r); setFileName(file.name);
      if (r.asOf) setAsOf(r.asOf);
    } catch (e) { setErr(e.message); }
  };

  const withOwner = useMemo(() => (res ? res.rows.map((r) => {
    const s = staffForGroup(staffList, r.saleGroup, r.saleGroupName);
    return { ...r, ownerEmail: s?.email || '', ownerName: s?.name || '' };
  }) : []), [res, staffList]);
  const total = withOwner.reduce((s, r) => s + r.amount, 0);
  const groups = res ? res.groups.map((g) => ({ ...g, staff: staffForGroup(staffList, g.code, g.name) })) : [];
  const missing = groups.filter((g) => !g.staff);

  const run = async () => {
    setBusy('Đang ghi dữ liệu…'); setErr('');
    try {
      const batchId = Date.now().toString(36);
      for (let i = 0; i < withOwner.length; i += 400) {
        const b = writeBatch(db);
        withOwner.slice(i, i + 400).forEach(({ line, ...r }) => b.set(doc(collection(db, 'receivables')), { ...r, batchId, asOf }));
        await b.commit();
        setBusy(`Đã ghi ${Math.min(i + 400, withOwner.length)}/${withOwner.length} khách hàng…`);
      }
      const meta = {
        batchId, asOf, fileName, format: 'misa-aging', buckets: res.buckets, rowCount: withOwner.length,
        total, importedAt: serverTimestamp(), importedBy: email,
      };
      await setDoc(doc(db, 'settings', 'receivables'), meta);
      await saveSnapshot(asOf, res.buckets, withOwner);
      onDone(meta);
      if (current?.batchId) {
        setBusy('Đang dọn số liệu cũ…');
        const old = await getDocs(query(collection(db, 'receivables'), where('batchId', '==', current.batchId)));
        for (let i = 0; i < old.docs.length; i += 400) {
          const b = writeBatch(db);
          old.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      setDone(`Đã nhập công nợ ${withOwner.length} khách hàng, tổng ${fmtMoney(total)} đ (đến ngày ${fmtDate(asOf)}).`);
      setRes(null);
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <Modal title="Nhập công nợ phải thu theo tuổi nợ (MISA AMIS)" onClose={onClose} wide>
      <p className="small">
        Trên MISA AMIS: <b>Báo cáo → Phân tích công nợ phải thu theo tuổi nợ</b>, chọn nhóm theo <b>Nhóm khách hàng</b> (mỗi nhóm là một sale), xuất Excel rồi chọn file ở đây.
        Sale được gán theo <b>Mã nhóm khách hàng</b> — khớp với <b>Họ tên</b> nhân viên ở mục Nhân viên (VD: DAUQUANGTHANG).
        Lần nhập mới sẽ <b>thay thế</b> toàn bộ số liệu lần trước.
      </p>
      <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {done && <div className="ok-box" style={{ marginTop: 10 }}>{done}</div>}
      {res && (
        <>
          <div className="filters" style={{ marginTop: 12 }}>
            <span>Số liệu đến ngày</span>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <span className="small">Các khoảng quá hạn: {res.buckets.join(' · ')}</span>
          </div>
          <div className="stats">
            <Stat label="Số khách hàng" value={withOwner.length} />
            <Stat label="Tổng nợ đọc được" value={fmtMoney(total)} tone="amber"
              sub={res.fileTotal != null ? (Math.round(res.fileTotal) === Math.round(total) ? '✔ Khớp dòng Tổng cộng trong file' : `⚠ Tổng cộng trong file: ${fmtMoney(res.fileTotal)}`) : ''} />
            <Stat label="Tổng quá hạn" value={fmtMoney(withOwner.reduce((s, r) => s + r.overdue, 0))} tone="red" />
          </div>
          <div className="section-title">Nhóm sale trong file</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Mã nhóm</th><th>Tên nhóm</th><th className="num">Số KH</th><th className="num">Tổng nợ</th><th>Gán cho nhân viên</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.code}>
                    <td>{g.code}</td><td>{g.name}</td><td className="num">{g.count}</td><td className="num">{fmtMoney(g.total)}</td>
                    <td>{g.staff ? <span className="badge green">{g.staff.name} ({g.staff.email})</span> : <span className="badge red">Chưa có trong mục Nhân viên</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <p className="small">
              Nhóm <b>{missing.map((g) => g.code).join(', ')}</b> chưa khớp nhân viên nào — vẫn nhập được, hiện là "Chưa gán".
              Khi thêm nhân viên có <b>Họ tên</b> đúng bằng mã nhóm, công nợ sẽ tự gán cho người đó.
            </p>
          )}
          <div className="section-title">Xem trước</div>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Dòng</th><th>Mã KH</th><th>Khách hàng</th><th>Nhóm</th><th className="num">Tổng nợ</th>
                {res.buckets.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Quá hạn</th></tr></thead>
              <tbody>
                {withOwner.slice(0, 300).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td><td>{r.customerCode}</td><td>{r.customerName}</td><td className="small">{r.saleGroup}</td>
                    <td className="num">{fmtMoney(r.amount)}</td>
                    {r.aging.map((v, i) => <td key={i} className="num">{v ? fmtMoney(v) : '-'}</td>)}
                    <td className="num">{r.overdue ? fmtMoney(r.overdue) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {busy && <div className="ok-box" style={{ marginTop: 10 }}>{busy}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {res && <button type="button" className="btn primary" disabled={!!busy || !withOwner.length} onClick={run}>Nhập công nợ {withOwner.length} khách hàng</button>}
      </div>
    </Modal>
  );
}

// Đọc realtime tài liệu settings/<id>
function useDocSnap(id) {
  const [v, setV] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'settings', id), (s) => setV(s.exists() ? s.data() : null), () => setV(null)), [id]);
  return v;
}

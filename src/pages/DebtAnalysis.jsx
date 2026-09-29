import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { scopedQuery } from '../lib/data';
import { addDays, fmtDate, fmtMoney, fmtNum, norm, num, orderAmount, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { useCustomers } from '../components/CustomerPicker';
import { Empty, ErrorBox, Stat } from '../components/ui';
import { weekStart } from './DailyNotes';
import { staffForGroup } from './Receivables';

// ============================================================================
// Phân tích công nợ theo tuần — so sánh các bản chụp (mỗi lần nhập file tuổi nợ MISA)
// Nợ mới / Đã thu được ƯỚC TÍNH từ chênh lệch tổng nợ từng khách giữa 2 bản chụp.
// ============================================================================

const short = (v) => (Math.abs(v) >= 1e9 ? fmtNum(v / 1e9, 2) + ' tỷ' : Math.abs(v) >= 1e6 ? fmtNum(v / 1e6, 0) + ' tr' : fmtNum(v, 0));
const worst = (aging) => { for (let i = aging.length - 1; i >= 0; i--) if (num(aging[i]) > 0) return i; return -1; };
const Delta = ({ v, good = 'down' }) => {
  if (!v) return <span className="small">không đổi</span>;
  const up = v > 0;
  const bad = good === 'down' ? up : !up;
  return <span className="small" style={{ color: bad ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{up ? '▲ +' : '▼ −'}{fmtMoney(Math.abs(v))} đ</span>;
};

export default function DebtAnalysis() {
  const { isAdmin, staffName, staffList } = useApp();
  const [snaps, setSnaps] = useState(null);
  const [err, setErr] = useState('');
  const [curKey, setCurKey] = useState('');
  const [prevKey, setPrevKey] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'receivableSnapshots'))
      .then((s) => setSnaps(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.asOf.localeCompare(b.asOf))))
      .catch((e) => { setErr(e.message); setSnaps([]); });
  }, []);

  // Mặc định: bản mới nhất so với bản gần nhất cách ~7 ngày
  useEffect(() => {
    if (!snaps?.length) return;
    const cur = snaps[snaps.length - 1];
    const target = addDays(cur.asOf, -7);
    const older = snaps.filter((s) => s.asOf < cur.asOf);
    const prev = older.filter((s) => s.asOf <= target).pop() || older[0];
    setCurKey(cur.asOf); setPrevKey(prev?.asOf || '');
  }, [snaps]);

  const cur = snaps?.find((s) => s.asOf === curKey);
  const prev = snaps?.find((s) => s.asOf === prevKey);
  const buckets = cur?.buckets || [];
  const lastIdx = buckets.length - 1;
  const saleOf = (r) => (r.owner ? staffName(r.owner) : r.group ? `Chưa gán (${r.group})` : 'Chưa gán');

  // Phiếu thu sale ghi trên app trong khoảng so sánh (tham khảo)
  const pays = useQuery(
    () => (cur && prev ? scopedQuery('payments', { me: '', isAdmin: true, from: addDays(prev.asOf, 1), to: cur.asOf }) : null),
    [curKey, prevKey]
  );

  const a = useMemo(() => {
    if (!cur) return null;
    const P = new Map((prev?.rows || []).map((r) => [r.k, r]));
    const C = new Map(cur.rows.map((r) => [r.k, r]));
    const keys = new Set([...P.keys(), ...C.keys()]);
    const rows = [...keys].map((k) => {
      const p = P.get(k); const c = C.get(k);
      const base = c || p;
      const pa = num(p?.amount); const ca = num(c?.amount);
      return {
        k, code: base.code, name: base.name, group: base.group,
        owner: staffForGroup(staffList, base.group, '')?.email || c?.owner || p?.owner || '',
        prevAmt: pa, curAmt: ca, newDebt: Math.max(0, ca - pa), collected: Math.max(0, pa - ca),
        prevOver: num(p?.overdue), curOver: num(c?.overdue),
        prevWorst: p ? worst(p.aging || []) : -1, curWorst: c ? worst(c.aging || []) : -1,
        curAging: (c?.aging || []).map(num), inPrev: !!p, inCur: !!c,
      };
    });
    const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
    const agingCur = buckets.map((_, i) => cur.rows.reduce((s, r) => s + num(r.aging?.[i]), 0));
    const agingPrev = buckets.map((_, i) => (prev?.rows || []).reduce((s, r) => s + num(r.aging?.[i]), 0));
    const worse = rows.filter((r) => r.inCur && r.curWorst > r.prevWorst && r.curOver > 0).sort((x, y) => y.curWorst - x.curWorst || y.curOver - x.curOver);
    const cleared = rows.filter((r) => r.inPrev && r.prevOver > 0 && r.curOver === 0).sort((x, y) => y.prevOver - x.prevOver);
    // Theo sale
    const sm = new Map();
    rows.forEach((r) => {
      const key = r.owner || 'g:' + (r.group || '');
      if (!sm.has(key)) sm.set(key, { key, owner: r.owner, group: r.group, prevAmt: 0, newDebt: 0, collected: 0, curAmt: 0, prevOver: 0, curOver: 0, cust: 0 });
      const x = sm.get(key);
      x.prevAmt += r.prevAmt; x.newDebt += r.newDebt; x.collected += r.collected; x.curAmt += r.curAmt; x.prevOver += r.prevOver; x.curOver += r.curOver;
      if (r.inCur) x.cust += 1;
    });
    const bySale = [...sm.values()].map((x) => ({ ...x, pct: x.curAmt ? x.curOver / x.curAmt : 0, collectRate: x.prevAmt ? x.collected / x.prevAmt : 0 }))
      .sort((x, y) => y.pct - x.pct);
    return {
      rows, worse, cleared, bySale, agingCur, agingPrev,
      prevTotal: sum((r) => r.prevAmt), curTotal: sum((r) => r.curAmt),
      newDebt: sum((r) => r.newDebt), collected: sum((r) => r.collected),
      prevOver: sum((r) => r.prevOver), curOver: sum((r) => r.curOver),
      topDebt: [...rows].filter((r) => r.inCur).sort((x, y) => y.curAmt - x.curAmt).slice(0, 10),
      topOld: [...rows].filter((r) => r.inCur && r.curOver > 0).sort((x, y) => y.curWorst - x.curWorst || (y.curAging[y.curWorst] || 0) - (x.curAging[x.curWorst] || 0)).slice(0, 10),
    };
  }, [cur, prev, buckets.length, staffList]);

  // Xu hướng: bản chụp cuối của mỗi tuần, 12 tuần gần nhất
  const trend = useMemo(() => {
    const byWeek = new Map();
    (snaps || []).forEach((s) => byWeek.set(weekStart(s.asOf), s));
    return [...byWeek.entries()].slice(-12).map(([w, s]) => ({
      label: fmtDate(w).slice(0, 5),
      total: s.rows.reduce((t, r) => t + num(r.amount), 0),
      overdue: s.rows.reduce((t, r) => t + num(r.overdue), 0),
      over30: s.rows.reduce((t, r) => t + num(r.aging?.[(s.buckets || []).length - 1]), 0),
    }));
  }, [snaps]);

  if (snaps === null) return <Empty text="Đang tải…" />;
  if (!snaps.length) return (
    <>
      <ErrorBox error={err} />
      <Empty text='Chưa có dữ liệu. Mỗi lần kế toán bấm "Nhập công nợ (MISA tuổi nợ)", hệ thống sẽ lưu lại một bản để so sánh theo tuần.' />
    </>
  );

  if (!a) return <Empty text="Đang tải…" />;
  const payTotal = pays.data.reduce((s, p) => s + num(p.amount), 0);
  const bucketName = (i) => (i < 0 ? 'Trong hạn' : buckets[i] || '');
  const doExport = () => exportSheets(`PhanTichCongNo_${prevKey}_${curKey}`, {
    'Theo sale': a.bySale.map((x) => ({
      'Nhân viên': x.owner ? staffName(x.owner) : `Chưa gán (${x.group || ''})`, 'Số KH': x.cust, 'Nợ đầu kỳ': Math.round(x.prevAmt), 'Nợ mới (ước tính)': Math.round(x.newDebt),
      'Đã thu (ước tính)': Math.round(x.collected), 'Nợ cuối kỳ': Math.round(x.curAmt), 'Quá hạn': Math.round(x.curOver), '% quá hạn': Math.round(x.pct * 100) + '%',
    })),
    'Theo khách hàng': a.rows.map((r) => ({
      'Mã KH': r.code, 'Khách hàng': r.name, 'Nhân viên': saleOf(r), 'Nợ đầu kỳ': Math.round(r.prevAmt), 'Nợ mới (ước tính)': Math.round(r.newDebt),
      'Đã thu (ước tính)': Math.round(r.collected), 'Nợ cuối kỳ': Math.round(r.curAmt), 'Quá hạn': Math.round(r.curOver),
      'Nhóm tuổi nợ tuần trước': bucketName(r.prevWorst), 'Nhóm tuổi nợ hiện tại': bucketName(r.curWorst),
    })),
    'Chuyển xấu': a.worse.map((r) => ({ 'Mã KH': r.code, 'Khách hàng': r.name, 'Nhân viên': saleOf(r), 'Trước': bucketName(r.prevWorst), 'Nay': bucketName(r.curWorst), 'Quá hạn': Math.round(r.curOver) })),
    'Đã hết quá hạn': a.cleared.map((r) => ({ 'Mã KH': r.code, 'Khách hàng': r.name, 'Nhân viên': saleOf(r), 'Quá hạn trước': Math.round(r.prevOver) })),
  });

  return (
    <>
      <div className="filters">
        <span>Số liệu ngày</span>
        <select value={curKey} onChange={(e) => setCurKey(e.target.value)}>
          {[...snaps].reverse().map((s) => <option key={s.asOf} value={s.asOf}>{fmtDate(s.asOf)}</option>)}
        </select>
        <span>so với</span>
        <select value={prevKey} onChange={(e) => setPrevKey(e.target.value)}>
          <option value="">(không so sánh)</option>
          {[...snaps].reverse().filter((s) => s.asOf < curKey).map((s) => <option key={s.asOf} value={s.asOf}>{fmtDate(s.asOf)}</option>)}
        </select>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={doExport}>⬇ Excel</button>
      </div>
      <ErrorBox error={err} />
      {!prev && <div className="ok-box" style={{ marginBottom: 10 }}>Mới có 1 lần nhập số liệu. Từ lần nhập tiếp theo (ngày khác) sẽ có so sánh nợ mới / đã thu / chuyển xấu.</div>}

      <div className="stats">
        <Stat label={`Tổng phải thu ${fmtDate(curKey)}`} value={fmtMoney(a.curTotal) + ' đ'} sub={prev ? <Delta v={a.curTotal - a.prevTotal} /> : ''} tone="amber" />
        {prev && <Stat label="Nợ mới phát sinh (ước tính)" value={fmtMoney(a.newDebt) + ' đ'} sub={`từ ${fmtDate(prevKey)} đến ${fmtDate(curKey)}`} />}
        {prev && <Stat label="Nợ cũ đã giảm / đã thu (ước tính)" value={fmtMoney(a.collected) + ' đ'} sub={`Phiếu thu sale ghi trên app: ${fmtMoney(payTotal)} đ`} tone="green" />}
        <Stat label="Nợ quá hạn" value={fmtMoney(a.curOver) + ' đ'} sub={prev ? <Delta v={a.curOver - a.prevOver} /> : `${a.curTotal ? Math.round((a.curOver / a.curTotal) * 100) : 0}% tổng nợ`} tone="red" />
        <Stat label={'Quá hạn ' + (buckets[lastIdx] || '').toLowerCase()} value={fmtMoney(a.agingCur[lastIdx] || 0) + ' đ'} sub={prev ? <Delta v={(a.agingCur[lastIdx] || 0) - (a.agingPrev[lastIdx] || 0)} /> : ''} tone="red" />
      </div>
      {prev && <p className="small">Nợ mới / đã thu được ước tính từ chênh lệch tổng nợ từng khách giữa 2 lần nhập (khách vừa trả vừa mua trong kỳ chỉ tính phần chênh lệch).</p>}

      {trend.length > 1 && (
        <div className="chart-card" style={{ marginBottom: 14 }}>
          <h4>Xu hướng công nợ theo tuần</h4>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={trend} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke="#eef1f5" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={{ stroke: '#e3e7ed' }} />
              <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: '#6b7684' }} tickLine={false} axisLine={false} width={60} />
              <Tooltip formatter={(v, n) => [fmtMoney(v) + ' đ', n]} labelFormatter={(l) => 'Tuần ' + l} />
              <Legend />
              <Bar dataKey="total" name="Tổng nợ" fill="#9fb8d9" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line dataKey="overdue" name="Quá hạn" stroke="#c62828" strokeWidth={2} dot />
              <Line dataKey="over30" name={'Quá hạn ' + (buckets[lastIdx] || '').toLowerCase()} stroke="#b26a00" strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="section-title">Phân bố tuổi nợ</div>
      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>Nhóm</th><th className="num">{fmtDate(curKey)}</th>{prev && <><th className="num">{fmtDate(prevKey)}</th><th className="num">Thay đổi</th></>}<th className="num">Số KH</th></tr></thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr key={b}>
                <td>Quá hạn {b}</td>
                <td className="num"><b>{fmtMoney(a.agingCur[i])}</b></td>
                {prev && <><td className="num">{fmtMoney(a.agingPrev[i])}</td><td className="num"><Delta v={a.agingCur[i] - a.agingPrev[i]} /></td></>}
                <td className="num">{cur.rows.filter((r) => num(r.aging?.[i]) > 0).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Theo nhân viên sale</div>
      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>Nhân viên</th><th className="num">Số KH</th>{prev && <><th className="num">Nợ đầu kỳ</th><th className="num">Nợ mới</th><th className="num">Đã thu</th></>}
            <th className="num">Nợ hiện tại</th><th className="num">Quá hạn</th><th className="num">% quá hạn</th>{prev && <th className="num">Quá hạn thay đổi</th>}</tr></thead>
          <tbody>
            {a.bySale.map((x) => (
              <tr key={x.key}>
                <td><b>{x.owner ? staffName(x.owner) : <span className="badge red">Chưa gán ({x.group})</span>}</b></td>
                <td className="num">{x.cust}</td>
                {prev && <><td className="num">{fmtMoney(x.prevAmt)}</td><td className="num">{fmtMoney(x.newDebt)}</td><td className="num" style={{ color: 'var(--green)' }}>{fmtMoney(x.collected)}</td></>}
                <td className="num"><b>{fmtMoney(x.curAmt)}</b></td>
                <td className="num">{x.curOver ? <span className="badge red">{fmtMoney(x.curOver)}</span> : '-'}</td>
                <td className="num">{Math.round(x.pct * 100)}%</td>
                {prev && <td className="num"><Delta v={x.curOver - x.prevOver} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prev && (
        <div className="grid2" style={{ marginBottom: 14 }}>
          <div>
            <div className="section-title">⚠ Khách chuyển xấu ({a.worse.length})</div>
            <div className="table-wrap">
              {a.worse.length === 0 ? <Empty text="Không có khách chuyển xấu" /> : (
                <table><thead><tr><th>Khách hàng</th><th>Sale</th><th>Trước → Nay</th><th className="num">Quá hạn</th></tr></thead>
                  <tbody>{a.worse.slice(0, 30).map((r) => (
                    <tr key={r.k}><td>{r.name}<div className="small">{r.code}</div></td><td>{saleOf(r)}</td>
                      <td className="small">{bucketName(r.prevWorst)} → <b style={{ color: 'var(--red)' }}>{bucketName(r.curWorst)}</b></td>
                      <td className="num">{fmtMoney(r.curOver)}</td></tr>
                  ))}</tbody></table>
              )}
            </div>
          </div>
          <div>
            <div className="section-title">✔ Khách đã hết quá hạn ({a.cleared.length})</div>
            <div className="table-wrap">
              {a.cleared.length === 0 ? <Empty text="Chưa có" /> : (
                <table><thead><tr><th>Khách hàng</th><th>Sale</th><th className="num">Quá hạn trước</th></tr></thead>
                  <tbody>{a.cleared.slice(0, 30).map((r) => (
                    <tr key={r.k}><td>{r.name}<div className="small">{r.code}</div></td><td>{saleOf(r)}</td><td className="num" style={{ color: 'var(--green)' }}>{fmtMoney(r.prevOver)}</td></tr>
                  ))}</tbody></table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid2" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-title">Top 10 khách nợ nhiều nhất</div>
          <div className="table-wrap">
            <table><thead><tr><th>Khách hàng</th><th>Sale</th><th className="num">Tổng nợ</th><th className="num">Quá hạn</th></tr></thead>
              <tbody>{a.topDebt.map((r) => (
                <tr key={r.k}><td>{r.name}</td><td>{saleOf(r)}</td><td className="num"><b>{fmtMoney(r.curAmt)}</b></td><td className="num">{r.curOver ? fmtMoney(r.curOver) : '-'}</td></tr>
              ))}</tbody></table>
          </div>
        </div>
        <div>
          <div className="section-title">Top 10 khách quá hạn lâu nhất</div>
          <div className="table-wrap">
            {a.topOld.length === 0 ? <Empty text="Không có khách quá hạn" /> : (
              <table><thead><tr><th>Khách hàng</th><th>Sale</th><th>Nhóm</th><th className="num">Quá hạn</th></tr></thead>
                <tbody>{a.topOld.map((r) => (
                  <tr key={r.k}><td>{r.name}</td><td>{saleOf(r)}</td><td><span className="badge red">{bucketName(r.curWorst)}</span></td><td className="num">{fmtMoney(r.curOver)}</td></tr>
                ))}</tbody></table>
            )}
          </div>
        </div>
      </div>

      {isAdmin && <AdminAlerts rows={a.rows.filter((r) => r.inCur && r.curOver > 0)} lastIdx={lastIdx} saleOf={saleOf} bucketName={bucketName} />}
    </>
  );
}

// Cảnh báo kết hợp hoạt động sale (chỉ quản trị): quá hạn mà chưa liên hệ 7 ngày; quá hạn lâu nhưng vẫn báo giá/đơn mới
function AdminAlerts({ rows, lastIdx, saleOf, bucketName }) {
  const { email } = useApp();
  const t = today();
  const custs = useCustomers('').data;
  const acts = useQuery(() => scopedQuery('activities', { me: email, isAdmin: true, from: addDays(t, -7), to: t }), [email, t]);
  const quos = useQuery(() => scopedQuery('quotes', { me: email, isAdmin: true, from: addDays(t, -30), to: t }), [email, t]);
  const ords = useQuery(() => scopedQuery('orders', { me: email, isAdmin: true, from: addDays(t, -30), to: t }), [email, t]);

  const find = useMemo(() => {
    const byCode = new Map();
    custs.forEach((c) => { if (c.code) byCode.set(norm(c.code), c); if (c.taxCode) byCode.set(norm(c.taxCode), c); });
    const byName = new Map(custs.map((c) => [norm(c.name), c]));
    return (r) => byCode.get(norm(r.code)) || byName.get(norm(r.name)) || null;
  }, [custs]);
  const hit = (list, r, c) => list.filter((x) => (c && x.customerId === c.id) || norm(x.customerName) === norm(r.name));

  const noContact = rows.filter((r) => hit(acts.data, r, find(r)).length === 0).sort((x, y) => y.curOver - x.curOver);
  const stillSelling = rows.filter((r) => r.curWorst === lastIdx).map((r) => {
    const c = find(r);
    const q = hit(quos.data, r, c); const o = hit(ords.data, r, c);
    return { ...r, q: q.length, o: o.length, value: [...q, ...o].reduce((s, x) => s + orderAmount(x), 0) };
  }).filter((r) => r.q + r.o > 0);

  return (
    <div className="grid2">
      <div>
        <div className="section-title">📞 Quá hạn nhưng sale chưa liên hệ 7 ngày qua ({noContact.length})</div>
        <div className="table-wrap">
          {noContact.length === 0 ? <Empty text="Tốt — khách quá hạn đều đã được liên hệ" /> : (
            <table><thead><tr><th>Khách hàng</th><th>Sale</th><th>Nhóm</th><th className="num">Quá hạn</th></tr></thead>
              <tbody>{noContact.slice(0, 30).map((r) => (
                <tr key={r.k}><td>{r.name}</td><td>{saleOf(r)}</td><td className="small">{bucketName(r.curWorst)}</td><td className="num">{fmtMoney(r.curOver)}</td></tr>
              ))}</tbody></table>
          )}
        </div>
      </div>
      <div>
        <div className="section-title">🚫 Quá hạn lâu nhưng vẫn có báo giá/đơn mới 30 ngày ({stillSelling.length})</div>
        <div className="table-wrap">
          {stillSelling.length === 0 ? <Empty text="Không có" /> : (
            <table><thead><tr><th>Khách hàng</th><th>Sale</th><th className="num">Quá hạn</th><th className="num">BG / Đơn</th><th className="num">Giá trị</th></tr></thead>
              <tbody>{stillSelling.map((r) => (
                <tr key={r.k}><td>{r.name}</td><td>{saleOf(r)}</td><td className="num">{fmtMoney(r.curOver)}</td><td className="num">{r.q} / {r.o}</td><td className="num">{fmtMoney(r.value)}</td></tr>
              ))}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}

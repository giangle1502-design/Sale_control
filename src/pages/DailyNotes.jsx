import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { scopedQuery } from '../lib/data';
import { fmtDate, fmtMoney, fmtTon, num, orderAmount, orderKg, REVENUE_STATUSES, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { CustomFieldInputs, customValue, Empty, ErrorBox, Field, FilterBar, Stat, useRange } from '../components/ui';

export default function DailyNotes() {
  const { isAdmin } = useApp();
  const [tab, setTab] = useState(isAdmin ? 'list' : 'write');
  return (
    <>
      <div className="page-head">
        <h1>Nhật ký / Báo cáo ngày</h1>
        <div className="presets">
          <button className={'chip' + (tab === 'write' ? ' on' : '')} onClick={() => setTab('write')}>Viết báo cáo của tôi</button>
          <button className={'chip' + (tab === 'list' ? ' on' : '')} onClick={() => setTab('list')}>{isAdmin ? 'Báo cáo của nhân viên' : 'Báo cáo đã gửi'}</button>
        </div>
      </div>
      {tab === 'write' ? <WriteNote /> : <NoteList />}
    </>
  );
}

function WriteNote() {
  const { email, profile, config } = useApp();
  const fields = config.customFields.dailyNotes || [];
  const [date, setDate] = useState(today());
  const [f, setF] = useState({ summary: '', issues: '', plan: '', custom: {} });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const id = `${date}_${email}`;

  useEffect(() => {
    setMsg('');
    getDoc(doc(db, 'dailyNotes', id)).then((s) => {
      const d = s.exists() ? s.data() : {};
      setF({ summary: d.summary || '', issues: d.issues || '', plan: d.plan || '', custom: d.custom || {} });
    }).catch((e) => setErr(e.message));
  }, [id]);

  // Tự động tổng hợp số liệu trong ngày từ các mục đã nhập
  const range = { from: date, to: date };
  const scope = { me: email, isAdmin: false, ...range };
  const acts = useQuery(() => scopedQuery('activities', scope), [email, date]);
  const ords = useQuery(() => scopedQuery('orders', scope), [email, date]);
  const pays = useQuery(() => scopedQuery('payments', scope), [email, date]);
  const rev = ords.data.filter((o) => REVENUE_STATUSES.includes(o.status));

  const save = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await setDoc(doc(db, 'dailyNotes', id), {
        ...f, date, ownerEmail: email, ownerName: profile.name, updatedAt: serverTimestamp(),
      }, { merge: true });
      setMsg('Đã lưu báo cáo ngày ' + fmtDate(date));
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <>
      <div className="filters">
        <span>Ngày báo cáo:</span>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="stats">
        <Stat label="Hoạt động KH" value={acts.data.length} sub={summarizeTypes(acts.data)} />
        <Stat label="Đơn chốt" value={rev.length} sub={`${ords.data.filter((o) => o.status === 'Báo giá').length} báo giá`} tone="green" />
        <Stat label="Sản lượng" value={fmtTon(rev.reduce((s, o) => s + orderKg(o), 0)) + ' tấn'} tone="green" />
        <Stat label="Doanh số" value={fmtMoney(rev.reduce((s, o) => s + orderAmount(o), 0))} tone="green" />
        <Stat label="Thu tiền" value={fmtMoney(pays.data.reduce((s, p) => s + num(p.amount), 0))} tone="amber" />
      </div>
      <p className="small">Số liệu trên được tự động lấy từ các mục Hoạt động, Đơn hàng, Thu tiền bạn đã nhập trong ngày. Phần dưới để bổ sung nhận xét.</p>
      <form className="card" onSubmit={save}>
        <div className="form-grid">
          <Field label="Công việc đã làm hôm nay" full>
            <textarea rows={4} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </Field>
          <Field label="Khó khăn / Đề xuất" full>
            <textarea rows={3} value={f.issues} onChange={(e) => setF({ ...f, issues: e.target.value })} />
          </Field>
          <Field label="Kế hoạch ngày mai" full>
            <textarea rows={3} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} />
          </Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        {err && <div className="error-box">{err}</div>}
        {msg && <div className="ok-box">{msg}</div>}
        <div className="form-actions"><button className="btn primary">Lưu báo cáo</button></div>
      </form>
    </>
  );
}

export function summarizeTypes(acts) {
  const m = {};
  acts.forEach((a) => { m[a.type] = (m[a.type] || 0) + 1; });
  return Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

function NoteList() {
  const { email, isAdmin, config, staffList, staffName } = useApp();
  const fields = config.customFields.dailyNotes || [];
  const [range, setRange] = useRange('7 ngày');
  const [staff, setStaff] = useState('');
  const { data, error } = useQuery(
    () => scopedQuery('dailyNotes', { me: email, isAdmin, staffFilter: staff, ...range }),
    [email, isAdmin, staff, range.from, range.to]
  );
  const submittedToday = new Set(data.filter((n) => n.date === today()).map((n) => n.ownerEmail));
  const missing = staffList.filter((s) => s.active !== false && s.role !== 'admin' && !submittedToday.has(s.email));

  const doExport = () => exportSheets(`BaoCaoNgay_${range.from}_${range.to}`, {
    'Báo cáo ngày': data.map((n) => ({
      Ngày: fmtDate(n.date), 'Nhân viên': staffName(n.ownerEmail), 'Đã làm': n.summary, 'Khó khăn/Đề xuất': n.issues, 'Kế hoạch mai': n.plan,
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, n.custom?.[f.key])])),
    })),
  });

  return (
    <>
      <FilterBar range={range} setRange={setRange} staff={staff} setStaff={setStaff}>
        <button className="btn" onClick={doExport}>⬇ Excel</button>
      </FilterBar>
      {isAdmin && range.to >= today() && missing.length > 0 && (
        <div className="error-box">Chưa gửi báo cáo hôm nay: {missing.map((s) => s.name || s.email).join(', ')}</div>
      )}
      <ErrorBox error={error} />
      {data.length === 0 ? <div className="table-wrap"><Empty /></div> : data.map((n) => (
        <div key={n.id} className="card" style={{ marginBottom: 10 }}>
          <div className="row-between"><b>{staffName(n.ownerEmail)}</b><span className="badge blue">{fmtDate(n.date)}</span></div>
          {n.summary && <p><b>Đã làm:</b> {n.summary}</p>}
          {n.issues && <p><b>Khó khăn / Đề xuất:</b> {n.issues}</p>}
          {n.plan && <p><b>Kế hoạch mai:</b> {n.plan}</p>}
          {fields.map((f) => n.custom?.[f.key] !== undefined && n.custom?.[f.key] !== '' && (
            <p key={f.key}><b>{f.label}:</b> {String(customValue(f, n.custom[f.key]))}</p>
          ))}
        </div>
      ))}
    </>
  );
}

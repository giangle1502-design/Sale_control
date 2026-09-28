import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { scopedQuery } from '../lib/data';
import { addDays, fmtDate, fmtMoney, fmtTon, num, orderAmount, orderKg, REVENUE_STATUSES, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { CustomFieldInputs, customValue, Empty, ErrorBox, Field, Stat } from '../components/ui';

// ===== Kỳ báo cáo: tuần (Thứ 2 → Chủ nhật) và tháng =====
const dow = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay(); // 0 = CN
export const weekStart = (ymd) => addDays(ymd, -((dow(ymd) + 6) % 7));
const monthFirst = (ymd) => ymd.slice(0, 8) + '01';
const monthLast = (ymd) => {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const isoWeekNo = (monday) => {
  const thu = new Date(addDays(monday, 3) + 'T00:00:00Z');
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return Math.floor((thu - jan1) / 86400000 / 7) + 1;
};

// Mã kỳ dùng làm khóa lưu (trường "date"). Tháng = ngày 01; tuần = thứ 2 đầu tuần
// (nếu thứ 2 trùng ngày 01 của tháng thì dùng thứ 3 để không đè lên báo cáo tháng).
export function periodOf(type, anyDay) {
  if (type === 'month') {
    const from = monthFirst(anyDay);
    const [y, m] = from.split('-');
    return { type, key: from, from, to: monthLast(from), label: `Tháng ${m}/${y}` };
  }
  const from = weekStart(anyDay);
  const to = addDays(from, 6);
  const key = from.endsWith('-01') ? addDays(from, 1) : from;
  return { type, key, from, to, label: `Tuần ${isoWeekNo(from)} (${fmtDate(from).slice(0, 5)} – ${fmtDate(to)})` };
}

function periodOptions(type) {
  const t = today();
  const list = [];
  if (type === 'month') {
    let d = monthFirst(t);
    for (let i = 0; i < 6; i++) { list.push(periodOf('month', d)); d = monthFirst(addDays(d, -1)); }
  } else {
    let d = weekStart(t);
    for (let i = 0; i < 8; i++) { list.push(periodOf('week', d)); d = addDays(d, -7); }
  }
  return list;
}

// Nhãn kỳ cho một bản ghi (bản ghi cũ theo ngày vẫn hiển thị được)
export const noteLabel = (n) => n.periodLabel || `Ngày ${fmtDate(n.date)}`;
const TYPE_NAME = { week: 'Báo cáo tuần', month: 'Báo cáo tháng' };

export default function DailyNotes() {
  const { isAdmin } = useApp();
  const [tab, setTab] = useState(isAdmin ? 'list' : 'write');
  return (
    <>
      <div className="page-head">
        <h1>Báo cáo tuần / tháng</h1>
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
  const [type, setType] = useState('week');
  const options = useMemo(() => periodOptions(type), [type]);
  const [key, setKey] = useState(options[0].key);
  const period = options.find((p) => p.key === key) || options[0];
  const [f, setF] = useState({ summary: '', issues: '', plan: '', custom: {} });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const id = `${period.key}_${email}`;

  useEffect(() => { setKey(periodOptions(type)[0].key); }, [type]);
  useEffect(() => {
    setMsg(''); setErr('');
    getDoc(doc(db, 'dailyNotes', id)).then((s) => {
      const d = s.exists() && s.data().period === period.type ? s.data() : {};
      setSaved(!!d.period);
      setF({ summary: d.summary || '', issues: d.issues || '', plan: d.plan || '', custom: d.custom || {} });
    }).catch((e) => setErr(e.message));
  }, [id]);

  // Tự động tổng hợp số liệu trong kỳ từ các mục đã nhập
  const scope = { me: email, isAdmin: false, from: period.from, to: period.to };
  const deps = [email, period.from, period.to];
  const acts = useQuery(() => scopedQuery('activities', scope), deps);
  const quos = useQuery(() => scopedQuery('quotes', scope), deps);
  const ords = useQuery(() => scopedQuery('orders', scope), deps);
  const pays = useQuery(() => scopedQuery('payments', scope), deps);
  const rev = ords.data.filter((o) => REVENUE_STATUSES.includes(o.status));
  const unit = type === 'week' ? 'tuần' : 'tháng';

  const save = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await setDoc(doc(db, 'dailyNotes', id), {
        ...f, date: period.key, period: period.type, periodFrom: period.from, periodTo: period.to, periodLabel: period.label,
        submittedDate: today(), ownerEmail: email, ownerName: profile.name, updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaved(true);
      setMsg(`Đã lưu ${TYPE_NAME[period.type].toLowerCase()} – ${period.label}`);
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <>
      <div className="filters">
        <div className="presets">
          <button type="button" className={'chip' + (type === 'week' ? ' on' : '')} onClick={() => setType('week')}>Báo cáo tuần</button>
          <button type="button" className={'chip' + (type === 'month' ? ' on' : '')} onClick={() => setType('month')}>Báo cáo tháng</button>
        </div>
        <select value={period.key} onChange={(e) => setKey(e.target.value)}>
          {options.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {saved && <span className="badge green">Đã nộp – có thể sửa lại</span>}
      </div>
      <div className="stats">
        <Stat label={`Hoạt động KH trong ${unit}`} value={acts.data.length} sub={summarizeTypes(acts.data)} />
        <Stat label="Báo giá" value={quos.data.length} sub={fmtMoney(quos.data.reduce((s, q) => s + orderAmount(q), 0)) + ' đ'} />
        <Stat label="Đơn chốt" value={rev.length} sub={fmtTon(rev.reduce((s, o) => s + orderKg(o), 0)) + ' tấn'} tone="green" />
        <Stat label="Doanh số" value={fmtMoney(rev.reduce((s, o) => s + orderAmount(o), 0))} tone="green" />
        <Stat label="Thu tiền" value={fmtMoney(pays.data.reduce((s, p) => s + num(p.amount), 0))} tone="amber" />
      </div>
      <p className="small">Số liệu trên tự động lấy từ Hoạt động, Báo giá, Đơn hàng, Thu tiền bạn đã nhập từ {fmtDate(period.from)} đến {fmtDate(period.to)}. Phần dưới để bổ sung nhận xét.</p>
      <form className="card" onSubmit={save}>
        <div className="form-grid">
          <Field label={`Công việc đã làm trong ${unit}`} full>
            <textarea rows={5} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </Field>
          <Field label="Khó khăn / Đề xuất" full>
            <textarea rows={3} value={f.issues} onChange={(e) => setF({ ...f, issues: e.target.value })} />
          </Field>
          <Field label={`Kế hoạch ${unit} tới`} full>
            <textarea rows={3} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} />
          </Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        {err && <div className="error-box">{err}</div>}
        {msg && <div className="ok-box">{msg}</div>}
        <div className="form-actions"><button className="btn primary">Lưu {TYPE_NAME[type].toLowerCase()}</button></div>
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
  const [type, setType] = useState('');
  const [staff, setStaff] = useState('');
  const [from, setFrom] = useState(monthFirst(addDays(monthFirst(addDays(monthFirst(today()), -1)), -1)));
  const { data, error } = useQuery(
    () => scopedQuery('dailyNotes', { me: email, isAdmin, staffFilter: staff, from, to: addDays(today(), 7) }),
    [email, isAdmin, staff, from]
  );
  const rows = data
    .filter((n) => !type || n.period === type)
    .sort((a, b) => (b.periodFrom || b.date).localeCompare(a.periodFrom || a.date) || String(staffName(a.ownerEmail) || '').localeCompare(String(staffName(b.ownerEmail) || '')));

  // Nhắc nộp: tuần trước và tháng trước
  const lastWeek = periodOf('week', addDays(weekStart(today()), -7));
  const lastMonth = periodOf('month', addDays(monthFirst(today()), -1));
  const sales = staffList.filter((s) => s.active !== false && s.role !== 'admin');
  const hasNote = (p, e) => data.some((n) => n.ownerEmail === e && n.period === p.type && n.date === p.key);
  const missWeek = from <= lastWeek.key && !staff ? sales.filter((s) => !hasNote(lastWeek, s.email)) : [];
  const missMonth = from <= lastMonth.key && !staff ? sales.filter((s) => !hasNote(lastMonth, s.email)) : [];

  const doExport = () => exportSheets(`BaoCao_Tuan_Thang_${today()}`, {
    'Báo cáo': rows.map((n) => ({
      Loại: TYPE_NAME[n.period] || 'Báo cáo ngày', Kỳ: noteLabel(n), 'Nhân viên': staffName(n.ownerEmail), 'Ngày nộp': fmtDate(n.submittedDate),
      'Đã làm': n.summary, 'Khó khăn/Đề xuất': n.issues, 'Kế hoạch kỳ tới': n.plan,
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, n.custom?.[f.key])])),
    })),
  });

  return (
    <>
      <div className="filters">
        <div className="presets">
          {[['', 'Tất cả'], ['week', 'Báo cáo tuần'], ['month', 'Báo cáo tháng']].map(([k, l]) => (
            <button key={k} className={'chip' + (type === k ? ' on' : '')} onClick={() => setType(k)}>{l}</button>
          ))}
        </div>
        <span>Từ ngày</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value || from)} />
        {isAdmin && (
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {staffList.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </select>
        )}
        <button className="btn" onClick={doExport}>⬇ Excel</button>
      </div>
      {isAdmin && missWeek.length > 0 && (
        <div className="error-box">Chưa nộp báo cáo {lastWeek.label}: {missWeek.map((s) => s.name || s.email).join(', ')}</div>
      )}
      {isAdmin && missMonth.length > 0 && (
        <div className="error-box">Chưa nộp báo cáo {lastMonth.label}: {missMonth.map((s) => s.name || s.email).join(', ')}</div>
      )}
      <ErrorBox error={error} />
      {rows.length === 0 ? <div className="table-wrap"><Empty /></div> : rows.map((n) => (
        <div key={n.id} className="card" style={{ marginBottom: 10 }}>
          <div className="row-between">
            <b>{staffName(n.ownerEmail)}</b>
            <span>
              <span className={'badge ' + (n.period === 'month' ? 'green' : n.period === 'week' ? 'blue' : '')}>{noteLabel(n)}</span>
              {n.submittedDate && <span className="small"> · nộp {fmtDate(n.submittedDate)}</span>}
            </span>
          </div>
          {n.summary && <p><b>Đã làm:</b> {n.summary}</p>}
          {n.issues && <p><b>Khó khăn / Đề xuất:</b> {n.issues}</p>}
          {n.plan && <p><b>Kế hoạch kỳ tới:</b> {n.plan}</p>}
          {fields.map((f) => n.custom?.[f.key] !== undefined && n.custom?.[f.key] !== '' && (
            <p key={f.key}><b>{f.label}:</b> {String(customValue(f, n.custom[f.key]))}</p>
          ))}
        </div>
      ))}
    </>
  );
}

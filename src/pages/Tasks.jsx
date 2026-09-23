import { useMemo, useState } from 'react';
import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { removeDoc, saveDoc, scopedQuery } from '../lib/data';
import { fmtDate, isTaskOverdue, num, PRIORITIES, TASK_STATUSES, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import {
  confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, Modal, Stat,
} from '../components/ui';

const STATUS_TONE = { 'Mới': 'amber', 'Đang làm': 'blue', 'Hoàn thành': 'green', 'Hủy': '' };
const PRIO_TONE = { 'Thấp': '', 'Bình thường': 'blue', 'Cao': 'amber', 'Gấp': 'red' };
const TABS = [['open', 'Đang mở'], ['overdue', 'Quá hạn'], ['done', 'Hoàn thành'], ['all', 'Tất cả']];

export default function Tasks() {
  const { email, isAdmin, profile, config, staffList, staffName } = useApp();
  const [staff, setStaff] = useState('');
  const [tab, setTab] = useState('open');
  const [edit, setEdit] = useState(null);
  const fields = config.customFields.tasks || [];

  const { data, error } = useQuery(
    () => scopedQuery('tasks', { me: email, isAdmin, staffFilter: staff }),
    [email, isAdmin, staff]
  );
  const all = useMemo(() => [...data].sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')), [data]);
  const rows = all.filter((t) =>
    tab === 'open' ? !['Hoàn thành', 'Hủy'].includes(t.status)
      : tab === 'overdue' ? isTaskOverdue(t)
        : tab === 'done' ? t.status === 'Hoàn thành' : true);
  const cnt = {
    open: all.filter((t) => !['Hoàn thành', 'Hủy'].includes(t.status)).length,
    overdue: all.filter((t) => isTaskOverdue(t)).length,
    doneToday: all.filter((t) => t.completedDate === today()).length,
  };

  const blank = () => ({
    title: '', description: '', ownerEmail: isAdmin ? '' : email, dueDate: today(), priority: 'Bình thường',
    status: 'Mới', progress: 0, custom: {}, date: today(),
  });

  const doExport = () => exportSheets(`CongViec_${today()}`, {
    'Công việc': rows.map((t) => ({
      'Công việc': t.title, 'Mô tả': t.description, 'Người thực hiện': staffName(t.ownerEmail), 'Người giao': staffName(t.createdBy),
      'Ngày giao': fmtDate(t.date), 'Hạn': fmtDate(t.dueDate), 'Ưu tiên': t.priority, 'Trạng thái': t.status,
      'Tiến độ %': num(t.progress), 'Ngày hoàn thành': fmtDate(t.completedDate),
      'Trao đổi': (t.comments || []).map((c) => `${c.name}: ${c.text}`).join(' | '),
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, t.custom?.[f.key])])),
    })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Việc được giao</h1>
        <div className="actions">
          <button className="btn" onClick={doExport}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setEdit(blank())}>{isAdmin ? '+ Giao việc' : '+ Thêm việc của tôi'}</button>
        </div>
      </div>
      <div className="filters">
        <div className="presets">
          {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {isAdmin && (
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {staffList.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </select>
        )}
      </div>
      <div className="stats">
        <Stat label="Việc đang mở" value={cnt.open} />
        <Stat label="Quá hạn" value={cnt.overdue} tone="red" />
        <Stat label="Hoàn thành hôm nay" value={cnt.doneToday} tone="green" />
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {rows.length === 0 ? <Empty text="Không có công việc" /> : (
          <table>
            <thead><tr><th>Công việc</th>{isAdmin && <th>Người thực hiện</th>}<th>Hạn</th><th>Ưu tiên</th><th>Trạng thái</th><th>Tiến độ</th>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.title}</b>{t.description && <div className="small">{t.description}</div>}
                    {t.comments?.length > 0 && <div className="small">💬 {t.comments.length} cập nhật · mới nhất: {t.comments[t.comments.length - 1].text}</div>}
                  </td>
                  {isAdmin && <td>{staffName(t.ownerEmail)}</td>}
                  <td className="nowrap">{fmtDate(t.dueDate)} {isTaskOverdue(t) && <span className="badge red">Quá hạn</span>}</td>
                  <td><span className={'badge ' + PRIO_TONE[t.priority]}>{t.priority}</span></td>
                  <td><span className={'badge ' + STATUS_TONE[t.status]}>{t.status}</span></td>
                  <td><div className="progress"><div style={{ width: num(t.progress) + '%' }} /></div><span className="small">{num(t.progress)}%</span></td>
                  {fields.map((f) => <td key={f.key}>{String(customValue(f, t.custom?.[f.key]))}</td>)}
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => setEdit(t)}>Cập nhật</button>{' '}
                    {(isAdmin || t.createdBy === email) && (
                      <button className="btn sm danger" onClick={() => confirmDelete('Xóa công việc này?') && removeDoc('tasks', t.id)}>Xóa</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <TaskForm initial={edit} onClose={() => setEdit(null)} fields={fields} />}
    </>
  );
}

function TaskForm({ initial, onClose, fields }) {
  const { profile, isAdmin, email, staffList, staffName } = useApp();
  const [f, setF] = useState({ ...initial, custom: initial.custom || {} });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Sale chỉ được sửa tiêu đề/hạn với việc tự tạo; việc quản lý giao thì chỉ cập nhật tiến độ
  const canEditMain = isAdmin || !f.id || f.createdBy === email;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { id, createdAt, createdBy, updatedAt, updatedBy, comments, ...rest } = f;
      const progress = rest.status === 'Hoàn thành' ? 100 : num(rest.progress);
      const completedDate = rest.status === 'Hoàn thành' ? (initial.completedDate || today()) : '';
      const data = { ...rest, progress, completedDate, ownerName: staffName(rest.ownerEmail) };
      const newId = await saveDoc('tasks', id, data, profile);
      if (note.trim()) {
        await updateDoc(doc(db, 'tasks', newId), {
          comments: arrayUnion({ by: email, name: profile.name, at: new Date().toISOString(), text: note.trim() }),
        });
      }
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <Modal title={f.id ? 'Cập nhật công việc' : 'Công việc mới'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên công việc" required full>
            <input value={f.title} onChange={set('title')} required disabled={!canEditMain} />
          </Field>
          <Field label="Mô tả" full><textarea rows={2} value={f.description} onChange={set('description')} disabled={!canEditMain} /></Field>
          <Field label="Người thực hiện" required>
            {isAdmin ? (
              <select value={f.ownerEmail} onChange={set('ownerEmail')} required>
                <option value="">-- Chọn nhân viên --</option>
                {staffList.filter((s) => s.active !== false).map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
              </select>
            ) : <input value={staffName(f.ownerEmail)} disabled />}
          </Field>
          <Field label="Hạn hoàn thành"><input type="date" value={f.dueDate} onChange={set('dueDate')} disabled={!canEditMain} /></Field>
          <Field label="Ưu tiên">
            <select value={f.priority} onChange={set('priority')} disabled={!canEditMain}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label="Trạng thái">
            <select value={f.status} onChange={set('status')}>{TASK_STATUSES.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label={`Tiến độ: ${num(f.progress)}%`} full>
            <input type="range" min="0" max="100" step="10" value={num(f.progress)} onChange={set('progress')} />
          </Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
          <Field label="Ghi chú cập nhật / báo cáo tiến độ" full>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Đã gửi mẫu, chờ khách test…" />
          </Field>
        </div>
        {f.comments?.length > 0 && (
          <div className="comments">
            {[...f.comments].reverse().map((c, i) => (
              <div key={i} className="comment"><b>{c.name}</b> <span className="small">{new Date(c.at).toLocaleString('vi-VN')}</span><div>{c.text}</div></div>
            ))}
          </div>
        )}
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Đóng</button>
          <button className="btn primary" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

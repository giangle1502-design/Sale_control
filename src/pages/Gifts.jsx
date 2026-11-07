import { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { removeDoc, saveDoc, scopedQuery } from '../lib/data';
import { fmtDate, norm, today } from '../lib/utils';
import { exportSheets } from '../lib/excel';
import { useCustomers } from '../components/CustomerPicker';
import { confirmDelete, Empty, ErrorBox, Field, Modal, Stat } from '../components/ui';

export const GIFT_STATUSES = ['Chưa tặng', 'Đã tặng', 'Hủy'];
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '–');
const isOverdue = (g, ref = today()) => g.status === 'Chưa tặng' && g.planDate && g.planDate < ref;

function statusBadge(g) {
  if (g.status === 'Đã tặng') return <span className="badge green">Đã tặng</span>;
  if (g.status === 'Hủy') return <span className="badge">Hủy</span>;
  if (isOverdue(g)) return <span className="badge red">Chưa tặng · quá hạn</span>;
  return <span className="badge amber">Chưa tặng</span>;
}

export default function Gifts() {
  const { email, isAdmin, profile, staffList, staffName } = useApp();
  const [tab, setTab] = useState('list');
  const [staff, setStaff] = useState('');
  const [campaign, setCampaign] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState(null);
  const [doneFor, setDoneFor] = useState(null); // danh sách bản ghi cần đánh dấu đã tặng
  const [picked, setPicked] = useState(() => new Set());
  const [showHelp, setShowHelp] = useState(() => typeof window === 'undefined' || window.innerWidth > 1100);

  const { data, error } = useQuery(
    () => scopedQuery('gifts', { me: email, isAdmin, staffFilter: staff }),
    [email, isAdmin, staff]
  );

  const campaigns = useMemo(() => [...new Set(data.map((g) => g.campaign).filter(Boolean))].sort(), [data]);
  const scoped = useMemo(() => data.filter((g) => !campaign || g.campaign === campaign), [data, campaign]);
  const rows = useMemo(() => {
    const k = norm(q);
    return scoped
      .filter((g) => !status || (status === 'Quá hạn' ? isOverdue(g) : g.status === status))
      .filter((g) => !k || norm(`${g.customerCode} ${g.customerName} ${g.giftName} ${g.note}`).includes(k))
      .sort((a, b) => (a.status === 'Đã tặng') - (b.status === 'Đã tặng')
        || String(a.planDate || '9').localeCompare(String(b.planDate || '9'))
        || String(a.customerName).localeCompare(String(b.customerName)));
  }, [scoped, status, q]);

  const active = scoped.filter((g) => g.status !== 'Hủy');
  const total = active.length;
  const given = active.filter((g) => g.status === 'Đã tặng').length;
  const notGiven = total - given;
  const overdue = active.filter((g) => isOverdue(g)).length;

  const byStaff = useMemo(() => {
    const m = new Map();
    active.forEach((g) => {
      const key = g.ownerEmail || '';
      if (!m.has(key)) m.set(key, { email: key, total: 0, given: 0, notGiven: 0, overdue: 0, items: [] });
      const s = m.get(key);
      s.total++; s.items.push(g);
      if (g.status === 'Đã tặng') s.given++; else s.notGiven++;
      if (isOverdue(g)) s.overdue++;
    });
    return [...m.values()].map((s) => ({ ...s, name: staffName(s.email) || s.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [active, staffName]);

  const canEdit = (g) => isAdmin || g.ownerEmail === email;
  const visibleIds = rows.filter(canEdit).map((g) => g.id);
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const togglePick = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(visibleIds));
  const pickedRows = data.filter((g) => picked.has(g.id));
  const pickedOpen = pickedRows.filter((g) => g.status === 'Chưa tặng');
  const [deleting, setDeleting] = useState(false);
  const bulkDelete = async () => {
    const given = pickedRows.filter((g) => g.status === 'Đã tặng').length;
    if (!window.confirm(`Xóa ${pickedRows.length} khách khỏi danh sách tặng quà?${given ? `\n(Trong đó ${given} khách đã tặng — xóa sẽ mất lịch sử đã tặng.)` : ''}\nKhông khôi phục được.`)) return;
    setDeleting(true);
    try {
      for (let i = 0; i < pickedRows.length; i += 400) {
        const b = writeBatch(db);
        pickedRows.slice(i, i + 400).forEach((g) => b.delete(doc(db, 'gifts', g.id)));
        await b.commit();
      }
      setPicked(new Set());
    } catch (e) { window.alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  const undo = async (g) => {
    if (!window.confirm(`Chuyển "${g.customerName}" về Chưa tặng?`)) return;
    await saveDoc('gifts', g.id, { status: 'Chưa tặng', giftDate: '' }, profile);
  };

  const doExport = () => {
    const line = (g) => ({
      'Nhân viên': staffName(g.ownerEmail), 'Đợt / Dịp': g.campaign || '', 'Mã KH': g.customerCode || '', 'Tên khách hàng': g.customerName,
      'Quà tặng': g.giftName || '', 'Ngày tặng dự kiến': fmtDate(g.planDate), 'Ngày tặng khách': fmtDate(g.giftDate),
      'Tình trạng': isOverdue(g) ? 'Chưa tặng (quá hạn)' : g.status, 'Ghi chú': g.note || '',
    });
    exportSheets(`QuaTang_${campaign || 'TatCa'}_${today()}`, {
      'Danh sách': rows.map(line),
      'Theo nhân viên': [
        ...byStaff.map((s) => ({ 'Nhân viên': s.name, 'Cần tặng': s.total, 'Đã tặng': s.given, 'Chưa tặng': s.notGiven, 'Quá hạn': s.overdue, 'Hoàn thành': pct(s.given, s.total) })),
        { 'Nhân viên': 'TỔNG', 'Cần tặng': total, 'Đã tặng': given, 'Chưa tặng': notGiven, 'Quá hạn': overdue, 'Hoàn thành': pct(given, total) },
      ],
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>🎁 Quà tặng khách hàng</h1>
        <div className="actions">
          <button className="btn" onClick={() => setShowHelp((v) => !v)}>{showHelp ? 'Ẩn hướng dẫn' : '❔ Hướng dẫn'}</button>
          <button className="btn" onClick={doExport}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setCreating(true)}>+ Tạo danh sách tặng quà</button>
        </div>
      </div>

      <div className={'gift-layout' + (showHelp ? '' : ' no-help')}>
        <div className="gift-main">
          <div className="stats">
            <Stat label="Tổng khách cần tặng" value={fmtInt(total)} onClick={() => setStatus('')} active={!status} />
            <Stat label="Đã tặng" value={fmtInt(given)} sub={`Hoàn thành ${pct(given, total)}`} tone="green" onClick={() => setStatus('Đã tặng')} active={status === 'Đã tặng'} />
            <Stat label="Chưa tặng" value={fmtInt(notGiven)} tone="amber" onClick={() => setStatus('Chưa tặng')} active={status === 'Chưa tặng'} />
            <Stat label="Quá ngày dự kiến" value={fmtInt(overdue)} sub="Chưa tặng, đã qua ngày dự kiến" tone="red" onClick={() => setStatus('Quá hạn')} active={status === 'Quá hạn'} />
          </div>
          {total > 0 && <div className="progress gift-progress"><div style={{ width: pct(given, total) }} /></div>}

          <div className="gift-tabs">
            <button className={'chip' + (tab === 'list' ? ' on' : '')} onClick={() => setTab('list')}>📋 Danh sách tặng quà</button>
            <button className={'chip' + (tab === 'report' ? ' on' : '')} onClick={() => setTab('report')}>📊 Báo cáo theo nhân viên</button>
          </div>

          <div className="filters">
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">Tất cả đợt / dịp</option>
              {campaigns.map((c) => <option key={c}>{c}</option>)}
            </select>
            {isAdmin && (
              <select value={staff} onChange={(e) => { setStaff(e.target.value); setPicked(new Set()); }}>
                <option value="">Tất cả nhân viên</option>
                {staffList.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
              </select>
            )}
            {tab === 'list' && <>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tất cả tình trạng</option>
                {GIFT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                <option value="Quá hạn">Quá hạn</option>
              </select>
              <input placeholder="Tìm mã / tên khách…" value={q} onChange={(e) => setQ(e.target.value)} />
            </>}
          </div>
          <ErrorBox error={error} />

          {tab === 'list' ? <>
            {picked.size > 0 && (
              <div className="gift-bulk">
                Đã chọn <b>{picked.size}</b> khách
                {pickedOpen.length > 0 && <button className="btn primary sm" onClick={() => setDoneFor(pickedOpen)}>✓ Đánh dấu đã tặng ({pickedOpen.length})</button>}
                <button className="btn danger sm" disabled={deleting} onClick={bulkDelete}>🗑 Xóa {pickedRows.length} khách đã chọn</button>
                <button className="btn sm" onClick={() => setPicked(new Set())}>Bỏ chọn</button>
              </div>
            )}
            <div className="table-wrap">
              {rows.length === 0 ? <Empty text={data.length ? 'Không có khách nào khớp bộ lọc' : 'Chưa có danh sách tặng quà. Bấm "+ Tạo danh sách tặng quà" để bắt đầu.'} /> : (
                <table>
                  <thead><tr>
                    <th><input type="checkbox" checked={allPicked} onChange={toggleAll} title="Chọn tất cả khách đang hiển thị" /></th>
                    {isAdmin && <th>Nhân viên</th>}
                    <th>Mã KH</th><th>Tên khách hàng</th><th>Đợt / Quà</th><th>Ngày tặng dự kiến</th><th>Ngày tặng khách</th><th>Tình trạng</th><th></th>
                  </tr></thead>
                  <tbody>
                    {rows.map((g) => (
                      <tr key={g.id} className={g.status === 'Hủy' ? 'muted' : ''}>
                        <td>{canEdit(g) && <input type="checkbox" checked={picked.has(g.id)} onChange={() => togglePick(g.id)} />}</td>
                        {isAdmin && <td>{staffName(g.ownerEmail)}</td>}
                        <td className="nowrap">{g.customerCode}</td>
                        <td>{g.customerName}{g.note && <div className="small">{g.note}</div>}</td>
                        <td>{g.campaign}{g.giftName && <div className="small">🎁 {g.giftName}</div>}</td>
                        <td className="nowrap">{fmtDate(g.planDate)}</td>
                        <td className="nowrap">{fmtDate(g.giftDate)}</td>
                        <td>{statusBadge(g)}</td>
                        <td className="nowrap">
                          {canEdit(g) && <>
                            {g.status === 'Chưa tặng' && <button className="btn sm primary" onClick={() => setDoneFor([g])}>✓ Đã tặng</button>}
                            {g.status === 'Đã tặng' && <button className="btn sm" onClick={() => undo(g)}>Hoàn tác</button>}{' '}
                            <button className="btn sm" onClick={() => setEdit(g)}>Sửa</button>{' '}
                            <button className="btn sm danger" onClick={() => confirmDelete(`Xóa "${g.customerName}" khỏi danh sách tặng quà?`) && removeDoc('gifts', g.id)}>Xóa</button>
                          </>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </> : (
            <StaffReport byStaff={byStaff} total={total} given={given} notGiven={notGiven} overdue={overdue}
              onOpen={(e) => { if (isAdmin) setStaff(e); setStatus(''); setTab('list'); }} isAdmin={isAdmin} />
          )}
        </div>

        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      </div>

      {creating && <CreateListModal onClose={() => setCreating(false)} existing={data} campaigns={campaigns} />}
      {edit && <EditGiftModal initial={edit} onClose={() => setEdit(null)} campaigns={campaigns} />}
      {doneFor && <MarkDoneModal items={doneFor} onClose={(ok) => { setDoneFor(null); if (ok) setPicked(new Set()); }} />}
    </>
  );
}

function StaffReport({ byStaff, total, given, notGiven, overdue, onOpen, isAdmin }) {
  const [openRow, setOpenRow] = useState('');
  if (!byStaff.length) return <div className="table-wrap"><Empty /></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>Nhân viên</th><th className="num">Cần tặng</th><th className="num">Đã tặng</th><th className="num">Chưa tặng</th><th className="num">Quá hạn</th><th>Hoàn thành</th><th></th>
        </tr></thead>
        <tbody>
          {byStaff.map((s) => (
            <StaffRows key={s.email} s={s} open={openRow === s.email} onToggle={() => setOpenRow(openRow === s.email ? '' : s.email)}
              onOpen={() => onOpen(s.email)} isAdmin={isAdmin} />
          ))}
        </tbody>
        <tfoot><tr>
          <td>Tổng cộng</td><td className="num">{fmtInt(total)}</td><td className="num">{fmtInt(given)}</td><td className="num">{fmtInt(notGiven)}</td>
          <td className="num">{fmtInt(overdue)}</td><td>{pct(given, total)}</td><td></td>
        </tr></tfoot>
      </table>
    </div>
  );
}

function StaffRows({ s, open, onToggle, onOpen, isAdmin }) {
  const items = [...s.items].sort((a, b) => (a.status === 'Đã tặng') - (b.status === 'Đã tặng') || String(a.customerName).localeCompare(String(b.customerName)));
  return <>
    <tr>
      <td><a onClick={onToggle}>{open ? '▾' : '▸'} {s.name}</a></td>
      <td className="num">{fmtInt(s.total)}</td>
      <td className="num" style={{ color: 'var(--green)' }}>{fmtInt(s.given)}</td>
      <td className="num" style={{ color: 'var(--amber)' }}>{fmtInt(s.notGiven)}</td>
      <td className="num" style={{ color: s.overdue ? 'var(--red)' : undefined }}>{fmtInt(s.overdue)}</td>
      <td><div className="gift-bar"><div className="progress"><div style={{ width: pct(s.given, s.total) }} /></div><span>{pct(s.given, s.total)}</span></div></td>
      <td className="nowrap"><button className="btn sm" onClick={onToggle}>{open ? 'Ẩn' : 'Xem khách'}</button>{isAdmin && <>{' '}<button className="btn sm" onClick={onOpen}>Mở danh sách</button></>}</td>
    </tr>
    {open && (
      <tr className="gift-sub"><td colSpan={7}>
        <table>
          <thead><tr><th>Mã KH</th><th>Tên khách hàng</th><th>Đợt / Quà</th><th>Dự kiến</th><th>Ngày tặng</th><th>Tình trạng</th></tr></thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id}>
                <td className="nowrap">{g.customerCode}</td><td>{g.customerName}</td>
                <td>{g.campaign}{g.giftName && <span className="small"> · {g.giftName}</span>}</td>
                <td className="nowrap">{fmtDate(g.planDate)}</td><td className="nowrap">{fmtDate(g.giftDate)}</td><td>{statusBadge(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td></tr>
    )}
  </>;
}

// Chọn khách từ bảng khách hàng do sale phụ trách → tạo danh sách tặng quà
function CreateListModal({ onClose, existing, campaigns }) {
  const { email, isAdmin, profile, staffList, staffName } = useApp();
  const [owner, setOwner] = useState(isAdmin ? '' : email);
  const { data: customers, loading } = useCustomers(owner);
  const [campaign, setCampaign] = useState(campaigns[campaigns.length - 1] || `Tết ${new Date().getFullYear() + 1}`);
  const [planDate, setPlanDate] = useState('');
  const [giftName, setGiftName] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const already = useMemo(() => new Set(existing.filter((g) => (g.campaign || '') === campaign.trim() && g.status !== 'Hủy').map((g) => g.customerId)), [existing, campaign]);
  const list = useMemo(() => {
    const k = norm(q);
    return [...customers]
      .filter((c) => !type || c.customerType === type)
      .filter((c) => !k || norm(`${c.code} ${c.name} ${c.taxCode || ''}`).includes(k))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [customers, q, type]);
  const selectable = list.filter((c) => !already.has(c.id));
  const allOn = selectable.length > 0 && selectable.every((c) => sel.has(c.id));
  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel((p) => { const n = new Set(p); selectable.forEach((c) => (allOn ? n.delete(c.id) : n.add(c.id))); return n; });

  const submit = async () => {
    if (!campaign.trim()) return setErr('Nhập tên đợt / dịp tặng quà (VD: Tết 2027).');
    if (!planDate) return setErr('Chọn ngày tặng dự kiến.');
    const chosen = customers.filter((c) => sel.has(c.id) && !already.has(c.id));
    if (!chosen.length) return setErr('Chưa chọn khách hàng nào.');
    setBusy(true); setErr('');
    try {
      for (let i = 0; i < chosen.length; i += 400) {
        const b = writeBatch(db);
        chosen.slice(i, i + 400).forEach((c) => {
          const ownerEmail = c.ownerEmail || email;
          b.set(doc(collection(db, 'gifts')), {
            ownerEmail, ownerName: staffName(ownerEmail) || ownerEmail,
            customerId: c.id, customerCode: c.code || '', customerName: c.name || '',
            campaign: campaign.trim(), giftName: giftName.trim(), planDate, giftDate: '', status: 'Chưa tặng', note: '',
            createdAt: serverTimestamp(), createdBy: profile.email, updatedAt: serverTimestamp(), updatedBy: profile.email,
          });
        });
        await b.commit();
      }
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal title="Tạo danh sách tặng quà" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Đợt / Dịp tặng quà" required>
          <input list="gift-campaigns" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="VD: Tết 2027, Trung thu 2026" />
          <datalist id="gift-campaigns">{campaigns.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Ngày tặng dự kiến" required><input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} /></Field>
        <Field label="Quà tặng (không bắt buộc)"><input value={giftName} onChange={(e) => setGiftName(e.target.value)} placeholder="VD: Giỏ quà Tết, Lịch + rượu…" /></Field>
        {isAdmin && (
          <Field label="Khách của nhân viên">
            <select value={owner} onChange={(e) => { setOwner(e.target.value); setSel(new Set()); }}>
              <option value="">Tất cả nhân viên</option>
              {staffList.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="filters" style={{ marginTop: 10 }}>
        <input placeholder="Tìm mã / tên / MST…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tất cả khách</option>
          <option>Khách cũ</option><option>Khách mới</option>
        </select>
        <span className="small">Đã chọn <b>{sel.size}</b> / {customers.length} khách</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
        {loading ? <div className="empty">Đang tải khách hàng…</div> : list.length === 0 ? <Empty text="Không có khách hàng" /> : (
          <table>
            <thead><tr>
              <th><input type="checkbox" checked={allOn} onChange={toggleAll} title="Chọn tất cả (đang lọc)" /></th>
              <th>Mã KH</th><th>Tên khách hàng</th><th>Loại</th>{isAdmin && <th>Sale phụ trách</th>}<th></th>
            </tr></thead>
            <tbody>
              {list.map((c) => {
                const has = already.has(c.id);
                return (
                  <tr key={c.id} onClick={() => !has && toggle(c.id)} style={{ cursor: has ? 'default' : 'pointer' }} className={has ? 'muted' : ''}>
                    <td><input type="checkbox" disabled={has} checked={has || sel.has(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="nowrap">{c.code}</td><td>{c.name}</td><td>{c.customerType}</td>
                    {isAdmin && <td>{staffName(c.ownerEmail)}</td>}
                    <td>{has && <span className="badge blue">Đã có trong đợt này</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn primary" disabled={busy || !sel.size} onClick={submit}>{busy ? 'Đang tạo…' : `Tạo danh sách (${fmtInt(sel.size)} khách)`}</button>
      </div>
    </Modal>
  );
}

function MarkDoneModal({ items, onClose }) {
  const { profile } = useApp();
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      for (let i = 0; i < items.length; i += 400) {
        const b = writeBatch(db);
        items.slice(i, i + 400).forEach((g) => b.update(doc(db, 'gifts', g.id), {
          status: 'Đã tặng', giftDate: date, ...(note.trim() ? { note: note.trim() } : {}),
          updatedAt: serverTimestamp(), updatedBy: profile.email,
        }));
        await b.commit();
      }
      onClose(true);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Modal title={items.length === 1 ? `Hoàn thành tặng quà · ${items[0].customerName}` : `Hoàn thành tặng quà · ${items.length} khách`} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Ngày tặng khách" required><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Ghi chú (không bắt buộc)" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Giao tận tay chị Lan – phòng mua hàng" /></Field>
        </div>
        {items.length > 1 && <div className="small" style={{ marginTop: 8 }}>{items.map((g) => g.customerName).join(', ')}</div>}
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => onClose(false)}>Hủy</button>
          <button className="btn primary" disabled={busy}>✓ Xác nhận đã tặng</button>
        </div>
      </form>
    </Modal>
  );
}

function EditGiftModal({ initial, onClose, campaigns }) {
  const { profile } = useApp();
  const [f, setF] = useState({ campaign: '', giftName: '', planDate: '', giftDate: '', status: 'Chưa tặng', note: '', ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.status === 'Đã tặng' && !f.giftDate) return setErr('Đã tặng thì cần nhập ngày tặng khách.');
    setBusy(true); setErr('');
    try {
      await saveDoc('gifts', f.id, {
        campaign: f.campaign.trim(), giftName: f.giftName.trim(), planDate: f.planDate,
        giftDate: f.status === 'Đã tặng' ? f.giftDate : '', status: f.status, note: f.note.trim(),
      }, profile);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Modal title={`Sửa · ${f.customerCode ? f.customerCode + ' – ' : ''}${f.customerName}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Đợt / Dịp" required>
            <input list="gift-campaigns-e" value={f.campaign} onChange={set('campaign')} required />
            <datalist id="gift-campaigns-e">{campaigns.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Quà tặng"><input value={f.giftName} onChange={set('giftName')} /></Field>
          <Field label="Ngày tặng dự kiến" required><input type="date" value={f.planDate} onChange={set('planDate')} required /></Field>
          <Field label="Tình trạng">
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, giftDate: e.target.value === 'Đã tặng' ? (f.giftDate || today()) : f.giftDate })}>
              {GIFT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          {f.status === 'Đã tặng' && <Field label="Ngày tặng khách" required><input type="date" value={f.giftDate} onChange={set('giftDate')} required /></Field>}
          <Field label="Ghi chú" full><textarea rows={2} value={f.note} onChange={set('note')} /></Field>
        </div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

function HelpPanel({ onClose }) {
  return (
    <aside className="gift-help card">
      <div className="row-between"><b>📘 Hướng dẫn sử dụng</b><button className="btn ghost sm" onClick={onClose}>✕</button></div>

      <h4>1. Tạo danh sách tặng quà</h4>
      <ol>
        <li>Bấm <b>+ Tạo danh sách tặng quà</b>.</li>
        <li>Nhập <b>Đợt / Dịp</b> (VD: <i>Tết 2027</i>) và <b>Ngày tặng dự kiến</b>. Quà tặng có thể để trống.</li>
        <li>Bảng bên dưới là <b>khách hàng do bạn phụ trách</b>. Gõ tìm hoặc lọc Khách cũ / Khách mới, rồi tích chọn từng khách hoặc ô trên cùng để chọn tất cả.</li>
        <li>Bấm <b>Tạo danh sách</b>. Khách đã có trong cùng đợt sẽ hiện "Đã có trong đợt này" và không bị tạo trùng.</li>
      </ol>

      <h4>2. Hoàn thành tặng quà</h4>
      <ol>
        <li>Ở dòng khách, bấm <b>✓ Đã tặng</b>.</li>
        <li>Chọn <b>Ngày tặng khách</b> (mặc định hôm nay), thêm ghi chú nếu cần, rồi bấm <b>Xác nhận</b>.</li>
        <li>Tặng nhiều khách cùng ngày: tích chọn các dòng ở cột đầu → bấm <b>✓ Đánh dấu đã tặng</b> trên đầu bảng.</li>
        <li>Xóa nhiều khách khỏi danh sách: tích chọn (hoặc ô trên cùng để chọn tất cả theo bộ lọc) → bấm <b>🗑 Xóa</b>.</li>
        <li>Bấm nhầm thì bấm <b>Hoàn tác</b> để trả về Chưa tặng.</li>
      </ol>

      <h4>3. Tình trạng</h4>
      <p><span className="badge amber">Chưa tặng</span> chưa giao quà · <span className="badge red">quá hạn</span> đã qua ngày dự kiến mà chưa tặng · <span className="badge green">Đã tặng</span> đã giao · <span className="badge">Hủy</span> không tặng nữa (không tính vào báo cáo; đổi ở nút <b>Sửa</b>).</p>

      <h4>4. Báo cáo</h4>
      <p>Ô số liệu phía trên cho biết tổng khách cần tặng, đã tặng, chưa tặng, quá hạn — bấm vào ô để lọc nhanh. Tab <b>Báo cáo theo nhân viên</b> cho số đã/chưa tặng của từng sale; bấm tên để xem danh sách khách. Nút <b>⬇ Excel</b> xuất cả danh sách và báo cáo.</p>
    </aside>
  );
}

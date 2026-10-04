import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { fmtDate, fmtMoney, fmtNum, norm } from '../lib/utils';
import { useCustomers } from '../components/CustomerPicker';
import { useProducts } from './Products';
import { Empty, Modal } from '../components/ui';

// ============================================================================
// Trò chuyện: nhóm "Toàn công ty", nhóm tự tạo, chat riêng 1-1.
//  chats/{id} = { type: 'all'|'group'|'dm', name, members[], createdBy, lastMsg{text,by,byName,at}, updatedAt }
//  chats/{id}/messages/{id} = { text, by, byName, at, refs:[{k:'c'|'p', id, label}] }
//  chatReads/{email} = { [chatId]: thời điểm đọc (ms) }
// ============================================================================

const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : 0);
const hhmm = (t) => { const d = new Date(ms(t) || Date.now()); return d.toTimeString().slice(0, 5); };
const dayKey = (t) => { const d = new Date(ms(t) || Date.now()); return d.toISOString().slice(0, 10); };
export const dmId = (a, b) => 'dm_' + [a, b].sort().join('__').replace(/[^a-z0-9_@.-]/gi, '-');

// Danh sách chat của tôi (realtime) + số chat có tin chưa đọc
export function useMyChats() {
  const { email, isAdmin } = useApp();
  const [mine, setMine] = useState([]);
  const [all, setAll] = useState(null);
  const [reads, setReads] = useState({});
  useEffect(() => {
    if (!email) return undefined;
    const u1 = onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', email)),
      (s) => setMine(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setMine([]));
    const u2 = onSnapshot(doc(db, 'chats', 'all'), (s) => setAll(s.exists() ? { id: 'all', ...s.data() } : false), () => setAll(false));
    const u3 = onSnapshot(doc(db, 'chatReads', email), (s) => setReads(s.exists() ? s.data() : {}), () => {});
    return () => { u1(); u2(); u3(); };
  }, [email, isAdmin]);
  const chats = useMemo(() => [...(all ? [all] : []), ...mine.filter((c) => c.id !== 'all')]
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)), [mine, all]);
  const isUnread = (c) => c.lastMsg && c.lastMsg.by !== email && ms(c.lastMsg.at) > (reads[c.id] || 0);
  return { chats, reads, isUnread, unread: chats.filter(isUnread).length, allMissing: all === false };
}

// Gọi trong Layout: số đỏ trên menu + thông báo trình duyệt khi có tin mới
export function useChatAlerts() {
  const { email, staffName } = useApp();
  const { chats, isUnread, unread } = useMyChats();
  const seen = useRef(null);
  useEffect(() => {
    const cur = Object.fromEntries(chats.map((c) => [c.id, ms(c.lastMsg?.at)]));
    if (seen.current) {
      chats.forEach((c) => {
        const at = ms(c.lastMsg?.at);
        if (!at || at <= (seen.current[c.id] || 0) || c.lastMsg.by === email) return;
        const viewing = !document.hidden && window.location.pathname.startsWith('/tro-chuyen') && window.__openChat === c.id;
        if (viewing || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        try {
          const title = c.type === 'dm' ? (c.lastMsg.byName || staffName(c.lastMsg.by)) : `${c.name} · ${c.lastMsg.byName || staffName(c.lastMsg.by)}`;
          const n = new Notification(title, { body: c.lastMsg.text, tag: 'chat-' + c.id });
          n.onclick = () => { window.focus(); window.location.href = '/tro-chuyen?c=' + encodeURIComponent(c.id); };
        } catch (e) { /* trình duyệt không hỗ trợ */ }
      });
    }
    seen.current = cur;
  }, [chats]);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [unread]);
  return { unread, isUnread };
}

export default function Chat() {
  const { email, profile, isAdmin, staffName, staffList } = useApp();
  const { chats, isUnread, allMissing } = useMyChats();
  const [openId, setOpenId] = useState(() => new URLSearchParams(window.location.search).get('c') || 'all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [dmPick, setDmPick] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  // Tạo nhóm "Toàn công ty" lần đầu
  useEffect(() => {
    if (allMissing) setDoc(doc(db, 'chats', 'all'), { type: 'all', name: 'Toàn công ty', members: [], createdBy: email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(() => {});
  }, [allMissing]);
  useEffect(() => { window.__openChat = openId; return () => { window.__openChat = ''; }; }, [openId]);

  const nameOf = (c) => (c.type === 'dm' ? staffName(c.members.find((m) => m !== email) || email) : c.name);
  const s = norm(search);
  const list = chats.filter((c) => !s || norm(nameOf(c)).includes(s));
  const cur = chats.find((c) => c.id === openId);

  const openDm = async (other) => {
    const id = dmId(email, other);
    const ref = doc(db, 'chats', id);
    const ex = await getDoc(ref).catch(() => null);
    if (!ex?.exists()) await setDoc(ref, { type: 'dm', name: '', members: [email, other], createdBy: email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    setDmPick(false); setOpenId(id); setMobileList(false);
  };

  return (
    <div className={'chat-page' + (mobileList ? ' show-list' : ' show-room')}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <b>💬 Trò chuyện</b>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={() => setDmPick(true)} title="Nhắn riêng cho 1 người">+ Chat riêng</button>
            <button className="btn sm primary" onClick={() => setCreating(true)}>+ Nhóm</button>
          </div>
        </div>
        <input placeholder="Tìm nhóm / người…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {perm === 'default' && (
          <button className="btn sm" style={{ width: '100%', margin: '6px 0' }} onClick={() => Notification.requestPermission().then(setPerm)}>🔔 Bật thông báo tin nhắn mới</button>
        )}
        <div className="chat-items">
          {list.map((c) => (
            <div key={c.id} className={'chat-item' + (c.id === openId ? ' on' : '') + (isUnread(c) ? ' unread' : '')}
              onClick={() => { setOpenId(c.id); setMobileList(false); }}>
              <div className="chat-avatar">{c.type === 'all' ? '🏢' : c.type === 'dm' ? (nameOf(c) || '?').slice(0, 1) : '👥'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="chat-item-top"><b className="ellipsis">{nameOf(c)}</b><span className="small">{c.lastMsg?.at ? (dayKey(c.lastMsg.at) === dayKey(Date.now()) ? hhmm(c.lastMsg.at) : fmtDate(dayKey(c.lastMsg.at)).slice(0, 5)) : ''}</span></div>
                <div className="small ellipsis">{c.lastMsg ? `${c.lastMsg.by === email ? 'Bạn' : (c.lastMsg.byName || staffName(c.lastMsg.by))}: ${c.lastMsg.text}` : c.type === 'group' ? `${c.members.length} thành viên` : 'Chưa có tin nhắn'}</div>
              </div>
              {isUnread(c) && <span className="chat-dot" />}
            </div>
          ))}
          {!list.length && <Empty text="Chưa có cuộc trò chuyện" />}
        </div>
      </aside>
      <section className="chat-room">
        {cur ? <Room key={cur.id} chat={cur} title={nameOf(cur)} onBack={() => setMobileList(true)} onLeft={() => setOpenId('all')} />
          : <Empty text="Chọn một cuộc trò chuyện" />}
      </section>
      {creating && <GroupForm onClose={() => setCreating(false)} onCreated={(id) => { setOpenId(id); setMobileList(false); }} />}
      {dmPick && (
        <Modal title="Chat riêng với…" onClose={() => setDmPick(false)}>
          <div className="chat-pick">
            {staffList.filter((x) => x.email !== email && x.active !== false).map((x) => (
              <div key={x.email} className="chat-item" onClick={() => openDm(x.email)}>
                <div className="chat-avatar">{(x.name || x.email).slice(0, 1)}</div>
                <div><b>{x.name || x.email}</b><div className="small">{x.email}</div></div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// Một phòng chat --------------------------------------------------------------
function Room({ chat, title, onBack, onLeft }) {
  const { email, profile, isAdmin, staffName } = useApp();
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [refs, setRefs] = useState([]);
  const [tag, setTag] = useState(null); // { q, start }
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [view, setView] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const custs = useCustomers('').data;
  const prods = useProducts().data;

  useEffect(() => onSnapshot(query(collection(db, 'chats', chat.id, 'messages'), orderBy('at', 'desc'), limit(300)),
    (s) => { setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() })).reverse()); setErr(''); },
    (e) => setErr(e.message)), [chat.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  // Đánh dấu đã đọc
  useEffect(() => {
    setDoc(doc(db, 'chatReads', email), { [chat.id]: Date.now() }, { merge: true }).catch(() => {});
  }, [chat.id, msgs.length, email]);

  // Gợi ý khi gõ #
  const suggestions = useMemo(() => {
    if (!tag) return [];
    const q = norm(tag.q);
    const c = custs.filter((x) => !q || norm(x.name).includes(q) || norm(x.code).includes(q)).slice(0, 6)
      .map((x) => ({ k: 'c', id: x.id, label: x.name, sub: x.code || 'Khách hàng' }));
    const p = prods.filter((x) => !q || norm(x.code).includes(q) || norm(x.name).includes(q)).slice(0, 6)
      .map((x) => ({ k: 'p', id: x.id || String(x.code), label: String(x.code), sub: x.name || 'Mã hàng' }));
    return [...p, ...c];
  }, [tag, custs, prods]);

  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const pos = e.target.selectionStart;
    const m = v.slice(0, pos).match(/(^|\s)#([^\s#]{0,30})$/);
    setTag(m ? { q: m[2], start: pos - m[2].length - 1 } : null);
  };
  const pick = (sug) => {
    const before = text.slice(0, tag.start);
    const after = text.slice(tag.start + 1 + tag.q.length);
    const label = sug.label.replace(/\s+/g, ' ').trim();
    setText(`${before}#${label} ${after}`);
    setRefs((r) => [...r.filter((x) => !(x.k === sug.k && x.id === sug.id)), { k: sug.k, id: sug.id, label }]);
    setTag(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const used = refs.filter((r) => t.includes('#' + r.label));
      await addDoc(collection(db, 'chats', chat.id, 'messages'), { text: t, by: email, byName: profile.name || '', at: serverTimestamp(), refs: used });
      await updateDoc(doc(db, 'chats', chat.id), { lastMsg: { text: t.slice(0, 120), by: email, byName: profile.name || '', at: serverTimestamp() }, updatedAt: serverTimestamp() });
      setText(''); setRefs([]); setTag(null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
    inputRef.current?.focus();
  };

  // Hiển thị nội dung có thẻ #khách hàng / #mã hàng
  const render = (m) => {
    const rs = (m.refs || []).filter((r) => r.label).sort((a, b) => b.label.length - a.label.length);
    if (!rs.length) return m.text;
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('#(' + rs.map((r) => esc(r.label)).join('|') + ')', 'g');
    const out = []; let last = 0; let mm;
    while ((mm = re.exec(m.text))) {
      out.push(m.text.slice(last, mm.index));
      const r = rs.find((x) => x.label === mm[1]);
      out.push(<span key={mm.index} className={'chat-ref ' + (r.k === 'p' ? 'p' : 'c')} onClick={() => setView(r)}>{r.k === 'p' ? '🏷️' : '👤'} {r.label}</span>);
      last = mm.index + mm[0].length;
    }
    out.push(m.text.slice(last));
    return out;
  };

  let lastDay = '';
  const canManage = chat.type === 'group' && (isAdmin || chat.createdBy === email);
  return (
    <>
      <div className="chat-room-head">
        <button className="btn sm chat-back" onClick={onBack}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b className="ellipsis">{chat.type === 'all' ? '🏢 ' : chat.type === 'group' ? '👥 ' : ''}{title}</b>
          <div className="small">{chat.type === 'all' ? 'Mọi nhân viên' : chat.type === 'group' ? `${chat.members.length} thành viên` : 'Chat riêng'}</div>
        </div>
        {chat.type === 'group' && <button className="btn sm" onClick={() => setManage(true)}>⚙ Thành viên</button>}
      </div>
      <div className="chat-msgs">
        {err && <div className="error-box">{err}</div>}
        {!msgs.length && !err && <div className="small" style={{ textAlign: 'center', marginTop: 30 }}>Chưa có tin nhắn. Gõ <b>#</b> để gắn khách hàng hoặc mã hàng vào tin.</div>}
        {msgs.map((m, i) => {
          const d = dayKey(m.at);
          const showDay = d !== lastDay; lastDay = d;
          const mine = m.by === email;
          const showName = !mine && (i === 0 || msgs[i - 1].by !== m.by || showDay);
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day">{fmtDate(d)}</div>}
              <div className={'chat-msg' + (mine ? ' mine' : '')}>
                {showName && chat.type !== 'dm' && <div className="chat-name">{m.byName || staffName(m.by)}</div>}
                <div className="chat-bubble" title={new Date(ms(m.at) || Date.now()).toLocaleString('vi-VN')}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{render(m)}</span>
                  <span className="chat-time">{hhmm(m.at)}</span>
                  {(mine || isAdmin) && <span className="chat-del" title="Xóa tin" onClick={() => window.confirm('Xóa tin nhắn này?') && deleteDoc(doc(db, 'chats', chat.id, 'messages', m.id))}>✕</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="chat-input">
        {tag && suggestions.length > 0 && (
          <div className="chat-suggest">
            {suggestions.map((sg) => (
              <div key={sg.k + sg.id} className="pmp-item" onMouseDown={(e) => { e.preventDefault(); pick(sg); }}>
                <span>{sg.k === 'p' ? '🏷️' : '👤'}</span><b>{sg.label}</b><span className="small ellipsis">{sg.sub}</span>
              </div>
            ))}
          </div>
        )}
        <textarea ref={inputRef} rows={1} value={text} onChange={onChange} placeholder="Nhập tin nhắn… (Enter gửi, Shift+Enter xuống dòng, # gắn khách hàng / mã hàng)"
          onKeyDown={(e) => {
            if (tag && suggestions.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(suggestions[0]); return; }
            if (e.key === 'Escape') setTag(null);
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }} />
        <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>Gửi</button>
      </div>
      {manage && <GroupForm chat={chat} canManage={canManage} onClose={() => setManage(false)} onLeft={onLeft} />}
      {view && <RefView r={view} onClose={() => setView(null)} />}
    </>
  );
}

// Tạo / quản lý nhóm ----------------------------------------------------------
function GroupForm({ chat, canManage = true, onClose, onCreated, onLeft }) {
  const { email, isAdmin, staffList, staffName } = useApp();
  const [name, setName] = useState(chat?.name || '');
  const [members, setMembers] = useState(chat?.members || [email]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const people = staffList.filter((x) => x.active !== false && (!q || norm(x.name).includes(norm(q)) || x.email.includes(q.toLowerCase())));
  const toggle = (e) => setMembers((m) => (m.includes(e) ? m.filter((x) => x !== e) : [...m, e]));

  const save = async () => {
    if (!name.trim()) { setErr('Nhập tên nhóm'); return; }
    if (members.length < 2) { setErr('Chọn ít nhất 1 người khác'); return; }
    setBusy(true); setErr('');
    try {
      if (chat) {
        await updateDoc(doc(db, 'chats', chat.id), { name: name.trim(), members, updatedAt: serverTimestamp() });
      } else {
        const ref = await addDoc(collection(db, 'chats'), {
          type: 'group', name: name.trim(), members: members.includes(email) ? members : [...members, email], createdBy: email,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        onCreated?.(ref.id);
      }
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const leave = async () => {
    if (!window.confirm('Rời khỏi nhóm này?')) return;
    try { await updateDoc(doc(db, 'chats', chat.id), { members: chat.members.filter((m) => m !== email), updatedAt: serverTimestamp() }); onClose(); onLeft?.(); } catch (e) { setErr(e.message); }
  };
  const remove = async () => {
    if (!window.confirm('Xóa hẳn nhóm này và toàn bộ tin nhắn?')) return;
    try {
      const ms2 = await getDocs(collection(db, 'chats', chat.id, 'messages'));
      for (let i = 0; i < ms2.docs.length; i += 400) { const b = writeBatch(db); ms2.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); }
      await deleteDoc(doc(db, 'chats', chat.id)); onClose(); onLeft?.();
    } catch (e) { setErr(e.message); }
  };

  return (
    <Modal title={chat ? 'Thành viên nhóm' : 'Tạo nhóm trao đổi'} onClose={onClose}>
      <label className="field full"><span>Tên nhóm</span><input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} placeholder="VD: Nhóm sale HDPE, Giao hàng tuần 41…" autoFocus /></label>
      {chat && <p className="small">Người tạo: <b>{staffName(chat.createdBy)}</b>{!canManage && ' — chỉ người tạo nhóm hoặc quản trị được đổi tên, thêm/bớt thành viên.'}</p>}
      <input placeholder="Tìm nhân viên…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', margin: '6px 0' }} />
      <div className="chat-pick">
        {people.map((x) => (
          <label key={x.email} className="pmp-item" style={{ opacity: !canManage ? 0.7 : 1 }}>
            <input type="checkbox" checked={members.includes(x.email)} disabled={!canManage || x.email === (chat?.createdBy || email)} onChange={() => toggle(x.email)} />
            <b>{x.name || x.email}</b><span className="small">{x.role === 'admin' ? 'Quản trị' : x.role === 'accountant' ? 'Kế toán' : 'Sale'}</span>
          </label>
        ))}
      </div>
      <p className="small">Đã chọn {members.length} người.</p>
      {err && <div className="error-box">{err}</div>}
      <div className="form-actions">
        {chat && chat.createdBy !== email && <button className="btn" onClick={leave}>Rời nhóm</button>}
        {chat && (isAdmin || chat.createdBy === email) && <button className="btn danger" onClick={remove}>Xóa nhóm</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Đóng</button>
        {canManage && <button className="btn primary" disabled={busy} onClick={save}>{chat ? 'Lưu' : 'Tạo nhóm'}</button>}
      </div>
    </Modal>
  );
}

// Xem nhanh thẻ khách hàng / mã hàng ------------------------------------------
let stockCache = null;
function RefView({ r, onClose }) {
  const { staffName } = useApp();
  const custs = useCustomers('').data;
  const prods = useProducts().data;
  const [stock, setStock] = useState(stockCache);
  useEffect(() => {
    if (r.k !== 'p' || stockCache) return;
    getDocs(collection(db, 'stockSnap')).then((s) => {
      stockCache = []; s.docs.forEach((d) => { if (d.data().type === 'stock') stockCache.push(...(d.data().rows || [])); });
      setStock(stockCache);
    }).catch(() => setStock([]));
  }, [r]);
  if (r.k === 'c') {
    const c = custs.find((x) => x.id === r.id);
    return (
      <Modal title={'👤 ' + r.label} onClose={onClose}>
        {!c ? <p className="small">Khách hàng này không thuộc danh sách của bạn.</p> : (
          <table><tbody>
            {[['Mã KH', c.code], ['Loại / giai đoạn', [c.customerType, c.stage].filter(Boolean).join(' · ')], ['Người liên hệ', c.contact], ['Điện thoại', c.phone],
              ['Địa chỉ', c.address], ['Loại hạt đang dùng', c.productsUsed], ['Sản lượng', c.monthlyVolume], ['Sale phụ trách', staffName(c.ownerEmail)], ['Ghi chú', c.note]]
              .filter(([, v]) => v).map(([k, v]) => <tr key={k}><td className="small" style={{ width: 150 }}>{k}</td><td><b style={{ whiteSpace: 'pre-line' }}>{v}</b></td></tr>)}
          </tbody></table>
        )}
      </Modal>
    );
  }
  const p = prods.find((x) => String(x.code) === r.label);
  const s = (stock || []).find((x) => x.ic === r.label);
  return (
    <Modal title={'🏷️ ' + r.label} onClose={onClose}>
      {p && <p><b>{p.name}</b>{p.category ? ' · ' + p.category : ''}{p.price ? <> · Giá bán <b>{fmtMoney(p.price)}</b></> : ''}</p>}
      {!stock ? <p className="small">Đang tải tồn kho…</p> : !s ? <p className="small">Chưa có số liệu tồn kho cho mã này.</p> : (
        <>
          <div className="stats">
            <div className="stat green"><div className="stat-label">Tồn thực tế</div><div className="stat-value">{fmtNum(s.onHand, 0)} kg</div></div>
            <div className="stat amber"><div className="stat-label">Chưa giao</div><div className="stat-value">{fmtNum(s.unshipped, 0)}</div></div>
            <div className="stat"><div className="stat-label">Chưa về</div><div className="stat-value">{fmtNum(s.incoming, 0)}</div></div>
            <div className={'stat ' + (s.avail < 0 ? 'red' : 'green')}><div className="stat-label">Có thể bán</div><div className="stat-value">{fmtNum(s.avail, 0)}</div></div>
          </div>
          {Object.entries(s.wh || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="small">{k}: <b>{fmtNum(v, 0)}</b> kg</div>)}
        </>
      )}
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { DEFAULT_CONFIG, useApp } from '../context/AppContext';
import { slugKey, today } from '../lib/utils';
import { Field } from '../components/ui';
import { formatCode } from '../lib/codes';

const MODULES = [
  ['activities', 'Hoạt động KH'], ['quotes', 'Báo giá'], ['items', 'Cột dòng hàng (Lot, NSX…)'], ['orders', 'Đơn hàng'], ['payments', 'Thu tiền'],
  ['tasks', 'Công việc'], ['customers', 'Khách hàng'], ['dailyNotes', 'Báo cáo ngày'],
];
const TYPES = [['text', 'Chữ'], ['textarea', 'Đoạn văn'], ['number', 'Số'], ['date', 'Ngày'], ['select', 'Danh sách chọn'], ['checkbox', 'Có/Không']];

function TagList({ items, onChange, placeholder, validate }) {
  const [v, setV] = useState('');
  const add = () => {
    const x = v.trim();
    if (!x || items.includes(x)) return;
    if (validate && !validate(x)) return alert('Giá trị không hợp lệ');
    onChange([...items, x]);
    setV('');
  };
  return (
    <div>
      <div className="tags">
        {items.map((t) => <span key={t} className="tag">{t}<button type="button" onClick={() => onChange(items.filter((x) => x !== t))}>×</button></span>)}
      </div>
      <div className="inline-add">
        <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button type="button" className="btn" onClick={add}>Thêm</button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { config } = useApp();
  const [c, setC] = useState(config);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [testDate, setTestDate] = useState(today());
  const [mod, setMod] = useState('activities');
  const [nf, setNf] = useState({ label: '', type: 'text', options: '', required: false });

  useEffect(() => setC(config), [config]);
  const dirty = JSON.stringify(c) !== JSON.stringify(config);

  const save = async () => {
    setMsg('');
    const { ...data } = c;
    await setDoc(doc(db, 'settings', 'config'), data, { merge: true });
    setMsg('✔ Đã lưu cài đặt');
  };

  const fieldsOf = c.customFields[mod] || [];
  const setFields = (list) => setC({ ...c, customFields: { ...c.customFields, [mod]: list } });
  const addField = () => {
    if (!nf.label.trim()) return;
    setFields([...fieldsOf, {
      key: slugKey(nf.label), label: nf.label.trim(), type: nf.type, required: nf.required,
      options: nf.type === 'select' ? nf.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
    }]);
    setNf({ label: '', type: 'text', options: '', required: false });
  };
  const move = (i, d) => {
    const l = [...fieldsOf];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setFields(l);
  };

  const sendTest = async () => {
    setSending(true); setMsg('');
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch(`/api/daily-report?date=${testDate}`, { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? `✔ Đã gửi báo cáo ngày ${testDate} tới: ${(j.sentTo || []).join(', ')}` : '✖ Lỗi: ' + (j.error || r.status));
    } catch (e) { setMsg('✖ Lỗi: ' + e.message); }
    setSending(false);
  };

  return (
    <>
      <div className="page-head">
        <h1>Cài đặt</h1>
        <div className="actions">
          {dirty && <span className="badge amber">Có thay đổi chưa lưu</span>}
          <button className="btn primary" onClick={save} disabled={!dirty}>Lưu cài đặt</button>
        </div>
      </div>
      {msg && <div className={msg.startsWith('✖') ? 'error-box' : 'ok-box'} style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>📧 Email báo cáo tự động mỗi tối</h2>
        <p className="small">Hệ thống tự gửi báo cáo tổng hợp ngày lúc khoảng 20:00 (giờ VN) tới các email trong danh sách dưới. Thêm/bớt email tùy ý.</p>
        <div className="form-grid">
          <Field label="Danh sách email nhận báo cáo" full>
            <TagList items={c.reportRecipients || []} onChange={(v) => setC({ ...c, reportRecipients: v })}
              placeholder="nhap@email.com rồi Enter" validate={(x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)} />
          </Field>
          <Field label="Bật gửi tự động">
            <input type="checkbox" checked={c.reportEnabled !== false} onChange={(e) => setC({ ...c, reportEnabled: e.target.checked })} />
          </Field>
          <Field label="Kèm chi tiết hoạt động, đơn hàng, báo cáo ngày">
            <input type="checkbox" checked={c.reportIncludeDetails !== false} onChange={(e) => setC({ ...c, reportIncludeDetails: e.target.checked })} />
          </Field>
        </div>
        <div className="inline-add" style={{ maxWidth: 460 }}>
          <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          <button className="btn" onClick={sendTest} disabled={sending || dirty}>{sending ? 'Đang gửi…' : 'Gửi thử báo cáo ngày này'}</button>
        </div>
        {dirty && <p className="small">Lưu cài đặt trước khi gửi thử.</p>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>🧩 Trường thông tin tự thêm</h2>
        <p className="small">Thêm cột/trường riêng cho từng mục. Trường mới sẽ hiện trong form nhập, bảng danh sách, file Excel và email báo cáo.</p>
        <div className="presets" style={{ marginBottom: 10 }}>
          {MODULES.map(([k, l]) => (
            <button key={k} className={'chip' + (mod === k ? ' on' : '')} onClick={() => setMod(k)}>
              {l} {(c.customFields[k] || []).length > 0 && `(${c.customFields[k].length})`}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tên trường</th><th>Kiểu</th><th>Lựa chọn</th><th>Bắt buộc</th><th></th></tr></thead>
            <tbody>
              {fieldsOf.map((f, i) => (
                <tr key={f.key}>
                  <td><input value={f.label} onChange={(e) => setFields(fieldsOf.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                  <td>{TYPES.find((t) => t[0] === f.type)?.[1]}</td>
                  <td>{f.type === 'select' && (
                    <input value={(f.options || []).join(', ')}
                      onChange={(e) => setFields(fieldsOf.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((s) => s.trim()) } : x)))} />
                  )}</td>
                  <td><input type="checkbox" checked={!!f.required} onChange={(e) => setFields(fieldsOf.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /></td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => move(i, -1)}>↑</button>{' '}
                    <button className="btn sm" onClick={() => move(i, 1)}>↓</button>{' '}
                    <button className="btn sm danger" onClick={() => window.confirm('Xóa trường này? Dữ liệu cũ vẫn lưu nhưng không hiển thị.') && setFields(fieldsOf.filter((_, j) => j !== i))}>Xóa</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td><input placeholder="VD: Chỉ số MFI, Xuất xứ, Kho giao…" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} /></td>
                <td><select value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td>{nf.type === 'select' && <input placeholder="Cách nhau dấu phẩy" value={nf.options} onChange={(e) => setNf({ ...nf, options: e.target.value })} />}</td>
                <td><input type="checkbox" checked={nf.required} onChange={(e) => setNf({ ...nf, required: e.target.checked })} /></td>
                <td><button className="btn primary sm" onClick={addField}>+ Thêm trường</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>🔢 Mã khách hàng tự động</h2>
        <p className="small">Khách mới đang chào giá (để trống Mã KH) được cấp mã tự động. Khách đã chốt: nhập mã theo phần mềm kế toán.</p>
        <div className="form-grid">
          <Field label="Tiền tố">
            <input value={c.codePrefix ?? 'KH'} onChange={(e) => setC({ ...c, codePrefix: e.target.value.trim() })} />
          </Field>
          <Field label="Số chữ số">
            <input type="number" min="3" max="10" value={c.codeDigits || 6} onChange={(e) => setC({ ...c, codeDigits: Number(e.target.value) || 6 })} />
          </Field>
        </div>
        <CodeCounter prefixCfg={c} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>📋 Danh mục</h2>
        <div className="form-grid">
          <Field label="Tên công ty (hiện trên menu và email)" full>
            <input value={c.companyName} onChange={(e) => setC({ ...c, companyName: e.target.value })} />
          </Field>
          <Field label="Địa chỉ công ty (in trên báo giá)" full>
            <input value={c.companyAddress || ''} onChange={(e) => setC({ ...c, companyAddress: e.target.value })} />
          </Field>
          <Field label="Điện thoại">
            <input value={c.companyPhone || ''} onChange={(e) => setC({ ...c, companyPhone: e.target.value })} />
          </Field>
          <Field label="Mã số thuế">
            <input value={c.companyTaxCode || ''} onChange={(e) => setC({ ...c, companyTaxCode: e.target.value })} />
          </Field>
          <Field label="Điều khoản mặc định trên báo giá" full>
            <textarea rows={2} value={c.quoteTerms || ''} onChange={(e) => setC({ ...c, quoteTerms: e.target.value })} />
          </Field>
          <Field label="Loại hoạt động khách hàng" full>
            <TagList items={c.activityTypes} onChange={(v) => setC({ ...c, activityTypes: v })} placeholder="VD: Thăm nhà máy" />
          </Field>
          <Field label="Loại hạt nhựa / sản phẩm (gợi ý khi nhập đơn)" full>
            <TagList items={c.products} onChange={(v) => setC({ ...c, products: v })} placeholder="VD: PP Homo" />
          </Field>
          <Field label="Nguồn khách hàng" full>
            <TagList items={c.customerSources} onChange={(v) => setC({ ...c, customerSources: v })} placeholder="VD: Facebook" />
          </Field>
        </div>
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setC({ ...DEFAULT_CONFIG, ...c, activityTypes: DEFAULT_CONFIG.activityTypes, products: DEFAULT_CONFIG.products, customerSources: DEFAULT_CONFIG.customerSources })}>
          Khôi phục danh mục mặc định
        </button>
      </div>
    </>
  );
}

function CodeCounter({ prefixCfg }) {
  const [n, setN] = useState(null);
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    getDoc(doc(db, 'counters', 'customerCode')).then((s) => {
      const v = s.exists() ? Number(s.data().n) || 0 : 0;
      setN(v); setNext(String(v + 1));
    }).catch(() => setN(0));
  }, []);
  const save = async () => {
    const v = Math.max(1, Number(next) || 1) - 1;
    await setDoc(doc(db, 'counters', 'customerCode'), { n: v });
    setN(v); setMsg('✔ Đã đặt số tiếp theo');
  };
  return (
    <div className="inline-add" style={{ alignItems: 'center', maxWidth: 560 }}>
      <span className="small">Mã tiếp theo: <b>{n === null ? '…' : formatCode((n || 0) + 1, prefixCfg)}</b> · Đặt số bắt đầu:</span>
      <input type="number" min="1" value={next} onChange={(e) => setNext(e.target.value)} style={{ maxWidth: 120 }} />
      <button type="button" className="btn sm" onClick={save}>Đặt</button>
      {msg && <span className="small">{msg}</span>}
    </div>
  );
}

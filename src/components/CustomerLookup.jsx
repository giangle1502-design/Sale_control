import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { loadIndex, searchIndex } from '../lib/customerMatch';
import { Modal } from './ui';

// Bảng kết quả tra cứu khách toàn công ty (dùng chung cho nút Tra cứu và form Thêm khách)
export function LookupResults({ index, q, max = 50, compact: small = false }) {
  const { staffName, profile } = useApp();
  const dq = useDeferredValue(q);
  const list = useMemo(() => (index ? searchIndex(index, dq, max) : []), [index, dq, max]);
  if (!index) return <div className="small">Đang tải danh sách khách toàn công ty…</div>;
  if (q.trim().length < 2) return small ? null : <div className="small">Gõ ít nhất 2 ký tự (tên, mã KH, MST, người liên hệ hoặc địa chỉ).</div>;
  if (!list.length) return <div className="ok-box">✓ Chưa có khách nào trên hệ thống khớp với "<b>{q}</b>".</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: small ? 220 : 480, overflow: 'auto' }}>
      <table className="no-rs">
        <thead><tr><th>Khách hàng</th><th>Người liên hệ</th><th>Địa chỉ</th><th>Sale phụ trách</th></tr></thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.id}>
              <td><b>{x.n}</b>{(x.c || x.t) && <div className="small">{x.c ? `Mã ${x.c}` : ''}{x.c && x.t ? ' · ' : ''}{x.t ? `MST ${x.t}` : ''}</div>}
                <div className="small"><i>{x.why}</i></div></td>
              <td>{x.p || <span className="small">—</span>}</td>
              <td style={{ minWidth: 160 }}>{x.a || <span className="small">—</span>}</td>
              <td className="nowrap">{x.o ? staffName(x.o) : <span className="small">chưa có sale</span>}
                {x.o === profile.email && <div><span className="badge">khách của bạn</span></div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length >= max && <div className="small" style={{ padding: 6 }}>Chỉ hiện {max} kết quả đầu — gõ cụ thể hơn để thu hẹp.</div>}
    </div>
  );
}

// Nút "Tra cứu khách toàn công ty": sale gõ tên → thấy ngay khách đã có của mọi sale
export default function CustomerLookup({ onClose, onAdd }) {
  const [index, setIndex] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { loadIndex().then(setIndex).catch(() => setIndex([])); }, []);
  return (
    <Modal title="🔍 Tra cứu khách hàng toàn công ty" onClose={onClose} wide>
      <p className="small" style={{ marginTop: 0 }}>Kiểm tra trước khi thêm khách mới: hiện khách đã có của <b>tất cả sale</b> (tên đầy đủ, người liên hệ, địa chỉ, sale phụ trách). Tìm được cả khi gõ không dấu hoặc tên viết tắt.</p>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="VD: Thiên Long, thien long, 0301234567…" style={{ width: '100%', marginBottom: 10 }} />
      <LookupResults index={index} q={q} />
      <div className="form-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        {onAdd && q.trim().length >= 2 && <button type="button" className="btn primary" onClick={() => onAdd(q.trim())}>+ Thêm khách mới "{q.trim()}"</button>}
      </div>
    </Modal>
  );
}

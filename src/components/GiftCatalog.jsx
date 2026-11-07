import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';

// Danh mục Dịp tặng quà & Gói quà (collection giftCampaigns) — dùng chung với app Nhân sự.
// Phòng Giám đốc cập nhật nội dung gói quà (gồm những gì, giá trị) trong app Nhân sự; sale chọn ở đây.
export function useCampaigns() {
  const q = useQuery(() => collection(db, 'giftCampaigns'), []);
  const list = [...q.data].filter((c) => c.active !== false).sort((a, b) => String(b.planDate || '').localeCompare(String(a.planDate || '')) || String(a.name).localeCompare(String(b.name)));
  return { ...q, list, all: q.data };
}
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const packageValue = (p) => (p?.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
export const packageText = (p) => (p?.items || []).map((it) => `${it.name}${it.qty ? ` x${it.qty}${it.unit ? ' ' + it.unit : ''}` : ''}`).join(', ');

export function CampaignPicker({ campaigns, value, onChange }) {
  const { profile } = useApp();
  const add = async () => {
    const name = window.prompt('Tên dịp tặng quà mới (VD: Quà tặng khách Tết Dương lịch 2027):', '');
    if (!name || !name.trim()) return;
    const exist = campaigns.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (exist) return onChange(exist.name, exist);
    const data = { name: name.trim(), active: true, planDate: '', packages: [], note: '', createdBy: profile.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: profile.email };
    try { const ref = await addDoc(collection(db, 'giftCampaigns'), data); onChange(data.name, { id: ref.id, ...data }); } catch (e) { window.alert(e.message); }
  };
  return (
    <div className="select-add">
      <select value={value || ''} onChange={(e) => onChange(e.target.value, campaigns.find((c) => c.name === e.target.value))} required>
        <option value="">-- Chọn dịp tặng quà --</option>
        {campaigns.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        {value && !campaigns.some((c) => c.name === value) && <option value={value}>{value}</option>}
      </select>
      <button type="button" className="btn sm plus" title="Thêm dịp tặng quà mới" onClick={add}>＋</button>
    </div>
  );
}

export function PackagePicker({ campaign, value, onChange }) {
  const { profile } = useApp();
  const pkgs = campaign?.packages || [];
  const add = async () => {
    if (!campaign?.id) return window.alert('Chọn dịp tặng quà trước.');
    const name = window.prompt(`Tên gói quà mới cho "${campaign.name}" (VD: Giỏ quà A – khách lớn):`, '');
    if (!name || !name.trim()) return;
    const p = { id: Math.random().toString(36).slice(2, 9), name: name.trim(), items: [] };
    try { await updateDoc(doc(db, 'giftCampaigns', campaign.id), { packages: [...pkgs, p], updatedAt: serverTimestamp(), updatedBy: profile.email }); onChange(p.name); } catch (e) { window.alert(e.message); }
  };
  const cur = pkgs.find((p) => p.name === value);
  return (
    <div>
      <div className="select-add">
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">-- Chọn gói quà --</option>
          {pkgs.map((p) => <option key={p.id} value={p.name}>{p.name}{packageValue(p) ? ` (${fmt(packageValue(p))} đ)` : ''}</option>)}
          {value && !cur && <option value={value}>{value}</option>}
        </select>
        <button type="button" className="btn sm plus" title="Thêm gói quà mới" onClick={add}>＋</button>
      </div>
      {cur && (cur.items || []).length > 0 && <div className="small" style={{ marginTop: 4 }}>Gồm: {packageText(cur)}{packageValue(cur) ? ` · ${fmt(packageValue(cur))} đ/khách` : ''}</div>}
      {cur && !(cur.items || []).length && <div className="small" style={{ marginTop: 4 }}>Nội dung gói quà do phòng Giám đốc cập nhật trong app Nhân sự.</div>}
    </div>
  );
}

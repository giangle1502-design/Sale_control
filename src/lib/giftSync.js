import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

// Đổi tên dịp / gói quà và đồng bộ sang tất cả khách trong danh sách tặng quà (collection gifts).
async function patchGifts(conds, patch, email) {
  const snap = await getDocs(query(collection(db, 'gifts'), ...conds.map(([k, v]) => where(k, '==', v))));
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const b = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { ...patch, updatedAt: serverTimestamp(), updatedBy: email }));
    await b.commit();
  }
  return docs.length;
}

// campaign: doc trong giftCampaigns (có id) hoặc null nếu dịp cũ chỉ có trong danh sách khách.
// Trả về { id, count } — số khách đã cập nhật.
// target: nếu tên mới trùng một dịp khác đã có → gộp khách sang dịp đó (dịp cũ chuyển "ngừng dùng").
export async function renameCampaign({ campaign, oldName, newName, email, extra = {}, target }) {
  newName = newName.trim();
  let id = campaign?.id;
  if (target && target.id !== id) {
    if (id) await updateDoc(doc(db, 'giftCampaigns', id), { active: false, updatedAt: serverTimestamp(), updatedBy: email });
    const count = oldName ? await patchGifts([['campaign', oldName]], { campaign: target.name, campaignId: target.id }, email) : 0;
    return { id: target.id, count, merged: true };
  }
  if (id) await updateDoc(doc(db, 'giftCampaigns', id), { name: newName, ...extra, updatedAt: serverTimestamp(), updatedBy: email });
  else {
    const ref = await addDoc(collection(db, 'giftCampaigns'), { name: newName, active: true, planDate: '', note: '', packages: [], ...extra, createdAt: serverTimestamp(), createdBy: email, updatedAt: serverTimestamp(), updatedBy: email });
    id = ref.id;
  }
  const count = oldName ? await patchGifts([['campaign', oldName]], { campaign: newName, campaignId: id }, email) : 0;
  return { id, count };
}

export const renamePackage = ({ campaignName, oldName, newName, email }) =>
  patchGifts([['campaign', campaignName], ['giftName', oldName]], { giftName: newName.trim() }, email);

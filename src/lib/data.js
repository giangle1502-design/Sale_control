import {
  addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { today } from './utils';

// Tạo truy vấn theo quyền: sale chỉ thấy dữ liệu của mình; admin thấy tất cả hoặc lọc theo 1 NV.
export function scopedQuery(coll, { me, isAdmin, staffFilter, from, to, dateField = 'date', order = true }) {
  const conds = [];
  const owner = isAdmin ? staffFilter : me;
  if (owner) conds.push(where('ownerEmail', '==', owner));
  if (from) conds.push(where(dateField, '>=', from));
  if (to) conds.push(where(dateField, '<=', to));
  if (order && (from || to)) conds.push(orderBy(dateField, 'desc'));
  return query(collection(db, coll), ...conds);
}

export async function saveDoc(coll, id, data, profile) {
  const payload = { ...data, updatedAt: serverTimestamp(), updatedBy: profile.email };
  if (id) {
    await updateDoc(doc(db, coll, id), payload);
    return id;
  }
  const ref = await addDoc(collection(db, coll), {
    ownerEmail: profile.email,
    ownerName: profile.name,
    ...payload,
    createdAt: serverTimestamp(),
    createdBy: profile.email,
  });
  return ref.id;
}

// Nếu khách hàng gõ mới chưa có trong danh sách thì tự tạo
export async function ensureCustomer(sel, profile) {
  if (sel.customerId || !sel.customerName?.trim()) return { customerId: sel.customerId || '', customerName: sel.customerName || '' };
  const id = await saveDoc('customers', null, { name: sel.customerName.trim(), customerType: 'Khách mới', stage: 'Tiềm năng', createdDate: today() }, profile);
  return { customerId: id, customerName: sel.customerName.trim() };
}

// Khi đã chốt đơn → chuyển khách thành "Khách cũ"
export async function markCustomerOld(customerId) {
  if (!customerId) return;
  try { await updateDoc(doc(db, 'customers', customerId), { customerType: 'Khách cũ' }); } catch (e) { console.warn(e.message); }
}

export const removeDoc = (coll, id) => deleteDoc(doc(db, coll, id));
export const setDocById = (coll, id, data) => setDoc(doc(db, coll, id), data, { merge: true });

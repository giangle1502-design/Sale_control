import {
  addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { today } from './utils';
import { reserveCodes } from './codes';

// Tạo truy vấn theo quyền: sale chỉ thấy dữ liệu của mình; admin thấy tất cả hoặc lọc theo 1 NV.
// Khi lọc theo nhân viên: chỉ truy vấn theo ownerEmail, lọc ngày ngay trên trình duyệt
// → không cần tạo chỉ mục (index) ghép trên Firestore.
export function scopedQuery(coll, { me, isAdmin, staffFilter, from, to, dateField = 'date', order = true }) {
  const owner = isAdmin ? staffFilter : me;
  let q;
  if (owner) {
    q = query(collection(db, coll), where('ownerEmail', '==', owner));
  } else {
    const conds = [];
    if (from) conds.push(where(dateField, '>=', from));
    if (to) conds.push(where(dateField, '<=', to));
    if (order && (from || to)) conds.push(orderBy(dateField, 'desc'));
    q = query(collection(db, coll), ...conds);
  }
  q.__clientFilter = owner && (from || to) ? { dateField, from, to } : null;
  return q;
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
  const [code] = await reserveCodes(1);
  const id = await saveDoc('customers', null, { code, name: sel.customerName.trim(), customerType: 'Khách mới', stage: 'Tiềm năng', createdDate: today() }, profile);
  return { customerId: id, customerName: sel.customerName.trim() };
}

// Khi đã chốt đơn → chuyển khách thành "Khách cũ"
export async function markCustomerOld(customerId) {
  if (!customerId) return;
  try { await updateDoc(doc(db, 'customers', customerId), { customerType: 'Khách cũ' }); } catch (e) { console.warn(e.message); }
}

export const removeDoc = (coll, id) => deleteDoc(doc(db, coll, id));
export const setDocById = (coll, id, data) => setDoc(doc(db, coll, id), data, { merge: true });

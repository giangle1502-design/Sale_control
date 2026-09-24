import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db, SUPER_ADMINS } from '../firebase';

export const DEFAULT_CONFIG = {
  companyName: 'Công ty Hạt nhựa',
  activityTypes: ['Gọi điện', 'Gặp khách', 'Gửi mẫu', 'Báo giá', 'Zalo/Email', 'Khác'],
  products: ['PP', 'PE', 'HDPE', 'LDPE', 'LLDPE', 'ABS', 'PS', 'PET', 'PVC', 'PC', 'Hạt màu', 'Hạt tái sinh'],
  customerSources: ['Khách cũ', 'Giới thiệu', 'Online', 'Hội chợ', 'Tự tìm'],
  customFields: { activities: [], quotes: [], orders: [], items: [], payments: [], tasks: [], customers: [], dailyNotes: [] },
  companyAddress: '',
  companyPhone: '',
  companyTaxCode: '',
  quoteTerms: 'Giá chưa bao gồm VAT. Báo giá có hiệu lực 7 ngày. Giao hàng tại kho bên mua.',
  reportRecipients: [],
  reportEnabled: true,
  reportIncludeDetails: true,
};

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = đang tải
  const [staffDoc, setStaffDoc] = useState(undefined);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [staffList, setStaffList] = useState([]);

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u || null)), []);

  const email = user?.email?.toLowerCase() || '';
  const isSuper = SUPER_ADMINS.includes(email);

  useEffect(() => {
    if (!email) { setStaffDoc(undefined); return; }
    return onSnapshot(
      doc(db, 'staff', email),
      (s) => setStaffDoc(s.exists() ? s.data() : null),
      () => setStaffDoc(null)
    );
  }, [email]);

  const allowed = !!user && (isSuper || (staffDoc && staffDoc.active !== false));
  const isAdmin = !!user && (isSuper || (staffDoc?.role === 'admin' && staffDoc?.active !== false));

  useEffect(() => {
    if (!allowed) return;
    return onSnapshot(doc(db, 'settings', 'config'), (s) => {
      const d = s.exists() ? s.data() : {};
      setConfig({
        ...DEFAULT_CONFIG,
        ...d,
        customFields: { ...DEFAULT_CONFIG.customFields, ...(d.customFields || {}) },
      });
    });
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    return onSnapshot(collection(db, 'staff'), (s) =>
      setStaffList(s.docs.map((d) => ({ email: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    , () => setStaffList([]));
  }, [allowed]);

  const profile = useMemo(
    () => ({
      email,
      name: staffDoc?.name || user?.displayName || email,
      role: isAdmin ? 'admin' : 'sale',
    }),
    [email, staffDoc, user, isAdmin]
  );

  const value = {
    user, email, profile, isAdmin, allowed, config, staffList,
    loading: user === undefined || (!!user && staffDoc === undefined && !isSuper),
    staffName: (e) => staffList.find((s) => s.email === e)?.name || (e === email ? profile.name : e),
    logout: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

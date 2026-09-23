import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';

// Danh sách khách hàng theo quyền (sale: của mình, admin: tất cả)
export function useCustomers(ownerOverride) {
  const { email, isAdmin } = useApp();
  const owner = isAdmin ? ownerOverride : email;
  return useQuery(
    () => (owner ? query(collection(db, 'customers'), where('ownerEmail', '==', owner)) : collection(db, 'customers')),
    [owner]
  );
}

export default function CustomerPicker({ value, onChange, required }) {
  const { data } = useCustomers();
  const sorted = useMemo(() => [...data].sort((a, b) => (a.name || '').localeCompare(b.name || '')), [data]);
  return (
    <>
      <input
        list="customer-list"
        value={value?.customerName || ''}
        required={required}
        placeholder="Gõ tên khách hàng…"
        onChange={(e) => {
          const name = e.target.value;
          const c = sorted.find((x) => x.name === name);
          onChange({ customerId: c?.id || '', customerName: name });
        }}
      />
      <datalist id="customer-list">
        {sorted.map((c) => <option key={c.id} value={c.name}>{c.phone || ''}</option>)}
      </datalist>
    </>
  );
}

import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';

// Lắng nghe realtime một truy vấn Firestore. makeQuery trả về query hoặc null.
export function useQuery(makeQuery, deps) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    const q = makeQuery();
    if (!q) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const f = q.__clientFilter;
        if (f) {
          rows = rows
            .filter((r) => (!f.from || (r[f.dateField] || '') >= f.from) && (!f.to || (r[f.dateField] || '') <= f.to) && r[f.dateField])
            .sort((a, b) => String(b[f.dateField]).localeCompare(String(a[f.dateField])));
        }
        setData(rows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}

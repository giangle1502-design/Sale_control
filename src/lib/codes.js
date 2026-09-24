import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';

// Mã khách hàng tự động cho khách mới đang chào giá: KH000001, KH000002…
// Khách đã chốt dùng mã theo phần mềm kế toán (nhập tay hoặc nhập Excel).
let current = { codePrefix: 'KH', codeDigits: 6 };
export const setCodeConfig = (c) => { current = c || current; };

export function formatCode(n, config = current) {
  const prefix = config?.codePrefix ?? 'KH';
  const digits = Number(config?.codeDigits) || 6;
  return prefix + String(n).padStart(digits, '0');
}

export function isAutoCode(code, config = current) {
  const prefix = config?.codePrefix ?? 'KH';
  const digits = Number(config?.codeDigits) || 6;
  const esc = prefix.replace(/[.*+?^$()|[\]\\{}]/g, (c) => '\\' + c);
  return !!code && new RegExp('^' + esc + '\\d{' + digits + '}$').test(code);
}

// Giữ chỗ `count` mã liên tiếp (an toàn khi nhiều người cùng tạo)
export async function reserveCodes(count, config = current) {
  if (count <= 0) return [];
  const ref = doc(db, 'counters', 'customerCode');
  const start = await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    const cur = s.exists() ? Number(s.data().n) || 0 : 0;
    tx.set(ref, { n: cur + count });
    return cur + 1;
  });
  return Array.from({ length: count }, (_, i) => formatCode(start + i, config));
}

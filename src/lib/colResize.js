import { useEffect } from 'react';

// ============================================================================
// Kéo để chỉnh độ rộng cột cho mọi bảng trong trang (kéo mép phải tiêu đề cột).
// Độ rộng được nhớ theo từng trang + bộ cột trên trình duyệt; nhấp đúp mép cột để trả về mặc định.
// Bỏ qua bảng có class "info" / "no-rs" hoặc tiêu đề gộp ô (colspan).
// ============================================================================

const PREFIX = 'colw:';
const MIN = 40;

const headCells = (table) => {
  const rows = table.tHead?.rows;
  if (!rows || rows.length !== 1) return null;
  const ths = [...rows[0].cells];
  if (!ths.length || ths.some((th) => th.colSpan > 1)) return null;
  return ths;
};
const keyOf = (ths) => PREFIX + location.pathname + '|' + ths.map((th) => th.textContent.replace(/[▲▼↑↓⇅↕⬆⬇]/g, '').trim().slice(0, 20)).join('|');
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } };

function setWidths(table, ths, widths) {
  ths.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
  table.style.width = widths.reduce((s, w) => s + w, 0) + 'px';
  table.style.minWidth = '0';
  table.classList.add('rs-fixed');
}
function clearWidths(table, ths) {
  ths.forEach((th) => { th.style.width = ''; });
  table.style.width = ''; table.style.minWidth = '';
  table.classList.remove('rs-fixed');
}

function startDrag(e, table, i) {
  const ths = headCells(table);
  if (!ths) return;
  e.preventDefault(); e.stopPropagation();
  const key = keyOf(ths);
  const widths = ths.map((th) => th.getBoundingClientRect().width);
  setWidths(table, ths, widths);
  const x0 = e.clientX; const w0 = widths[i];
  const h = e.currentTarget;
  h.classList.add('on');
  try { h.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
  document.body.classList.add('rs-dragging');
  const move = (ev) => { widths[i] = Math.max(MIN, Math.round(w0 + ev.clientX - x0)); setWidths(table, ths, widths); };
  const up = () => {
    h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
    h.classList.remove('on'); document.body.classList.remove('rs-dragging');
    save(key, widths);
    // chặn cú click (sắp xếp cột…) phát sinh ngay sau khi thả chuột
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', stop, true);
    setTimeout(() => window.removeEventListener('click', stop, true), 0);
  };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
}

function prepare(table) {
  if (table.classList.contains('info') || table.classList.contains('no-rs')) return;
  const ths = headCells(table);
  if (!ths) return;
  ths.forEach((th, i) => {
    let h = th.querySelector(':scope > .col-rs');
    if (!h) {
      h = document.createElement('span');
      h.className = 'col-rs';
      h.title = 'Kéo để chỉnh độ rộng cột · nhấp đúp để trả về mặc định';
      h.addEventListener('pointerdown', (e) => startDrag(e, table, Number(h.dataset.i)));
      h.addEventListener('click', (e) => e.stopPropagation());
      h.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const cur = headCells(table); if (!cur) return;
        drop(keyOf(cur)); clearWidths(table, cur);
      });
      th.appendChild(h);
    }
    h.dataset.i = i;
  });
  const key = keyOf(ths);
  if (table.dataset.rsKey !== key) {
    table.dataset.rsKey = key;
    const saved = load(key);
    if (Array.isArray(saved) && saved.length === ths.length) setWidths(table, ths, saved);
    else clearWidths(table, ths);
  }
}

// Gắn vào vùng nội dung chính (main) — tự áp dụng cho mọi bảng, kể cả bảng hiện ra sau
export function useColumnResize(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    let raf = 0;
    const scan = () => { raf = 0; root.querySelectorAll('table').forEach(prepare); };
    const queue = () => { if (!raf) raf = requestAnimationFrame(scan); };
    scan();
    const mo = new MutationObserver(queue);
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [ref]);
}

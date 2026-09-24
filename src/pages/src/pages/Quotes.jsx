import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useQuery } from '../lib/hooks';
import { ensureCustomer, removeDoc, saveDoc, scopedQuery } from '../lib/data';
import {
  addDays, fmtDate, fmtMoney, fmtNum, fmtTon, num, orderAmount, orderKg, QUOTE_OPEN, QUOTE_STATUSES, today,
} from '../lib/utils';
import { exportSheets } from '../lib/excel';
import CustomerPicker from '../components/CustomerPicker';
import ItemsTable, { blankItem, cleanItems, itemText } from '../components/ItemsTable';
import AddFieldButton from '../components/AddFieldButton';
import { OrderForm, newOrderNo } from './Orders';
import {
  confirmDelete, CustomFieldInputs, customValue, Empty, ErrorBox, Field, FilterBar, Modal, Stat, useRange,
} from '../components/ui';

const TONE = { 'Nháp': '', 'Đã gửi': 'blue', 'KH chấp nhận': 'amber', 'KH từ chối': 'red', 'Hết hạn': 'red', 'Đã tạo đơn': 'green' };
const blank = (config) => ({
  quoteNo: 'BG' + today().replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
  date: today(), validUntil: addDays(today(), 7), customerId: '', customerName: '', attention: '',
  items: [blankItem()], vatPct: 0, paymentTerms: '', deliveryTerms: '', terms: config.quoteTerms || '',
  status: 'Đã gửi', note: '', custom: {},
});

export default function Quotes() {
  const { email, isAdmin, config, staffName } = useApp();
  const [range, setRange] = useRange('Tháng này');
  const [staff, setStaff] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const fields = config.customFields.quotes || [];
  const cols = config.customFields.items || [];

  const { data, error } = useQuery(
    () => scopedQuery('quotes', { me: email, isAdmin, staffFilter: staff, ...range }),
    [email, isAdmin, staff, range.from, range.to]
  );
  const rows = data.filter((r) => !status || r.status === status);
  const sum = useMemo(() => {
    const done = data.filter((r) => r.status === 'Đã tạo đơn');
    const open = data.filter((r) => QUOTE_OPEN.includes(r.status));
    return {
      count: data.length,
      amount: data.reduce((s, r) => s + orderAmount(r), 0),
      open: open.length, openAmount: open.reduce((s, r) => s + orderAmount(r), 0),
      done: done.length,
      rate: data.length ? Math.round((done.length / data.length) * 100) : 0,
    };
  }, [data]);

  const toOrder = (q) => setConfirm({
    orderNo: newOrderNo(), date: today(), customerId: q.customerId, customerName: q.customerName,
    items: (q.items || []).map((it) => ({ ...it, custom: { ...(it.custom || {}) } })),
    vatPct: q.vatPct || 0, status: 'Đã chốt', note: q.note || '', quoteId: q.id, quoteNo: q.quoteNo, custom: {},
  });

  const doExport = () => exportSheets(`BaoGia_${range.from}_${range.to}`, {
    'Báo giá': rows.map((r) => ({
      'Số BG': r.quoteNo, Ngày: fmtDate(r.date), 'Hiệu lực đến': fmtDate(r.validUntil), 'Nhân viên': staffName(r.ownerEmail),
      'Khách hàng': r.customerName, 'Sản phẩm': (r.items || []).map((i) => itemText(i, cols)).join('; '),
      'Tổng kg': orderKg(r), 'Tổng tiền': Math.round(orderAmount(r)), 'Trạng thái': r.status, 'Số ĐH': r.orderNo || '',
      ...Object.fromEntries(fields.map((f) => [f.label, customValue(f, r.custom?.[f.key])])),
    })),
  });

  return (
    <>
      <div className="page-head">
        <h1>Báo giá</h1>
        <div className="actions">
          <button className="btn" onClick={doExport}>⬇ Excel</button>
          <button className="btn primary" onClick={() => setEdit(blank(config))}>+ Tạo báo giá</button>
        </div>
      </div>
      <FilterBar range={range} setRange={setRange} staff={staff} setStaff={setStaff}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {QUOTE_STATUSES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </FilterBar>
      <div className="stats">
        <Stat label="Báo giá đã gửi" value={sum.count} sub={fmtMoney(sum.amount) + ' đ'} />
        <Stat label="Đang chờ khách" value={sum.open} sub={fmtMoney(sum.openAmount) + ' đ'} tone="amber" />
        <Stat label="Đã chốt thành đơn" value={sum.done} sub={`Tỷ lệ chốt ${sum.rate}%`} tone="green" />
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        {rows.length === 0 ? <Empty /> : (
          <table>
            <thead><tr>
              <th>Số BG</th><th>Ngày</th>{isAdmin && <th>Nhân viên</th>}<th>Khách hàng</th><th>Sản phẩm</th>
              <th className="num">Tấn</th><th className="num">Tổng tiền</th><th>Hiệu lực</th><th>Trạng thái</th>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}<th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const expired = QUOTE_OPEN.includes(r.status) && r.validUntil && r.validUntil < today();
                const mine = isAdmin || r.ownerEmail === email;
                return (
                  <tr key={r.id}>
                    <td className="nowrap">{r.quoteNo}</td>
                    <td className="nowrap">{fmtDate(r.date)}</td>
                    {isAdmin && <td>{staffName(r.ownerEmail)}</td>}
                    <td>{r.customerName}</td>
                    <td>{(r.items || []).map((i, k) => <div key={k}>{itemText(i, cols)} <span className="small">{fmtNum(i.qtyKg, 0)}kg × {fmtMoney(i.priceKg)}</span></div>)}</td>
                    <td className="num">{fmtTon(orderKg(r))}</td>
                    <td className="num">{fmtMoney(orderAmount(r))}</td>
                    <td className="nowrap">{fmtDate(r.validUntil)} {expired && <span className="badge red">Quá hạn</span>}</td>
                    <td><span className={'badge ' + (TONE[r.status] || '')}>{r.status}</span>{r.orderNo && <div className="small">→ {r.orderNo}</div>}</td>
                    {fields.map((f) => <td key={f.key}>{String(customValue(f, r.custom?.[f.key]))}</td>)}
                    <td className="nowrap">
                      <button className="btn sm" onClick={() => printQuote(r, config, staffName)}>In</button>{' '}
                      {mine && r.status !== 'Đã tạo đơn' && r.status !== 'KH từ chối' && (
                        <button className="btn sm primary" onClick={() => toOrder(r)}>✔ Xác nhận tạo đơn</button>
                      )}{' '}
                      {mine && <>
                        <button className="btn sm" onClick={() => setEdit(r)}>Sửa</button>{' '}
                        <button className="btn sm danger" onClick={() => confirmDelete('Xóa báo giá này?') && removeDoc('quotes', r.id)}>Xóa</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {edit && <QuoteForm initial={edit} onClose={() => setEdit(null)} />}
      {confirm && <OrderForm initial={confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}

function QuoteForm({ initial, onClose }) {
  const { profile, config, staffName } = useApp();
  const fields = config.customFields.quotes || [];
  const [f, setF] = useState({ ...blank(config), ...initial, custom: initial.custom || {}, items: initial.items?.length ? initial.items : [blankItem()] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (andPrint) => {
    setBusy(true); setErr('');
    try {
      const cust = await ensureCustomer(f, profile);
      const { id, ownerEmail, ownerName, createdAt, createdBy, updatedAt, updatedBy, ...rest } = f;
      const items = cleanItems(rest.items);
      const data = {
        ...rest, ...cust, items, vatPct: num(rest.vatPct),
        totalKg: orderKg({ items }), totalAmount: Math.round(orderAmount({ items, vatPct: rest.vatPct })),
      };
      await saveDoc('quotes', id, data, profile);
      if (andPrint) printQuote({ ...f, ...data, ownerEmail: f.ownerEmail || profile.email }, config, staffName);
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <Modal title={f.id ? 'Sửa báo giá' : 'Tạo báo giá'} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <div className="form-grid">
          <Field label="Số báo giá" required><input value={f.quoteNo} onChange={set('quoteNo')} required /></Field>
          <Field label="Ngày báo giá" required><input type="date" value={f.date} onChange={set('date')} required /></Field>
          <Field label="Khách hàng" required full><CustomerPicker value={f} onChange={(c) => setF({ ...f, ...c })} required /></Field>
          <Field label="Kính gửi (người nhận)"><input value={f.attention} onChange={set('attention')} placeholder="VD: Anh Nam – Phòng mua hàng" /></Field>
          <Field label="Hiệu lực đến"><input type="date" value={f.validUntil} onChange={set('validUntil')} /></Field>
        </div>
        <div className="section-title">Dòng hàng</div>
        <ItemsTable items={f.items} onChange={(items) => setF({ ...f, items })} />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="VAT %"><input type="number" step="any" value={f.vatPct} onChange={set('vatPct')} /></Field>
          <Field label="Tổng tiền"><input value={fmtMoney(orderAmount(f)) + ' đ'} readOnly /></Field>
          <Field label="Điều kiện thanh toán"><input value={f.paymentTerms} onChange={set('paymentTerms')} placeholder="VD: Công nợ 30 ngày" /></Field>
          <Field label="Điều kiện giao hàng"><input value={f.deliveryTerms} onChange={set('deliveryTerms')} placeholder="VD: Giao tại kho KH, 3 ngày sau khi đặt" /></Field>
          <Field label="Trạng thái">
            <select value={f.status} onChange={set('status')}>{QUOTE_STATUSES.filter((s) => s !== 'Đã tạo đơn' || f.status === 'Đã tạo đơn').map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Ghi chú nội bộ"><input value={f.note} onChange={set('note')} /></Field>
          <Field label="Điều khoản in trên báo giá" full><textarea rows={2} value={f.terms} onChange={set('terms')} /></Field>
          <CustomFieldInputs fields={fields} value={f.custom} onChange={(custom) => setF({ ...f, custom })} />
        </div>
        <div style={{ marginTop: 10 }}><AddFieldButton module="quotes" label="+ Thêm trường cho báo giá" /></div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>Lưu & In</button>
          <button className="btn primary" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Mở cửa sổ in báo giá (in ra giấy hoặc "Lưu thành PDF" để gửi khách)
export function printQuote(q, config, staffName) {
  const cols = config.customFields.items || [];
  const sub = (q.items || []).reduce((s, it) => s + num(it.qtyKg) * num(it.priceKg), 0);
  const vat = sub * num(q.vatPct) / 100;
  const rows = (q.items || []).map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(it.productCode)}</td><td>${esc(it.product)}</td><td>${esc(it.grade)}</td>
      ${cols.map((c) => `<td>${esc(c.type === 'checkbox' ? (it.custom?.[c.key] ? '✓' : '') : it.custom?.[c.key] ?? '')}</td>`).join('')}
      <td class="r">${fmtNum(it.qtyKg, 0)}</td><td class="r">${fmtMoney(it.priceKg)}</td><td class="r">${fmtMoney(num(it.qtyKg) * num(it.priceKg))}</td></tr>`).join('');
  const span = 4 + cols.length + 2;
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(q.quoteNo)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}
    .head{display:flex;justify-content:space-between;border-bottom:2px solid #14213d;padding-bottom:10px}
    .co{font-size:16px;font-weight:700;color:#14213d} h1{text-align:center;font-size:22px;margin:22px 0 4px;letter-spacing:1px}
    .no{text-align:center;color:#555;margin-bottom:16px} table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #999;padding:6px 8px} th{background:#eef1f5} .r{text-align:right} .c{text-align:center}
    .info td{border:none;padding:3px 0} .sign{display:flex;justify-content:space-between;margin-top:40px;text-align:center}
    .sign div{width:40%} @media print{body{margin:12mm} .noprint{display:none}}
  </style></head><body>
  <div class="head"><div><div class="co">${esc(config.companyName)}</div>
    <div>${esc(config.companyAddress)}</div><div>${config.companyPhone ? 'ĐT: ' + esc(config.companyPhone) : ''} ${config.companyTaxCode ? ' · MST: ' + esc(config.companyTaxCode) : ''}</div></div>
    <div style="text-align:right">Ngày: ${fmtDate(q.date)}<br>Hiệu lực đến: ${fmtDate(q.validUntil)}</div></div>
  <h1>BẢNG BÁO GIÁ</h1><div class="no">Số: ${esc(q.quoteNo)}</div>
  <table class="info"><tr><td style="width:130px">Kính gửi:</td><td><b>${esc(q.customerName)}</b></td></tr>
    ${q.attention ? `<tr><td>Người nhận:</td><td>${esc(q.attention)}</td></tr>` : ''}
    <tr><td>Nhân viên phụ trách:</td><td>${esc(staffName(q.ownerEmail))}</td></tr></table>
  <p>Chúng tôi xin trân trọng gửi đến Quý khách bảng báo giá như sau:</p>
  <table><thead><tr><th>STT</th><th>Mã hàng</th><th>Tên hàng</th><th>Grade</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}
    <th>SL (kg)</th><th>Đơn giá (đ/kg)</th><th>Thành tiền (đ)</th></tr></thead>
  <tbody>${rows}
    <tr><td colspan="${span}" class="r">Cộng tiền hàng</td><td class="r">${fmtMoney(sub)}</td></tr>
    ${num(q.vatPct) ? `<tr><td colspan="${span}" class="r">Thuế GTGT ${num(q.vatPct)}%</td><td class="r">${fmtMoney(vat)}</td></tr>` : ''}
    <tr><td colspan="${span}" class="r"><b>Tổng cộng</b></td><td class="r"><b>${fmtMoney(sub + vat)}</b></td></tr></tbody></table>
  ${q.paymentTerms ? `<p><b>Thanh toán:</b> ${esc(q.paymentTerms)}</p>` : ''}
  ${q.deliveryTerms ? `<p><b>Giao hàng:</b> ${esc(q.deliveryTerms)}</p>` : ''}
  ${q.terms ? `<p><b>Ghi chú:</b> ${esc(q.terms).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="sign"><div><b>XÁC NHẬN CỦA KHÁCH HÀNG</b><br><i>(Ký, ghi rõ họ tên)</i></div>
    <div><b>${esc(config.companyName)}</b><br><i>(Ký, ghi rõ họ tên)</i><br><br><br><br>${esc(staffName(q.ownerEmail))}</div></div>
  <p class="noprint" style="margin-top:30px;text-align:center"><button onclick="window.print()" style="padding:8px 20px;font-size:14px">In / Lưu PDF</button></p>
  <script>setTimeout(()=>window.print(),300)</script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return alert('Trình duyệt đang chặn cửa sổ bật lên. Hãy cho phép pop-up để in báo giá.');
  w.document.write(html);
  w.document.close();
}

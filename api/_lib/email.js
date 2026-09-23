// Dựng HTML email báo cáo ngày (không phụ thuộc Firebase để dễ kiểm thử)
import { fmtDate, fmtMoney, fmtTon, num, orderAmount, orderKg, REVENUE_STATUSES } from '../../src/lib/utils.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const th = 'style="background:#f1f4f8;padding:6px 8px;border:1px solid #dde3ea;text-align:left;font-size:12px;color:#445"';
const td = 'style="padding:6px 8px;border:1px solid #dde3ea;font-size:13px;vertical-align:top"';
const tdr = 'style="padding:6px 8px;border:1px solid #dde3ea;font-size:13px;text-align:right;white-space:nowrap"';
const table = (head, rows) => rows.length
  ? `<table cellspacing="0" style="border-collapse:collapse;width:100%;margin:6px 0 16px">${head}${rows.join('')}</table>`
  : '<p style="color:#888;font-size:13px">Không có.</p>';
const h = (t) => `<h3 style="font-size:15px;margin:18px 0 6px;color:#14213d">${t}</h3>`;

export function renderEmail({ rep, date, config, data, appUrl }) {
  const t = rep.total;
  const cf = config.customFields || {};
  const extraCols = (list) => (list || []);
  const card = (label, value, color = '#1565c0') =>
    `<td style="padding:10px 12px;border:1px solid #e3e7ed;border-left:4px solid ${color};background:#fff"><div style="font-size:12px;color:#6b7684">${label}</div><div style="font-size:18px;font-weight:700">${value}</div></td>`;

  const missing = rep.staff.filter((s) => s.role !== 'admin' && s.notes === 0);
  const silent = rep.staff.filter((s) => s.role !== 'admin' && s.activities === 0 && s.orders === 0 && s.quotes === 0 && s.collected === 0);

  let html = `<div style="font-family:Arial,sans-serif;color:#1c2430;max-width:960px">
  <h2 style="margin:0 0 4px;color:#14213d">Báo cáo công việc Sale ngày ${fmtDate(date)}</h2>
  <div style="color:#6b7684;font-size:13px;margin-bottom:12px">${esc(config.companyName)} · tự động tổng hợp từ dữ liệu nhân viên nhập trong ngày</div>
  <table cellspacing="6" style="width:100%"><tr>
    ${card('Doanh số (đơn chốt)', fmtMoney(t.amount || 0) + ' đ', '#2e7d32')}
    ${card('Sản lượng', fmtTon(t.kg || 0) + ' tấn', '#2e7d32')}
    ${card('Đã thu', fmtMoney(t.collected || 0) + ' đ', '#b26a00')}
    ${card('Hoạt động KH', `${t.activities || 0} <span style="font-size:12px;font-weight:400">(${t.newCustomers || 0} KH mới)</span>`)}
    ${card('Việc quá hạn', t.tasksOverdue || 0, '#c62828')}
  </tr></table>`;

  if (missing.length || silent.length) {
    html += `<div style="background:#fdecea;color:#c62828;padding:8px 12px;border-radius:6px;font-size:13px;margin:8px 0">
      ${missing.length ? `<div>Chưa gửi báo cáo ngày: <b>${missing.map((s) => esc(s.name)).join(', ')}</b></div>` : ''}
      ${silent.length ? `<div>Không có hoạt động/đơn hàng nào: <b>${silent.map((s) => esc(s.name)).join(', ')}</b></div>` : ''}
    </div>`;
  }

  html += h('Kết quả theo nhân viên') + table(
    `<tr><th ${th}>Nhân viên</th><th ${th}>Hoạt động</th><th ${th}>Báo giá</th><th ${th}>Đơn chốt</th><th ${th}>Tấn</th><th ${th}>Doanh số</th><th ${th}>Đã thu</th><th ${th}>Việc xong</th><th ${th}>Việc quá hạn</th><th ${th}>Báo cáo</th></tr>`,
    rep.staff.map((s) => `<tr><td ${td}><b>${esc(s.name)}</b><div style="font-size:11px;color:#6b7684">${esc(Object.entries(s.byType).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div></td>
      <td ${tdr}>${s.activities}</td><td ${tdr}>${s.quotes}</td><td ${tdr}>${s.orders}</td><td ${tdr}>${fmtTon(s.kg)}</td>
      <td ${tdr}>${fmtMoney(s.amount)}</td><td ${tdr}>${fmtMoney(s.collected)}</td><td ${tdr}>${s.tasksDone}</td>
      <td ${tdr}>${s.tasksOverdue ? `<b style="color:#c62828">${s.tasksOverdue}</b>` : 0}</td><td ${tdr}>${s.notes ? '✔' : '<span style="color:#c62828">✖</span>'}</td></tr>`)
  );

  if (config.reportIncludeDetails !== false) {
    const name = (e) => esc(data.staffList.find((s) => s.email === e)?.name || e);
    const custom = (list, r) => extraCols(list).map((f) => `<td ${td}>${esc(f.type === 'checkbox' ? (r.custom?.[f.key] ? '✓' : '') : r.custom?.[f.key] ?? '')}</td>`).join('');
    const customHead = (list) => extraCols(list).map((f) => `<th ${th}>${esc(f.label)}</th>`).join('');

    html += h('Báo cáo ngày của nhân viên') + (data.notes.length
      ? data.notes.map((n) => `<div style="border:1px solid #e3e7ed;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:13px">
          <b>${name(n.ownerEmail)}</b>
          ${n.summary ? `<div><b>Đã làm:</b> ${esc(n.summary).replace(/\n/g, '<br>')}</div>` : ''}
          ${n.issues ? `<div><b>Khó khăn/Đề xuất:</b> ${esc(n.issues).replace(/\n/g, '<br>')}</div>` : ''}
          ${n.plan ? `<div><b>Kế hoạch mai:</b> ${esc(n.plan).replace(/\n/g, '<br>')}</div>` : ''}
          ${extraCols(cf.dailyNotes).filter((f) => n.custom?.[f.key]).map((f) => `<div><b>${esc(f.label)}:</b> ${esc(n.custom[f.key])}</div>`).join('')}
        </div>`).join('')
      : '<p style="color:#888;font-size:13px">Không có.</p>');

    html += h('Đơn hàng / báo giá') + table(
      `<tr><th ${th}>Số ĐH</th><th ${th}>NV</th><th ${th}>Khách hàng</th><th ${th}>Sản phẩm</th><th ${th}>Tấn</th><th ${th}>Tổng tiền</th><th ${th}>Trạng thái</th>${customHead(cf.orders)}</tr>`,
      data.orders.map((o) => `<tr><td ${td}>${esc(o.orderNo)}</td><td ${td}>${name(o.ownerEmail)}</td><td ${td}>${esc(o.customerName)}</td>
        <td ${td}>${esc((o.items || []).map((i) => `${i.product} ${i.grade || ''} ${num(i.qtyKg).toLocaleString('vi-VN')}kg × ${fmtMoney(i.priceKg)}`).join('; '))}</td>
        <td ${tdr}>${fmtTon(orderKg(o))}</td><td ${tdr}>${fmtMoney(orderAmount(o))}</td>
        <td ${td}>${REVENUE_STATUSES.includes(o.status) ? `<b style="color:#2e7d32">${esc(o.status)}</b>` : esc(o.status)}</td>${custom(cf.orders, o)}</tr>`)
    );

    html += h('Thu tiền') + table(
      `<tr><th ${th}>NV</th><th ${th}>Khách hàng</th><th ${th}>Số tiền</th><th ${th}>Hình thức</th><th ${th}>Ghi chú</th>${customHead(cf.payments)}</tr>`,
      data.payments.map((p) => `<tr><td ${td}>${name(p.ownerEmail)}</td><td ${td}>${esc(p.customerName)}</td><td ${tdr}>${fmtMoney(p.amount)}</td><td ${td}>${esc(p.method)}</td><td ${td}>${esc(p.note)}</td>${custom(cf.payments, p)}</tr>`)
    );

    html += h('Hoạt động khách hàng') + table(
      `<tr><th ${th}>NV</th><th ${th}>Khách hàng</th><th ${th}>Loại</th><th ${th}>Nội dung / Kết quả</th><th ${th}>Tiếp theo</th>${customHead(cf.activities)}</tr>`,
      data.activities.map((a) => `<tr><td ${td}>${name(a.ownerEmail)}</td><td ${td}>${esc(a.customerName)}</td><td ${td}>${esc(a.type)}</td>
        <td ${td}>${esc(a.content)}${a.result ? `<div style="color:#6b7684">→ ${esc(a.result)}</div>` : ''}</td>
        <td ${td}>${esc(a.nextAction)}${a.nextDate ? ` (${fmtDate(a.nextDate)})` : ''}</td>${custom(cf.activities, a)}</tr>`)
    );

    const doneToday = data.tasks.filter((x) => x.status === 'Hoàn thành' && x.completedDate === date);
    const overdue = data.tasks.filter((x) => x.dueDate && x.dueDate < date && !['Hoàn thành', 'Hủy'].includes(x.status));
    html += h('Công việc hoàn thành trong ngày') + table(
      `<tr><th ${th}>NV</th><th ${th}>Công việc</th><th ${th}>Hạn</th></tr>`,
      doneToday.map((x) => `<tr><td ${td}>${name(x.ownerEmail)}</td><td ${td}>${esc(x.title)}</td><td ${td}>${fmtDate(x.dueDate)}</td></tr>`)
    );
    html += h('Công việc quá hạn') + table(
      `<tr><th ${th}>NV</th><th ${th}>Công việc</th><th ${th}>Hạn</th><th ${th}>Trạng thái</th><th ${th}>Tiến độ</th></tr>`,
      overdue.map((x) => `<tr><td ${td}>${name(x.ownerEmail)}</td><td ${td}>${esc(x.title)}</td><td ${td}><span style="color:#c62828">${fmtDate(x.dueDate)}</span></td><td ${td}>${esc(x.status)}</td><td ${tdr}>${num(x.progress)}%</td></tr>`)
    );
  }

  if (appUrl) html += `<p style="margin-top:20px"><a href="${esc(appUrl)}" style="background:#1565c0;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Mở ứng dụng để xem chi tiết</a></p>`;
  html += '</div>';
  return html;
}

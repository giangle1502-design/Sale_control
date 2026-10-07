import { useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { prUrgency, usePendingPurchases } from '../pages/PurchaseRequests';
import { useChatAlerts } from '../pages/Chat';
import { useColumnResize } from '../lib/colResize';

const NAV = [
  ['/', '📊', 'Tổng quan'],
  ['/tro-chuyen', '💬', 'Trò chuyện'],
  ['/nhat-ky', '📝', 'Báo cáo tuần/tháng'],
  ['/hoat-dong', '📞', 'Hoạt động KH'],
  ['/bao-gia', '📄', 'Báo giá'],
  ['/don-hang', '📦', 'Đơn hàng'],
  ['/hang-da-xuat', '🚚', 'Hàng đã xuất'],
  ['/ton-kho', '🏭', 'Tồn kho & Hàng về'],
  ['/cong-no', '💰', 'Công nợ & Thu tiền'],
  ['/cong-viec', '✅', 'Việc được giao'],
  ['/mua-hang', '🛒', 'Yêu cầu mua hàng'],
  ['/khach-hang', '👥', 'Khách hàng'],
  ['/mat-hang', '🏷️', 'Mặt hàng'],
];
const ADMIN_NAV = [
  ['/phan-tich-ban-hang', '📈', 'Phân tích bán hàng'],
  ['/nhan-vien', '🧑‍💼', 'Nhân viên'],
  ['/cai-dat', '⚙️', 'Cài đặt'],
];

export default function Layout() {
  const { profile, isAdmin, isAccountant, logout, config } = useApp();
  const [open, setOpen] = useState(false);
  const mainRef = useRef(null);
  useColumnResize(mainRef);
  const pendingPR = usePendingPurchases();
  const chat = useChatAlerts();
  const urgentPR = pendingPR.some((r) => prUrgency(r));
  const items = isAccountant ? [['/cong-no', '💰', 'Công nợ'], ['/tro-chuyen', '💬', 'Trò chuyện']] : isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <div className="shell">
      <aside className={'side' + (open ? ' open' : '')}>
        <div className="brand">{config.companyName}<small>Quản lý công việc Sale</small></div>
        <nav>
          {items.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
              <span className="ico">{icon}</span>{label}
              {to === '/tro-chuyen' && chat.unread > 0 && <span className="nav-badge urgent" title={`${chat.unread} cuộc trò chuyện có tin mới`}>{chat.unread}</span>}
              {to === '/mua-hang' && pendingPR.length > 0 && (
                <span className={'nav-badge' + (urgentPR ? ' urgent' : '')} title={`${pendingPR.length} yêu cầu đang chờ xử lý`}>{pendingPR.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div><b>{profile.name}</b><small>{profile.email}</small>
            <small className="role">{isAdmin ? 'Quản trị' : isAccountant ? 'Kế toán' : 'Nhân viên sale'}</small></div>
          <button className="btn ghost sm" onClick={logout}>Đăng xuất</button>
        </div>
      </aside>
      {open && <div className="side-bg" onClick={() => setOpen(false)} />}
      <main ref={mainRef}>
        <button className="menu-btn" onClick={() => setOpen(true)}>☰</button>
        <Outlet />
      </main>
    </div>
  );
}

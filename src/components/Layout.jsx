import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV = [
  ['/', '📊', 'Tổng quan'],
  ['/nhat-ky', '📝', 'Nhật ký ngày'],
  ['/hoat-dong', '📞', 'Hoạt động KH'],
  ['/don-hang', '📦', 'Đơn hàng'],
  ['/cong-no', '💰', 'Công nợ & Thu tiền'],
  ['/cong-viec', '✅', 'Việc được giao'],
  ['/khach-hang', '👥', 'Khách hàng'],
];
const ADMIN_NAV = [
  ['/nhan-vien', '🧑‍💼', 'Nhân viên'],
  ['/cai-dat', '⚙️', 'Cài đặt'],
];

export default function Layout() {
  const { profile, isAdmin, logout, config } = useApp();
  const [open, setOpen] = useState(false);
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <div className="shell">
      <aside className={'side' + (open ? ' open' : '')}>
        <div className="brand">{config.companyName}<small>Quản lý công việc Sale</small></div>
        <nav>
          {items.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
              <span className="ico">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div><b>{profile.name}</b><small>{profile.email}</small>
            <small className="role">{isAdmin ? 'Quản trị' : 'Nhân viên sale'}</small></div>
          <button className="btn ghost sm" onClick={logout}>Đăng xuất</button>
        </div>
      </aside>
      {open && <div className="side-bg" onClick={() => setOpen(false)} />}
      <main>
        <button className="menu-btn" onClick={() => setOpen(true)}>☰</button>
        <Outlet />
      </main>
    </div>
  );
}

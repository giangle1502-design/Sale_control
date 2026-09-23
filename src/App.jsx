import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { sendEmailVerification } from 'firebase/auth';
import { useApp } from './context/AppContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DailyNotes from './pages/DailyNotes';
import Activities from './pages/Activities';
import Orders from './pages/Orders';
import Debts from './pages/Debts';
import Tasks from './pages/Tasks';
import Customers from './pages/Customers';
import Staff from './pages/Staff';
import Settings from './pages/Settings';

export default function App() {
  const { user, allowed, isAdmin, loading, logout, email } = useApp();
  if (loading) return <div className="center">Đang tải…</div>;
  if (!user) return <Login />;
  if (!user.emailVerified) return <VerifyEmail user={user} logout={logout} />;
  if (!allowed)
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Chưa được cấp quyền</h2>
          <p>Tài khoản <b>{email}</b> chưa có trong danh sách nhân viên. Vui lòng báo quản lý thêm email này ở mục <i>Nhân viên</i>.</p>
          <button className="btn" onClick={logout}>Đăng xuất</button>
        </div>
      </div>
    );
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="nhat-ky" element={<DailyNotes />} />
        <Route path="hoat-dong" element={<Activities />} />
        <Route path="don-hang" element={<Orders />} />
        <Route path="cong-no" element={<Debts />} />
        <Route path="cong-viec" element={<Tasks />} />
        <Route path="khach-hang" element={<Customers />} />
        {isAdmin && <Route path="nhan-vien" element={<Staff />} />}
        {isAdmin && <Route path="cai-dat" element={<Settings />} />}
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}

function VerifyEmail({ user, logout }) {
  const [msg, setMsg] = useState('');
  return (
    <div className="center">
      <div className="card narrow">
        <h2>Xác nhận email</h2>
        <p>Đã gửi thư xác nhận tới <b>{user.email}</b>. Mở hộp thư (kể cả mục Spam), bấm link xác nhận rồi quay lại bấm nút bên dưới.</p>
        {msg && <div className="ok-box">{msg}</div>}
        <button className="btn primary" onClick={async () => { await user.reload(); await user.getIdToken(true); window.location.reload(); }}>
          Tôi đã xác nhận
        </button>
        <button className="btn" onClick={() => sendEmailVerification(user).then(() => setMsg('Đã gửi lại thư xác nhận.')).catch((e) => setMsg(e.message))}>
          Gửi lại thư
        </button>
        <button className="btn ghost" onClick={logout}>Đăng xuất</button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword, getRedirectResult, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
} from 'firebase/auth';
import { auth, googleProvider, inAppBrowser, isMobile, sameDomainAuth } from '../firebase';

const MSG = {
  'auth/invalid-credential': 'Sai email hoặc mật khẩu.',
  'auth/email-already-in-use': 'Email đã được đăng ký, hãy đăng nhập.',
  'auth/weak-password': 'Mật khẩu tối thiểu 6 ký tự.',
  'auth/invalid-email': 'Email không hợp lệ.',
};

export default function Login() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const explain = (e) => MSG[e.code]
    || (/initial state|storage/i.test(e.message || '') ? 'Trình duyệt chặn đăng nhập Google. Mở link bằng Chrome hoặc Safari (không mở trong Zalo/Facebook) rồi thử lại, hoặc đăng nhập bằng email + mật khẩu.' : e.message);
  const run = async (fn) => {
    setErr(''); setInfo(''); setBusy(true);
    try { await fn(); } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') setErr(explain(e));
    }
    setBusy(false);
  };
  // Kết quả đăng nhập sau khi quay về từ trang Google (điện thoại)
  useEffect(() => { getRedirectResult(auth).catch((e) => setErr(explain(e))); }, []);
  // Điện thoại dùng chuyển trang (ổn định hơn cửa sổ bật lên); máy tính dùng cửa sổ bật lên, bị chặn thì chuyển trang
  const google = async () => {
    if (sameDomainAuth) return signInWithRedirect(auth, googleProvider);
    try { await signInWithPopup(auth, googleProvider); } catch (e) {
      if (e.code === 'auth/popup-blocked' || (isMobile && e.code === 'auth/operation-not-supported-in-this-environment')) return signInWithRedirect(auth, googleProvider);
      throw e;
    }
  };
  const submit = (e) => {
    e.preventDefault();
    run(() => mode === 'login'
      ? signInWithEmailAndPassword(auth, email.trim(), pw)
      : createUserWithEmailAndPassword(auth, email.trim(), pw).then((c) => sendEmailVerification(c.user)));
  };

  return (
    <div className="center login">
      <form className="card narrow" onSubmit={submit}>
        <h2>Quản lý công việc Sale</h2>
        <p className="muted">{mode === 'login' ? 'Đăng nhập để tiếp tục' : 'Tạo mật khẩu cho email đã được quản lý cấp quyền'}</p>
        {inAppBrowser && <div className="error-box">Bạn đang mở trong Zalo/Facebook — Google không cho đăng nhập ở đây. Bấm ⋮ hoặc ··· → “Mở bằng trình duyệt” (Chrome/Safari), hoặc đăng nhập bằng email + mật khẩu bên dưới.</div>}
        <button type="button" className="btn google" disabled={busy} onClick={() => run(google)}>
          Đăng nhập bằng Google
        </button>
        <div className="or">hoặc</div>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Mật khẩu" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
        {err && <div className="error-box">{err}</div>}
        {info && <div className="ok-box">{info}</div>}
        <button className="btn primary" disabled={busy}>{mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</button>
        <div className="row-between">
          <a onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Lần đầu sử dụng? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
          </a>
          {mode === 'login' && (
            <a onClick={() => email ? run(async () => { await sendPasswordResetEmail(auth, email.trim()); setInfo('Đã gửi email đặt lại mật khẩu.'); }) : setErr('Nhập email trước.')}>
              Quên mật khẩu?
            </a>
          )}
        </div>
      </form>
    </div>
  );
}

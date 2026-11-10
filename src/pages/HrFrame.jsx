import { useParams } from 'react-router-dom';

// Các chức năng của app Nhân sự (đề nghị công tác, đặt xe, chấm công, thanh toán…) hiển thị ngay trong app này.
// /nhan-su/* được Vercel chuyển tiếp về app Nhân sự → cùng tên miền nên dùng chung đăng nhập.
export const HR_NAV = [
  ['dat-xe', '🧳', 'Đề nghị công tác · đặt xe'],
  ['lich-xe', '📅', 'Lịch xe trống'],
  ['xe', '🛻', 'Tình trạng xe'],
  ['tang-ca', '⏱', 'Tài xế: lịch chạy & tăng ca'],
  ['cham-cong', '🕘', 'Chấm công'],
  ['thanh-toan', '💳', 'Đề nghị thanh toán'],
  ['phe-duyet', '✅', 'Chờ tôi duyệt'],
];
export default function HrFrame() {
  const { page = '' } = useParams();
  return <iframe key={page} className="hr-frame" title="Nhân sự" src={`/nhan-su/${page}`} />;
}

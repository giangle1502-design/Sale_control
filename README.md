# Quản lý công việc Sale – Hạt nhựa

Web app giúp nhân viên sale ghi nhận công việc hằng ngày; quản lý xem Dashboard trực tiếp, xuất Excel và nhận **email báo cáo tự động mỗi tối**.

**Công nghệ:** React + Vite · Firebase (Auth + Firestore, realtime) · Vercel (hosting + Cron + API gửi mail) · Gmail SMTP.

## Tính năng

| Mục | Nhân viên sale | Quản lý (admin) |
|---|---|---|
| **Tổng quan** | Số liệu của mình | Toàn bộ, lọc theo NV / khoảng ngày, biểu đồ, bảng xếp hạng NV, cảnh báo ai chưa báo cáo |
| **Nhật ký ngày** | Viết: đã làm / khó khăn / kế hoạch mai (số liệu trong ngày tự tổng hợp sẵn) | Xem báo cáo của tất cả NV |
| **Hoạt động KH** | Gọi điện, gặp khách, gửi mẫu, báo giá… + hẹn việc tiếp theo | Xem/sửa tất cả |
| **Báo giá** | Tạo & in báo giá (Lưu PDF gửi khách), theo dõi trạng thái; khách đồng ý → **Xác nhận tạo đơn** | Xem tất cả, tỷ lệ chốt |
| **Đơn hàng** | Đơn chốt (từ báo giá hoặc tạo trực tiếp), dòng hàng có cột phụ tùy chỉnh (Lot, Nhà sản xuất…), VAT, công nợ | Xem/sửa tất cả |
| **Công nợ & Thu tiền** | Xem công nợ khách của mình (số liệu kế toán), ghi phiếu thu | **Nhập file Excel công nợ từ phần mềm kế toán** (tự dò cột, gán NV theo Mã KH) |
| **Việc được giao** | Cập nhật trạng thái, % tiến độ, ghi chú tiến độ | Giao việc, hạn chót, ưu tiên, theo dõi quá hạn |
| **Khách hàng** | Khách của mình, phân loại Khách cũ (đã bán) / Khách mới (đang chào) — tự chuyển thành Khách cũ khi chốt đơn | **Xuất Excel → điền Email NV phụ trách → Nhập lại** để phân bổ khách cho sale |
| **Nhân viên** | – | Thêm email NV, phân quyền, khóa tài khoản |
| **Cài đặt** | – | Danh sách email nhận báo cáo, **trường tự thêm** cho từng mục, danh mục loại hoạt động / loại hạt / nguồn KH |

- **Thêm trường ngay trong form:** quản trị bấm "+ Thêm trường" / "+ Thêm cột" trong form Khách hàng, Báo giá, Đơn hàng.
- **Trường tự thêm:** Cài đặt → "Trường thông tin tự thêm" → chọn mục (Hoạt động, Đơn hàng, Thu tiền, Công việc, Khách hàng, Báo cáo ngày) → thêm trường (chữ, số, ngày, danh sách chọn, có/không). Trường mới tự hiện trong form, bảng, Excel và email.
- **Xuất Excel:** mỗi trang có nút ⬇ Excel; trang Tổng quan xuất báo cáo nhiều sheet (tổng hợp theo NV, theo ngày, theo loại hạt, theo KH và dữ liệu chi tiết).
- **Email tối:** ~20:00 giờ VN gửi tới **danh sách email bạn tự nhập** trong Cài đặt. Có nút "Gửi thử" cho ngày bất kỳ.

---

## Triển khai (khoảng 20–30 phút)

### 1. Tạo project Firebase
1. Vào https://console.firebase.google.com → **Add project** (nên tạo project mới, tách khỏi QLVT). Chọn region Firestore `asia-southeast1` (Singapore).
2. **Build → Authentication → Get started**, bật 2 provider: **Google** và **Email/Password**.
3. **Build → Firestore Database → Create database** (production mode).
4. **Project settings → Your apps → Web (</>)** → đăng ký app → copy các giá trị `firebaseConfig`.

### 2. Cài đặt code
```bash
npm install
cp .env.example .env.local   # điền các biến VITE_FIREBASE_* vừa copy
npm run dev                  # chạy thử tại http://localhost:5173
```

### 3. Đẩy rules + index lên Firebase
Mở `firestore.rules`, sửa dòng `superAdmins()` nếu muốn thêm email quản trị gốc (phải khớp `VITE_SUPER_ADMINS`). Sau đó:
```bash
npm i -g firebase-tools
firebase login
firebase use --add            # chọn project vừa tạo
firebase deploy --only firestore:rules,firestore:indexes
```

### 4. Deploy lên Vercel
1. Đẩy code lên GitHub (vd. `giangle1502-design/sales-tracker`), Vercel → **Add New Project** → import repo (Framework: Vite).
2. **Settings → Environment Variables**, khai báo:

| Biến | Giá trị |
|---|---|
| `VITE_FIREBASE_*` (6 biến) | Như file `.env.local` |
| `VITE_SUPER_ADMINS`, `SUPER_ADMINS` | `giangle1502@gmail.com` |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase → Project settings → **Service accounts → Generate new private key** → mở file JSON, dán **toàn bộ nội dung** |
| `SMTP_USER` | Gmail dùng để gửi báo cáo |
| `SMTP_PASS` | **App Password** 16 ký tự của Gmail đó (Google Account → Security → bật 2-Step Verification → App passwords) |
| `CRON_SECRET` | Chuỗi ngẫu nhiên bất kỳ (Vercel tự gửi kèm khi chạy Cron) |
| `APP_URL` | Link app, vd. `https://sales-tracker.vercel.app` |

3. Redeploy. Firebase → Authentication → **Settings → Authorized domains** → thêm domain `*.vercel.app` của app.

### 5. Bắt đầu dùng
1. Đăng nhập bằng `giangle1502@gmail.com` (Google) → mục **Nhân viên** → thêm email từng nhân viên sale.
2. **Cài đặt** → nhập danh sách email nhận báo cáo → Lưu → bấm **Gửi thử** để kiểm tra.
3. Gửi link app cho nhân viên: dùng Gmail thì "Đăng nhập bằng Google"; email khác thì bấm "Đăng ký", đặt mật khẩu và bấm link xác nhận trong hộp thư.

## Giờ gửi email
`vercel.json` → `"schedule": "0 13 * * *"` (giờ UTC = 20:00 giờ VN). Đổi giờ: VN trừ 7 tiếng, vd. 18:00 VN → `0 11 * * *`. Gói Vercel Hobby cho phép cron 1 lần/ngày và có thể chạy lệch trong khung 1 giờ đó.

## Phân quyền dữ liệu (firestore.rules)
- Sale chỉ đọc/sửa dữ liệu `ownerEmail` của chính mình; không xem được dữ liệu người khác.
- Với việc quản lý giao, sale chỉ đổi được trạng thái / tiến độ / ghi chú, không sửa được tên việc hay hạn chót.
- Chỉ admin quản lý nhân viên và cài đặt. Tài khoản email/mật khẩu phải xác nhận email mới vào được.

## Cấu trúc
```
api/daily-report.js      API gửi email (Vercel Cron + nút Gửi thử)
api/_lib/email.js        Mẫu HTML email
src/lib/report.js        Tổng hợp số liệu (dùng chung Dashboard và email)
src/pages/*              Các trang
firestore.rules          Phân quyền
firestore.indexes.json   Chỉ mục truy vấn
```

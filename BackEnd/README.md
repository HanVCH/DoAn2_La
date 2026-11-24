# Backend LÁ

Node.js + Express, MySQL/MariaDB qua mysql2/promise. Frontend EJS hiện tại được phục vụ cùng process trong ../FontEnd/app.js.

- config.js: kiểm tra biến môi trường; database bắt buộc tên qlthuchi.
- db/database.js: pool, placeholder, BIGINT chuỗi và SET time_zone UTC trên mỗi lần lấy connection.
- db/schema.sql: SQL mới được cung cấp, có 6 bảng, 8 procedure auth + 5 onboarding, trigger hủy xác thực khi liên hệ đổi; demo tách riêng.
- db/demo.sql: seed demo tùy chọn, không ghi đè tài khoản cũ.
- db/schema-tools.js: import delimiter và kiểm tra cấu trúc trước/sau migration.
- db/migrate.js, db/check.js: lệnh khởi tạo thủ công và kiểm tra chỉ đọc.
- validators/: quy tắc email/SĐT/mật khẩu, dùng chung với browser qua shared/auth-policy.mjs.
- routes/, controllers/: HTTP API và trang recovery tương thích giao diện cũ.
- middleware/: CSRF, CORS đúng origin, rate limits, kiểm tra session, lỗi JSON an toàn.
- services/: bcrypt cost 12, xác minh Argon2id, token SHA-256 và Nodemailer SMTP.
- services/onboarding.js: state, hồ sơ, OTP HMAC và hoàn tất qua procedure; services/sms.js: adapter Twilio bật bằng cấu hình.
- middleware/onboarding.js: gate trang/API nghiệp vụ, dùng trạng thái từ database.
- routes/onboarding.js: các API GET/PUT/POST có session, CSRF và rate limit.
- scripts/configure-otp.js: tạo khóa ổn định trong .env, không log/ghi đè khóa đã có.
- ../FontEnd/views/onboarding.ejs: trang thiết lập responsive; trang Tổng quan hiện nằm ở views/pages/overview.ejs trong app-layout.ejs.
- ../FontEnd/routes/app-pages.js: bảo vệ cả 9 trang; ../shared/app-navigation.mjs đồng bộ route/menu, HOME_PATH mặc định /dashboard, / là alias có guard.
- ../shared/profile-policy.mjs: kiểm tra ngày sinh/tuổi, Unicode, thu nhập thập phân và mục đích dùng chung với frontend.

Procedure tự quản lý transaction; Node không bao transaction ngoài CALL. Reset tăng auth_version và thu hồi phiên/token trong cùng transaction SQL.

Dữ liệu SQLite cũ trong data/ được giữ nguyên và không còn được ứng dụng đọc. Không tự chuyển tài khoản hay ghi đè mật khẩu sang MySQL.

Xem [README gốc](../README.md) để cấu hình XAMPP, SMTP, API và chạy kiểm thử.

# LÁ · Quản lý thu chi cá nhân

Backend Node.js/Express cho giao diện EJS hiện tại: đăng ký, đăng nhập hai bước bằng email/SĐT, quên/đặt lại mật khẩu, thiết lập hồ sơ bắt buộc và xác thực liên hệ bằng OTP. Database **MariaDB/MySQL trong XAMPP, tên chính xác `qlthuchi`**.

## Cài đặt và chạy trên Windows

Cần Node.js >= 22.15, npm và MySQL/MariaDB (XAMPP). Mã nguồn không cần build.

```powershell
cd D:\DoAn2
npm.cmd install
# File .env đã được tạo nếu trước đó chưa có. Khi cài ở máy khác:
# Copy-Item .env.example .env
```

Điền `DB_USER`, `DB_PASSWORD`, kiểm tra `DB_PORT` trong `.env`. Đây là **tài khoản MySQL**, khác với tài khoản SQL Server `sa` hay instance `VAN-CONG-HAN\SQLEXPRESS`.

1. Mở XAMPP Control Panel (trên máy hiện tại: `D:\xampp\xampp-control.exe`), bật **MySQL**.
2. Xem cổng MySQL; mặc định 3306. Nếu đổi cổng, cập nhật `DB_PORT`.
3. XAMPP chưa đổi thiết lập thường dùng user `root`, mật khẩu trống. Chỉ dùng nếu đúng với cấu hình MySQL của bạn. Ứng dụng không tự đoán hay thử mật khẩu.
4. Khởi tạo schema **một lần, bằng lệnh chủ động**:

```powershell
npm.cmd run db:migrate
npm.cmd run db:check
npm.cmd run otp:configure
npm.cmd run dev
```

Mở **http://localhost:3000/register** hoặc **http://localhost:3000/login**. `npm.cmd start` chạy không watch. Một Express process phục vụ frontend và API cùng origin. Các lệnh tự đọc `.env`; biến shell có ưu tiên cao hơn.

Không cần Apache để chạy Node. Chỉ bật Apache nếu dùng phpMyAdmin. Nếu dùng `127.0.0.1` thay cho `localhost`, đặt cả `APP_BASE_URL` và `FRONTEND_ORIGIN` tương ứng để Origin và cookie thống nhất.

## Import SQL và giữ dữ liệu

File dự án [BackEnd/db/schema.sql](BackEnd/db/schema.sql) lấy từ SQL được cung cấp, đổi tham chiếu database `la_finance` sang `qlthuchi`, giữ tên bảng/cột/procedure `la_auth_*`. Demo được tách riêng.

Có thể import `schema.sql` qua phpMyAdmin > Import > UTF-8 thay cho `db:migrate`. Lệnh `db:check` chỉ đọc cấu trúc và kiểm tra các bảng, thủ tục cùng trigger bắt buộc.

- Không DROP database/bảng hoặc ghi đè tài khoản/mật khẩu trong script ứng dụng.
- `CREATE TABLE IF NOT EXISTS` giữ dữ liệu. Import chủ động sẽ thay định nghĩa procedure bằng `DROP PROCEDURE IF EXISTS` + `CREATE PROCEDURE`.
- `db:migrate` kiểm tra bảng cũ trước khi import; migration mới chủ động thêm `phone_verified_at` và `onboarding_completed_at` nếu thiếu bằng information_schema. Những khác biệt cấu trúc khác sẽ làm script dừng để viết migration riêng sau khi sao lưu. Không tự sửa kiểu dữ liệu người dùng hay đánh dấu tài khoản cũ đã xác thực/hoàn tất.
- **Khởi động server không chạy migration/seed.**
- SQLite cũ trong `BackEnd/data/` được giữ nguyên, không còn là nguồn dữ liệu đăng nhập. Không tự chuyển hay ghi đè tài khoản giữa SQLite và MySQL.
- Khi import phpMyAdmin trực tiếp, cần tự kiểm tra bảng đã tồn tại; `CREATE TABLE IF NOT EXISTS` không nâng cấp cấu trúc cũ.

Demo tùy chọn: import [BackEnd/db/demo.sql](BackEnd/db/demo.sql) sau schema. Email `demo.la@example.com`, SĐT `0901234567`, mật khẩu ban đầu `LaDemo@123456`. Nếu email/SĐT đã tồn tại, script bỏ qua và giữ mật khẩu hiện tại. Email example.com không phải hộp thư để kiểm tra nhận thư.

## Biến môi trường

| Biến | Cấu hình |
| --- | --- |
| `PORT` | HTTP, mặc định 3000 |
| `DB_HOST` | Mặc định 127.0.0.1 |
| `DB_PORT` | Cổng MySQL, mặc định 3306 |
| `DB_NAME` | Bắt buộc `qlthuchi` |
| `DB_USER`, `DB_PASSWORD` | Tài khoản MySQL thực tế; DB_USER phải được điền |
| `FRONTEND_ORIGIN` | Origin frontend chính xác, mặc định http://localhost:3000 |
| `APP_BASE_URL` | Origin đáng tin cậy cho link email, không path/query; production dùng HTTPS |
| `SESSION_TTL_MINUTES` | 10080 (7 ngày); giới hạn 1–43200 |
| `HOME_PATH` | Route Tổng quan được bảo vệ, mặc định `/dashboard`; giá trị cũ `/` được chuẩn hóa về `/dashboard` |
| `OTP_PEPPER` | Bí mật ổn định, ít nhất 32 byte ngẫu nhiên; tạo bằng `npm run otp:configure` |
| `SMS_ENABLED` | `false` mặc định; chỉ bật khi đã có dịch vụ SMS thật |
| `SMS_TWILIO_ACCOUNT_SID`, `SMS_TWILIO_AUTH_TOKEN`, `SMS_TWILIO_FROM` | Cấu hình adapter Twilio tùy chọn; số gửi được nhà cung cấp cho phép |
| `COOKIE_SECURE` | true khi HTTPS; production luôn bật dù cấu hình false |
| `SMTP_HOST`, `SMTP_PORT` | Máy chủ SMTP thực; cổng thường 587 hoặc 465 |
| `SMTP_SECURE` | true cho TLS trực tiếp (465), false cho STARTTLS (587) |
| `SMTP_REQUIRE_TLS` | Mặc định true; false chỉ cho SMTP kiểm thử loopback không TLS |
| `SMTP_USER`, `SMTP_PASS` | Tài khoản SMTP và mật khẩu ứng dụng theo nhà cung cấp |
| `MAIL_FROM` | Địa chỉ gửi được SMTP cho phép, ví dụ LÁ <your-email@gmail.com> |
| `SUPPORT_EMAIL` | Email hỗ trợ tùy chọn |
| `NODE_ENV` | production khi triển khai |

Ví dụ Gmail SMTP: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER` là email của bạn, `SMTP_PASS` là mật khẩu ứng dụng nếu nhà cung cấp yêu cầu, `MAIL_FROM` cùng địa chỉ gửi được cho phép. Điền bí mật trực tiếp trong `.env`; không đưa lên Git hay frontend.

Thiếu SMTP hoặc APP_BASE_URL: quên mật khẩu trả 503 `MAIL_NOT_CONFIGURED`; đăng ký/đăng nhập vẫn hoạt động. Chỉ báo gửi thành công khi SMTP tiếp nhận thư. SMTP tiếp nhận chưa bảo đảm thư vào Inbox; cần kiểm tra Spam. Nếu gửi lỗi, backend thu hồi đúng token vừa tạo bằng `reset_id` và trả 502 `MAIL_SEND_FAILED`.

`AUTH_REGISTER_URL`/`AUTH_LOGIN_URL` là adapter cũ tùy chọn; **để trống cả hai để dùng trọn bộ API MySQL và UI hai bước hiện tại**. Adapter ngoài cần tích hợp riêng luồng check/recovery/session. `GOOGLE_AUTH_URL`/`FACEBOOK_AUTH_URL` chỉ dùng khi đã có dịch vụ OAuth thật; mặc định trả thông báo chưa kết nối. Gmail trong biểu mẫu dùng mật khẩu LÁ, không phải mật khẩu Gmail.

## API

Response thống nhất:

```json
{
  "success": true,
  "code": "REGISTER_SUCCESS",
  "message": "Đăng ký thành công. Vui lòng đăng nhập.",
  "data": { "user": { "id": "1", "email": "ban@gmail.com", "phone": "+84901234567" } },
  "redirectTo": "/login"
}
```

ID luôn là chuỗi để bảo toàn BIGINT UNSIGNED. Không trả password hash, session token, reset token hoặc lỗi SQL trong JSON. Token CSRF riêng được cung cấp cho frontend qua meta trang hoặc endpoint CSRF.

| Method | Endpoint | Body / kết quả |
| --- | --- | --- |
| GET | `/api/auth/csrf` | `data.csrfToken` và cookie CSRF cho client tách origin |
| POST | `/api/auth/register` | `{email,phone,password,confirmPassword}`; 201, redirectTo /login |
| POST | `/api/auth/login/check` | `{type:"email"\|"phone",identifier}`; code và `data.allow_password` boolean |
| POST | `/api/auth/login` | `{type,identifier,password}`; cookie HttpOnly, `data.user` |
| POST | `/api/auth/forgot-password` | `{identifier}`; email/SĐT chuẩn hóa, gửi email đến địa chỉ SQL trả về |
| GET | `/api/auth/reset-password/validate?token=...` | 200 `RESET_TOKEN_VALID` hoặc 400 `INVALID_RESET_TOKEN`; không tiêu thụ token |
| POST | `/api/auth/reset-password` | `{token,newPassword,confirmPassword}`; đổi mật khẩu, redirectTo /login |
| GET | `/api/auth/me` | `data.user` an toàn hoặc 401 |
| POST | `/api/auth/logout` | Thu hồi phiên hiện tại, xóa cookie; gọi lại được |

Tương thích frontend cũ: `POST /forgot-password`, `POST /reset-password`, `GET /api/auth/session` dùng chung nghiệp vụ. API đăng ký nhận thêm tên trường cũ `passwordConfirmation`; reset nhận thêm `password`/`passwordConfirmation`. Giao diện hiện tại gửi đúng trường chuẩn khi đăng ký và dùng adapter response cho recovery.

`login/check` trả 200 cho email/SĐT hợp lệ nhưng chưa đăng ký, `success=true`, `allow_password=false`; chỉ `PASSWORD_REQUIRED` mới mở mật khẩu. Đầu vào sai trả 400, tài khoản bị khóa 403. Check không xác thực và không tạo phiên.

Đăng ký trùng email/SĐT trả 409 `EMAIL_ALREADY_USED`/`PHONE_ALREADY_USED` dựa trên UNIQUE constraint, kể cả request đồng thời. Sai mật khẩu trả 401 `INVALID_PASSWORD`. Login luôn kiểm tra lại SQL và mật khẩu, kể cả client bỏ qua check.

Quên mật khẩu chưa đăng ký trả 404 `ACCOUNT_NOT_FOUND` và `redirectTo:'/login'`. Tài khoản disabled/OAuth-only không nhận token. Cách trả khác nhau này cho phép nhận biết tài khoản tồn tại, đúng luồng sản phẩm yêu cầu.

Frontend chỉ điều hướng theo `redirectTo` sau khi xử lý response phù hợp. Thành công đăng ký/reset chuyển về /login; lỗi không có tài khoản trong recovery cũng chuyển /login. Login và /me trả `data.needs_onboarding`, `profile_complete`, `contact_verified`, `onboarding_completed_at` và `redirectTo`. Sau login, trình duyệt đọc lại /me rồi chuyển tới /onboarding hoặc HOME_PATH theo database. Trang Tổng quan hiện tại là khung giao diện; các chỉ số tài chính chưa có nguồn dữ liệu được để trống bằng “—”.

Ví dụ gọi từ trình duyệt, cùng origin hoặc frontend origin đã cho phép:

```js
const API = 'http://localhost:3000';
const { data: csrf } = await fetch(API + '/api/auth/csrf', {
  credentials: 'include'
}).then(r => r.json());

const response = await fetch(API + '/api/auth/login/check', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf.csrfToken
  },
  body: JSON.stringify({ type: 'phone', identifier: '0901234567' })
});
const result = await response.json();
// Khi result.data.allow_password === true: mở ô mật khẩu,
// rồi POST /api/auth/login với cùng type/identifier và password.
```

Mọi POST, kể cả logout, cần cookie + `X-CSRF-Token`. Với trang EJS, token có tại `meta[name="csrf-token"]`. CORS cho phép origin cấu hình và credentials, không dùng wildcard. SameSite=Lax phù hợp cùng site (ví dụ frontend/API khác port localhost); frontend và API ở site khác cần thiết kế cookie/CSRF riêng.

## Bảo mật và dữ liệu

Email trim/lowercase, tối đa 254 ký tự ASCII; giữ dấu chấm và +tag. SĐT là chuỗi, bỏ khoảng trắng/.()-; 0901234567, 84901234567, +84901234567 đều thành +84901234567. Số quốc tế khác cần dạng E.164. Cùng quy tắc cho đăng ký/login/recovery.

Mật khẩu tối thiểu 8 ký tự, tối đa 72 byte UTF-8, không trim/lowercase. Hash mới bcrypt cost 12; xác minh hash Argon2id cũ bằng argon2; hash sai định dạng/không hỗ trợ bị từ chối. Không lưu confirmPassword.

Pool dùng placeholder và đặt `SET time_zone = '+00:00'` trước mỗi truy vấn trên connection. Driver dùng timezone UTC và BIGINT dạng chuỗi. Không bao transaction ngoài các procedure tự quản lý transaction.

Token session/reset ngẫu nhiên 32 byte, database chỉ lưu SHA-256. Reset có hạn 15 phút, kiểm tra trạng thái người dùng và auth_version. GET không tiêu thụ token. POST gọi procedure kiểm tra lại trong transaction; chỉ một request đồng thời dùng được token. Reset tăng auth_version và thu hồi toàn bộ session/token cũ; login đang xử lý bằng snapshot mật khẩu cũ không thể cấp session mới.

Cookie phiên HttpOnly, SameSite=Lax, Path=/; ngày hết hạn lấy trực tiếp từ SQL. HTTPS/production bật Secure. /me kiểm tra revoked/expiry/auth_version/active. Logout chỉ thu hồi phiên hiện tại.

Giới hạn JSON/form 8 KB. Rate limit trên IP: register 15/15 phút, check/login 40/15 phút, gửi mail 10/15 phút, validate/reset 60/15 phút; theo định danh: login 20/15 phút, quên mật khẩu 5/giờ. Có Retry-After. Bộ đếm giới hạn trong một process, được xóa khi restart; trước khi chạy nhiều replica cần store chung (Redis/database). UI chờ 60 giây trước gửi lại; backend áp dụng các giới hạn trên.

Không bật trust proxy đại trà. Nếu có reverse proxy, cần cấu hình proxy tin cậy cụ thể để IP rate limit đúng. Không log mật khẩu/token; che query token trong access log của proxy. Trang recovery có no-store, no-referrer, noindex; JS xóa token khỏi thanh địa chỉ và không lưu vào localStorage.

## Thiết lập hồ sơ và OTP

Tài khoản mới và tài khoản cũ chưa có hồ sơ đều phải hoàn tất một lần. /onboarding cần session; chưa đăng nhập chuyển /login. Người đã hoàn tất và còn ít nhất một liên hệ xác thực mở /onboarding sẽ về HOME_PATH. Không dùng số lần login, last_login_at, localStorage hoặc cờ client để bỏ qua.

Hồ sơ gồm họ tên Unicode, ngày sinh thật trong 120 năm gần đây, quê quán, thu nhập VND và mục đích sử dụng. Tuổi được tính từ ngày sinh, không lưu cột tuổi. Thu nhập rỗng bị từ chối, `0` hợp lệ; API nhận chuỗi số chuẩn tối đa 13 chữ số phần nguyên và 2 chữ số thập phân. DECIMAL được trả dưới dạng chuỗi, không chuyển qua số thực. Mục đích: track_expenses, save_money, control_budget, repay_debt, other; other cần mô tả.

| Method | Endpoint | Hợp đồng |
| --- | --- | --- |
| GET | `/api/onboarding` | State của chính user, cờ boolean, verification_methods và metadata challenge đang chờ để tiếp tục sau reload |
| PUT | `/api/onboarding/profile` | `{fullName,birthDate,hometown,monthlyIncome,usagePurpose,usagePurposeNote}`; chỉ lưu hồ sơ, không hoàn tất |
| POST | `/api/onboarding/verification/send` | `{channel:'email'\|'phone'}`; gửi đến liên hệ đọc từ DB |
| POST | `/api/onboarding/verification/confirm` | Xác nhận SMS bằng `{challengeId,otp}`; mã là chuỗi 6 chữ số |
| GET / POST | `/onboarding/verify-email` | Mở liên kết email và xác nhận bằng nút **Xác thực email** |
| POST | `/api/onboarding/complete` | Không cần dữ liệu xác thực trong body; procedure kiểm tra hồ sơ + liên hệ rồi đánh dấu hoàn tất |

Mọi API cần session; PUT/POST cần cookie + X-CSRF-Token như auth. user_id luôn lấy từ session; không nhận destination, token_hash, verified hoặc completed để quyết định dữ liệu. /me và logout vẫn truy cập được khi chưa thiết lập xong.

OTP tạo bằng crypto.randomInt, hạn 5 phút, tối đa 5 lần thử; gửi lại chờ 60 giây theo SQL. Database chỉ lưu HMAC-SHA256 với dữ liệu chính xác `JSON.stringify([challengeId,String(userId),channel,destination,otp])` và khóa OTP_PEPPER. Khóa chỉ ở môi trường server, không đưa vào DB/client/log. Lệnh `otp:configure` tạo 32 byte ngẫu nhiên trong .env và giữ nguyên khóa đã có; không tự xoay khóa mỗi lần start. Thiếu/khóa quá ngắn trả 503 OTP_NOT_CONFIGURED cho thao tác OTP, các luồng auth khác vẫn chạy.

Yêu cầu gửi chỉ trả challengeId, channel, destination đã che, expiresAt và resendAfterSeconds. Email xác thực gửi liên kết bằng Resend hoặc SMTP theo cấu hình, độc lập với email đặt lại mật khẩu. SMS dùng Twilio Messages API khi được bật và có đủ cấu hình. Gửi thất bại thu hồi đúng verification_id + session user_id vừa phát hành.

Mã sai trả VERIFY_CODE_INVALID với số lần thử còn lại; lần sai thứ 5 trả 429 VERIFY_ATTEMPTS_EXCEEDED. Sai mã vẫn commit số lần thử trong SQL. Mã hết hạn/thu hồi/đã dùng/khác user/liên hệ đổi/auth_version đổi bị từ chối. Hai yêu cầu dùng cùng mã chỉ một thành công. Gửi lại thu hồi mã cũ cùng kênh. VERIFY_RESEND_TOO_SOON trả 429 và Retry-After. VERIFY_ALREADY_VERIFIED yêu cầu đọc lại state.

Lưu hồ sơ và xác thực có thể theo bất kỳ thứ tự nào; chỉ nút Hoàn tất gọi la_onboarding_complete. Gọi hoàn tất đồng thời/lặp lại giữ thời điểm đầu tiên. Trigger la_users_contact_verification_guard xóa xác thực đúng kênh khi liên hệ đổi; nếu không còn kênh xác thực, xóa dấu hoàn tất. Nếu kênh khác vẫn xác thực, hồ sơ hoàn tất còn hiệu lực. Onboarding không cho thay email/SĐT; thay liên hệ cần endpoint cài đặt riêng có xác thực thích hợp.

Nút Hoàn tất tự lưu thông tin hồ sơ hợp lệ đang điền hoặc vừa sửa trước khi kiểm tra xác thực. Nếu chưa xác thực liên hệ, trang hiển thị rõ bước nhận/nhập OTP còn thiếu ngay cạnh nút. Khi email/SMS chưa được cấu hình, có thông báo tại cả phần xác thực và phần hoàn tất. Nút chỉ bị vô hiệu trong lúc tải hoặc xử lý yêu cầu; lỗi API được hiển thị để thử lại. Việc điền/lưu đủ hồ sơ không tự xác thực email/SĐT hoặc bỏ qua điều kiện hoàn tất của backend.

Tất cả API nghiệp vụ dưới /api ngoài nhóm auth/onboarding được áp dụng requireAuth + requireOnboardingCompleted trước handler. Chưa hoàn tất trả 403 ONBOARDING_REQUIRED và redirectTo /onboarding. Trang chủ SSR chuyển hướng phù hợp. Trang chủ / và HOME_PATH đều được bảo vệ; không có nháy trang chủ trước thiết lập. Không có nút Bỏ qua hoặc ngoại lệ cho demo.

Email và SMS dùng chung tối đa 5 lượt gửi mỗi ngày trên một tài khoản, làm mới lúc 00:00 giờ Việt Nam. MariaDB tính lượt khi đã tạo yêu cầu gửi, kể cả khi nhà cung cấp báo lỗi. Bấm trong thời gian chờ 60 giây chưa tạo yêu cầu mới. Gửi vẫn giới hạn 15 yêu cầu/IP/15 phút để chống spam. Xác nhận giới hạn 60 lần/IP/15 phút và 30 lần/tài khoản/15 phút. Hồ sơ và hoàn tất giới hạn 30 lần/IP/15 phút. Chạy `npm.cmd run db:migrate` để cập nhật thủ tục cấp mã trên database đã cài.

## Trang Tổng quan và điều hướng

Sau khi hoàn tất thiết lập, đăng nhập lại hoặc mở /onboarding với hồ sơ đã hoàn tất, backend chuyển tới HOME_PATH, mặc định **/dashboard**. URL cũ `/` là alias được kiểm tra session/hồ sơ trước khi chuyển về Tổng quan. Nếu cấu hình HOME_PATH riêng, /dashboard cũng chuyển tới route đó; đường dẫn không được trùng với 8 mục còn lại.

| Nhãn | Route |
| --- | --- |
| Tổng quan | /dashboard (hoặc HOME_PATH đã cấu hình) |
| Giao dịch | /transactions |
| Ngân sách | /budgets |
| Mục tiêu | /goals |
| Ví của tôi | /wallets |
| Báo cáo | /reports |
| Cài đặt | /settings |
| Trợ giúp | /help |
| Tài khoản | /account |

Cả 9 trang được bảo vệ bởi auth/onboarding middleware trên server, hỗ trợ tải lại URL trực tiếp và Back/Forward. Frontend chờ /api/auth/me trước khi hiện nội dung, có màn hình đang kiểm tra và lỗi kết nối kèm nút Thử lại; không dùng localStorage để cấp quyền. Khi quay lại tab/BFCache, trạng thái được kiểm tra lại. Đăng xuất gọi API thật và thu hồi phiên trước khi xóa thông tin hiển thị.

Layout dùng Noto Sans, các token xanh Sage và bộ icon SVG hiện có. Sidebar desktop rộng 250px, topbar dùng tên thật/chữ cái đầu từ session. Mobile dùng drawer, lớp phủ, Esc, focus trap và trả focus về nút mở. Menu tài khoản mở Tài khoản/Cài đặt/Đăng xuất. Từng trang có title và aria-current đúng; logo về Tổng quan.

Tổng quan đọc số dư, thu/chi và giao dịch gần đây từ sổ giao dịch. **Tổng thu chi** là tổng thu cộng tổng chi trong tháng. Số dư ví vẫn tính thu trừ chi. Biểu đồ hai đường thể hiện tổng thu và chi từng ngày. Trang Mục tiêu cho phép đặt số tiền cần đạt và cập nhật thủ công số tiền đã để dành. Tổng quan hiển thị 5 mục tiêu mới nhất với thanh tiến độ từ 0% đến trạng thái Tốt khi đạt mục tiêu.

Các file chính:

- `shared/app-navigation.mjs`: cấu hình chung cho nhãn, icon, nhóm menu và route.
- `FontEnd/routes/app-pages.js`: route SSR và guard cho 9 trang, alias trang chủ, màn hình lỗi kết nối server.
- `FontEnd/views/app-layout.ejs`, `partials/app/`: layout, sidebar, topbar, tiêu đề, stat card và empty state dùng chung.
- `FontEnd/views/pages/`: 9 view riêng để mở rộng từng chức năng.
- `FontEnd/public/css/app.css`, `public/js/app-shell.js`: giao diện responsive, session/retry, drawer, menu và đăng xuất.
- `tests/app-pages.spec.js`: kiểm tra truy cập 9 trang, điều hướng/history, dữ liệu tài khoản, session lỗi, drawer và logout.

Không cần build; chạy `npm.cmd start` hoặc `npm.cmd run dev`, mở http://localhost:3000/dashboard sau khi đăng nhập và hoàn tất hồ sơ. Ảnh xem trước nằm tại `artifacts/screenshots/dashboard-desktop.png`, `dashboard-mobile.png`, `dashboard-tablet.png`, `dashboard-small-mobile.png`.

## Kiểm thử

### Giao dịch và số liệu tài chính

Chạy `npm.cmd run db:migrate` rồi `npm.cmd run db:check` trên Windows khi MySQL XAMPP đang bật. Migration tạo các bảng tài chính còn thiếu và bổ sung cột icon cho danh mục đã có. Mở **Giao dịch → Thêm giao dịch**. Với tài khoản chưa có ví và danh mục, tạo bộ mặc định hoặc nhập tên của bạn trong **Quản lý ví và danh mục**. Khi tạo danh mục, chọn một biểu tượng trong bộ icon SVG của LÁ. Danh mục cũ tự hiển thị icon mặc định phù hợp.

### Ngân sách theo danh mục

Chạy `npm.cmd run db:migrate` từ `D:\DoAn2` để tạo bảng `finance_budgets`, sau đó chạy `npm.cmd run db:check` và `npm.cmd run dev`. Mở `/budgets` sau khi đăng nhập và hoàn tất hồ sơ. Mặc định trang mở tháng hiện tại theo `Asia/Ho_Chi_Minh`. Số tiền còn lại được cộng theo giá trị có dấu, và danh mục vượt hạn mức xuất hiện riêng trên Ngân sách, Tổng quan và Báo cáo. Số dư ví lấy từ sổ giao dịch.

Tạo ngân sách **Ăn uống** cho tháng trước với hạn mức **3.000.000đ** và bật **Tự động gia hạn**. Ghi nhận tổng chi **2.400.000đ** trong đúng danh mục và tháng trước. Chuyển bộ chọn sang tháng này để xem **600.000đ** tiền chuyển kỳ và **3.600.000đ** hạn mức khả dụng. Nếu tháng này đã có ngân sách tạo thủ công khi kỳ trước được gia hạn, hệ thống giữ hạn mức gốc và thiết lập của kỳ thủ công, đồng thời cập nhật tiền chuyển vào.

Backend kiểm tra kỳ đến hạn khi khởi động, mỗi giờ và khi tải dữ liệu ngân sách. Khi giao dịch chi của kỳ cũ đổi, backend tính lại phần chuyển dương của các kỳ liên quan trong cùng transaction với giao dịch. Chi vượt hạn mức chuyển **0đ** sang kỳ sau.

### Mục tiêu – Hũ chi tiêu

Chạy `npm.cmd run db:migrate` để thêm `due_date`, `note` và `deleted_at` vào `finance_goals`. Hũ cũ giữ tên, số tiền mục tiêu và số tiền đã dành. Mở `/goals` để tạo, sửa, cập nhật số tiền hoặc xóa hũ. Hũ đã xóa được lưu trong database và ẩn khỏi danh sách và Tổng quan.

Hũ mới bắt đầu từ **0đ**. Dùng **Thêm tiền vào hũ** để cộng khoản mới vào số đã dành. Dữ liệu này được nhập thủ công và dùng để theo dõi tiến độ trên Mục tiêu và Tổng quan. Ví dụ tạo hũ **Du lịch** mục tiêu **5.000.000đ**, thêm **1.500.000đ** rồi thêm **500.000đ** để thấy tiến độ **40%** và còn thiếu **3.000.000đ**. Hạn hoàn thành có ba ô **Ngày**, **Tháng**, **Năm** và có thể bỏ trống.

### Ví của tôi

Từ `D:\DoAn2`, bật MySQL trong XAMPP rồi chạy `npm.cmd run db:migrate`, `npm.cmd run db:check` và `npm.cmd run dev`. Migration bổ sung thông tin ví và bảng `finance_wallet_movements`. Ví cũ được xếp loại **Tiền mặt**, có số dư ban đầu **0đ** và tiếp tục lấy số dư từ giao dịch đã ghi.

Mở `/wallets`. Tạo ví **Tiền túi** với **1.000.000đ**, ví **Ngân hàng** với **0đ** và một thẻ tín dụng dư nợ **0đ**. Ghi giao dịch **Chi 300.000đ** bằng thẻ, chuyển **200.000đ** từ Tiền túi sang Ngân hàng rồi dùng Ngân hàng thanh toán **150.000đ** cho thẻ. Kết quả là tiền trong các ví **850.000đ**, dư nợ **150.000đ**, tiền còn lại sau khi trừ nợ thẻ **700.000đ** với bộ ví ban đầu trống. **Tổng quan** và **Báo cáo** vẫn ghi nhận chi **300.000đ** trong kỳ mua hàng. Mở **Xem lịch sử** để lọc từng dạng biến động và đối chiếu số dư đầu kỳ, cuối kỳ. Biểu đồ tính mọi biến động của kỳ ngay cả khi danh sách đang lọc một loại.

### Báo cáo chi tiêu

Mở `/reports` và chọn **Tháng**, **Năm**. Tháng hiện tại lấy dữ liệu đến hết ngày hôm nay theo giờ Việt Nam. Để đối chiếu với Giao dịch, chọn loại **Chi**, từ ngày đầu tháng đến ngày hiển thị sau nhãn **Tính đến hôm nay**. Với các tháng đã qua, lọc hết tháng.

Thử trên một kỳ chưa có giao dịch. Thêm các khoản chi **4.000.000đ**, **5.000.000đ**, **6.000.000đ** lần lượt vào tháng 10, 11, 12 năm 2024. Tháng 1/2025 thêm **Ăn uống 2.400.000đ** và **Đi lại 3.600.000đ**. Mở Báo cáo tháng 1/2025 để thấy Ăn uống **40%**, Đi lại **60%** và bốn cột từ tháng 10/2024 đến tháng 1/2025. Chọn trung bình ba tháng trước để thấy mốc **5.000.000đ** và mức tăng **1.000.000đ (+20%)**.

### Cài đặt tài khoản

Từ `D:\DoAn2`, bật MySQL trong XAMPP rồi chạy `npm.cmd run db:migrate`, `npm.cmd run db:check` và `npm.cmd run dev`. Migration thêm `user_finance_settings` và thông tin màu, trạng thái ẩn, mã mặc định cho danh mục. Danh mục cũ trùng tên, nhóm và icon của bộ mặc định được đánh dấu mặc định. Dữ liệu cũ thiếu icon vẫn có thể được nhận diện theo tên và nhóm. ID của danh mục được giữ lại. Các tên gốc của bộ mặc định được dành riêng trong từng nhóm để có thể khôi phục cài đặt.

- **Danh mục Thu/Chi**. Đổi tên **Ăn uống** đã có giao dịch, chọn màu và icon rồi ẩn. Giao dịch cũ, bộ lọc, Ngân sách và Báo cáo vẫn hiển thị danh mục. Khi tạo giao dịch mới, danh mục đã ẩn được bỏ khỏi danh sách chọn. Nếu tài khoản chưa có bộ danh mục, dùng **Thêm danh mục mặc định**.
- **Hiển thị và chu kỳ tài chính**. Chọn định dạng dấu phẩy để thấy bản xem trước `1,234,567 ₫`, rồi mở Tổng quan hoặc Báo cáo để đối chiếu. Chọn ngày **31**. Báo cáo kỳ **02/2025** tính từ **28/02 đến hết 30/03**. Bộ lọc **Dùng kỳ tài chính hiện tại** ở Giao dịch áp dụng cùng quy tắc. Báo cáo tháng hiện tại giới hạn đến ngày hôm nay trong kỳ. Ngân sách dùng tháng lịch. Đơn vị tiền tệ là VND đến khi có nguồn tỷ giá cho USD.
- **Hồ sơ và mật khẩu**. Sửa họ tên, ngày sinh, quê quán, thu nhập hoặc mục đích sử dụng bằng form dùng chung với Hoàn tất hồ sơ. Đổi mật khẩu cần nhập mật khẩu hiện tại và xác nhận mật khẩu mới. Sau khi lưu, đăng nhập lại bằng mật khẩu mới.
- **Dữ liệu và sao lưu**. Tải bản sao JSON để kiểm tra `version`, `exportedAt` và dữ liệu tài chính thuộc tài khoản. Sau đó thử **Khôi phục mặc định**. Tên, icon, màu và trạng thái ẩn của danh mục mặc định cùng tùy chọn hiển thị và chu kỳ sẽ được đặt lại. Danh mục cá nhân, hồ sơ, ví, giao dịch, ngân sách và mục tiêu được giữ lại.

Chỉ lưu trữ ví khi số dư hoặc dư nợ bằng 0đ. Ví có lịch sử có thể đổi giữa Tiền mặt, Ngân hàng và Ví điện tử. Thẻ tín dụng giữ cách tính dư nợ khi đã có lịch sử. Sửa số dư ban đầu sẽ đổi mốc tính cho cả lịch sử. Dùng **Điều chỉnh số dư** để ghi chênh lệch tại ngày hiện tại. Các yêu cầu chuyển ví và thanh toán dùng `requestId` để gửi lại cùng một thao tác mà chỉ ghi sổ một lần.

API `GET /api/transactions` hỗ trợ `from`, `to`, `kind`, `categoryId`, `walletId`, `min`, `max`, `q`, `sort`, `page` và `deleted=1`. Trang có 15 kết quả, các thứ tự là `newest`, `oldest`, `amountAsc`, `amountDesc`. `POST /api/transactions`, `PUT /api/transactions/:id` và `DELETE /api/transactions/:id` ghi lịch sử trong cùng transaction. Đọc lại giao dịch đã xóa bằng `GET /api/transactions/:id` và `GET /api/transactions/:id/history`. Ví và danh mục cá nhân dùng `/api/transactions/options`. Tiền VND là chuỗi số nguyên chính xác. Ngày giao dịch là ngày lịch tại Việt Nam và dấu thời gian lịch sử được hiển thị theo `Asia/Ho_Chi_Minh`.

`GET /api/finance/summary?month=YYYY-MM` tính lại từ giao dịch đang ghi nhận và trả về tổng thu/chi từng ngày cùng tiến độ các mục tiêu mới nhất. Ví hiển thị số dư theo từng ví. Ngân sách hiển thị chi theo danh mục trong tháng được chọn. Báo cáo hiển thị thu/chi theo kỳ và tối đa 24 kỳ gần nhất có giao dịch. Các trang tải lại khi mở hoặc quay về tab. Số dư ví tính từ các giao dịch, bắt đầu từ 0. Mục tiêu lưu số tiền đã để dành riêng vì người dùng cập nhật thủ công.

### Chạy kiểm thử

```powershell
npm.cmd test
npm.cmd run test:backend
npm.cmd run test:browser
```

Trên Windows, test runner tìm MariaDB trong D:\xampp\mysql\bin hoặc C:\xampp\mysql\bin. Có thể đặt `MARIADB_BIN` tới thư mục bin khác. Runner khởi động **instance riêng** bind loopback trên cổng ngẫu nhiên, dữ liệu tại `artifacts/test-data/mariadb`. Nó không đọc DB_* của ứng dụng hoặc kết nối qlthuchi thật. Mỗi fixture tạo schema la_test_<random> và chỉ xóa đúng schema thử đó khi xong.

Backend dùng các procedure thật và SMTP loopback qua Nodemailer; không gửi email ra Internet. Kiểm thử gồm UNIQUE đồng thời, chuẩn hóa, hai bước login, disabled/OAuth-only, Argon2id, BIGINT > 2^53, UTC, session expiry/revocation, reset đúng/sai/hết hạn/dùng lại/đồng thời, rollback SQL và lỗi SMTP. Browser tests dùng Edge trên Windows, kiểm tra luồng đăng ký/login/recovery và responsive. Đặt PLAYWRIGHT_CHANNEL=chrome hoặc cài Chromium nếu cần.

Ảnh được lưu ở artifacts/screenshots. Route /__test/mail chỉ nằm trong fixture, không có trên ứng dụng thật. Test runner dừng instance MariaDB kiểm thử sau khi hoàn tất.

Kiểm thử bao gồm 32 bài backend và 27 bài trình duyệt: luồng đăng ký → login → onboarding → lưu hồ sơ → email/SMS OTP → hoàn tất → Tổng quan; nút Hoàn tất tự lưu và giải thích bước xác thực còn thiếu, thông báo cấu hình gửi mã/lỗi hoàn tất, 9 trang điều hướng, reload/history, session chờ/lỗi/retry, drawer mobile, logout, chặn URL/API/giả cờ, OTP sai/hết hạn/gửi lại/dùng lại/khác user/liên hệ đổi/trước reset, xác thực/hoàn tất đồng thời và import lại giữ dữ liệu. SMS dùng mock, SMTP dùng loopback; không liên hệ người thật trong test.

Migration đã chạy trên qlthuchi thật và db:check xác nhận đủ bảng xác thực và giao dịch, 13 procedure cùng trigger xác thực liên hệ. OTP_PEPPER đã được tạo cục bộ. Các dịch vụ gửi thư và SMS thật cần cấu hình theo phần hướng dẫn tương ứng.

Tham khảo: [mysql2](https://sidorares.github.io/node-mysql2/docs), [MariaDB FOR UPDATE](https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/selecting-data/for-update), [Argon2](https://github.com/ranisalt/node-argon2), [Nodemailer SMTP](https://nodemailer.com/smtp), [Twilio Messages](https://www.twilio.com/docs/messaging/api/message-resource).


## Liên kết xác thực email qua Resend

`npm.cmd start`/`npm.cmd run dev` hiện đọc `.env` ở gốc trước, rồi `BackEnd/.env`; giá trị trùng trong file backend có ưu tiên cao hơn, biến môi trường của shell ưu tiên cao nhất. `OTP_PEPPER` và `FRONTEND_ORIGIN` đang có được giữ nguyên. Khóa riêng `RESEND_API_KEY` chỉ đặt trong `BackEnd/.env`; không đặt trong frontend, SQL hoặc file mẫu. Sao chép giá trị mẫu từ `BackEnd/.env.example`, thay placeholder bằng khóa thật. Khởi động lại server sau khi sửa env.

```ini
OTP_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM="LÁ <onboarding@resend.dev>"
```

Adapter `BackEnd/services/resend.js` gọi HTTPS `POST https://api.resend.com/emails` bằng fetch tích hợp Node, có timeout 15 giây. Chỉ chấp nhận HTTP thành công cùng email ID và không có error; không tự retry để tránh gửi trùng. Không log key, OTP hoặc phản hồi kỹ thuật nhà cung cấp. `mailer.otpReady` độc lập với SMTP: OTP dùng Resend khi được chọn, còn email khôi phục mật khẩu vẫn dùng SMTP hiện có. Chọn `OTP_EMAIL_PROVIDER=smtp` để dùng lại SMTP cho OTP.

Lệnh `npm.cmd run dev` và `npm.cmd start` dùng `--use-system-ca` để Node.js đọc thêm chứng chỉ CA đáng tin cậy từ Windows. Nếu máy đang chạy LÁ bằng lệnh cũ, hãy dừng tiến trình và khởi động lại bằng một trong hai lệnh này.

Nút **Gửi liên kết xác thực** dùng `POST /api/onboarding/verification/send`. Email lấy từ tài khoản đang đăng nhập. Liên kết hết hạn sau 5 phút, chứa giá trị ngẫu nhiên dùng một lần và chỉ bản băm được lưu. Mở thư rồi bấm **Xác thực email** trên trang LÁ. Bước xác nhận này tránh việc trình quét email tự dùng mất liên kết. Người dùng quay về trang hồ sơ để hoàn tất. SMS tiếp tục dùng mã 6 chữ số. Không cần migration.

Trên Windows, bật MySQL trong XAMPP và chạy `npm.cmd run dev` từ thư mục gốc. Đăng nhập, chọn Email tại `/onboarding` rồi bấm **Gửi liên kết xác thực**. Dùng cùng máy khi `APP_BASE_URL=http://localhost:3000`. Khi triển khai, đặt `APP_BASE_URL` thành địa chỉ HTTPS mà người nhận có thể mở. Không ghi query `token` vào access log của reverse proxy.

Với `onboarding@resend.dev`, email tài khoản LÁ phải trùng email chủ tài khoản Resend. Muốn gửi cho người khác cần xác minh domain và đổi RESEND_FROM sang domain đó. Tham khảo [giới hạn resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) và [Send Email API](https://resend.com/docs/api-reference/emails/send-email).

Kiểm thử Resend dùng fetch giả lập và MariaDB test riêng. Các bài kiểm tra bao gồm email đích, phản hồi lỗi, thu hồi khi gửi thất bại, liên kết sai/hết hạn/dùng lại, mở liên kết mà chưa xác nhận và hoàn tất hồ sơ. Để xác nhận thư đến thật, gửi từ giao diện rồi xem trạng thái thư trong Resend Logs và kiểm tra Inbox/Spam.

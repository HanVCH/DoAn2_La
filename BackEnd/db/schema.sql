-- ============================================================================
-- LÁ - ĐẦY ĐỦ: AUTH + HỒ SƠ BAN ĐẦU + XÁC THỰC LIÊN HỆ
-- Database: qlthuchi
-- Mục tiêu tương thích: MariaDB 10.4+ của XAMPP / MySQL 5.7+.
-- Định dạng: UTF-8. Nhập bằng phpMyAdmin > Import hoặc mysql CLI.
--
-- NHẬP FILE:
--   1. Bật Apache và MySQL trong XAMPP Control Panel.
--   2. Mở http://localhost/phpmyadmin
--   3. Chọn Import, chọn file này, giữ charset utf-8 và bấm Go / Nhập.
--   Chỉ cần import file này; không cần import hai file SQL trước đó.
--   File tự tạo database, bảng users trước, rồi các bảng có khóa ngoại user_id.
--   Không DROP TABLE hoặc xóa dữ liệu cũ.
--   Import lại giữ dữ liệu và cập nhật procedure. Có 8 la_auth_* + 5 la_onboarding_*.
--   Phần cuối tự thêm cột vào users cũ, thêm 2 bảng và 1 trigger xác thực.
--   Dùng đúng database qlthuchi; không tự di chuyển dữ liệu từ DB tên khác.
--   Migration hỗ trợ cấu trúc users của bản SQL trước; không tự sửa bảng tùy biến khác.
--
-- CẤU TRÚC VÀ BA CHỨC NĂNG:
--   users: thông tin tài khoản; email và phone duy nhất; password_hash là bcrypt/Argon2id.
--   auth_identities.user_id -> users.id: liên kết Google/Facebook sau xác thực OAuth.
--   auth_sessions.user_id -> users.id: phiên được tạo sau khi mật khẩu đúng.
--   password_reset_tokens.user_id -> users.id: token xác thực đổi mật khẩu.
--   Đăng ký: la_auth_register -> thêm một dòng vào users.
--   Đăng nhập: la_auth_check_login_identifier -> mở ô mật khẩu;
--     la_auth_get_login_user_by_identifier -> Node.js kiểm tra hash;
--     la_auth_create_session -> tạo phiên cho đúng users.id.
--   Quên mật khẩu: la_auth_issue_password_reset -> Node.js gửi mail;
--     la_auth_reset_password -> đổi hash và thu hồi phiên cũ.
--   users là người dùng ứng dụng LÁ, không phải tài khoản MySQL/XAMPP.
--   Các bảng con được tạo ngay; dữ liệu được thêm khi phát sinh đúng chức năng.
--
-- KẾT NỐI NODE.JS (cấu hình theo XAMPP của bạn):
--   DB_HOST=127.0.0.1
--   DB_PORT=3306
--   DB_NAME=qlthuchi
--   DB_USER=<tai_khoan_database_cua_ban>
--   DB_PASSWORD=<mat_khau_database_cua_ban>
--   Với mỗi connection trong pool: SET time_zone = '+00:00';
--   Thời gian trong các bảng được quy ước là UTC.
--
-- TRÁCH NHIỆM BACKEND:
--   - Node.js kiểm tra email/SĐT, băm và so sánh mật khẩu bằng bcrypt/Argon2id.
--     Trường nhập lại mật khẩu chỉ dùng để so sánh, không lưu trong database.
--   - SQL không nhận mật khẩu nguyên văn, không xác thực Google/Facebook,
--     không gửi email và không quyết định chuyển trang giao diện.
--   - Chuẩn hóa email: trim + lowercase. Email được lưu dạng ASCII.
--   - Chuẩn hóa SĐT trước khi lưu/tìm: dạng quốc tế, ví dụ +84901234567.
--     Cùng một số phải dùng cùng định dạng ở đăng ký và quên mật khẩu.
--   - Token reset/session: crypto.randomBytes(32).toString('hex').
--     Chỉ lưu SHA-256 của token (64 ký tự hex); token gốc gửi trong email/cookie.
--   - Không trả password_hash, token_hash hoặc lỗi SQL thô về trình duyệt.
--   - Rate limit, CSRF, cookie an toàn, SMTP và nội dung email nằm ở Node.js.
--   - Các procedure có START TRANSACTION tự quản lý transaction; gọi độc lập,
--     không gọi bên trong transaction khác của ứng dụng.
--   Tài khoản DEMO nằm riêng trong demo.sql để thử trong môi trường phát triển.
--   Email demo.la@example.com | SĐT 0901234567 | Mật khẩu ban đầu LaDemo@123456
--   Database chỉ lưu bcrypt hash. Đổi/xóa tài khoản DEMO trước khi đưa lên web.
--   Email mẫu không phải hộp thư của bạn; thử gửi mail cần email thật và SMTP.
-- ============================================================================

SET @la_previous_sql_mode = @@SESSION.sql_mode;
SET @la_previous_time_zone = @@SESSION.time_zone;
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
SET SESSION time_zone = '+00:00';
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS `qlthuchi`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `qlthuchi`;

-- 1. BẢNG GỐC USERS: đăng ký và đăng nhập bằng Gmail/email hoặc SĐT.
-- password_hash NULL chỉ dành cho tài khoản chỉ đăng nhập bằng OAuth.
-- Email và SĐT có UNIQUE; database ngăn đăng ký trùng cả khi gửi đồng thời.
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `phone` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `password_hash` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `display_name` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `email_verified_at` DATETIME(6) DEFAULT NULL,
  `password_changed_at` DATETIME(6) DEFAULT NULL,
  `last_login_at` DATETIME(6) DEFAULT NULL,
  `auth_version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_phone` (`phone`),
  CONSTRAINT `ck_users_email_not_empty` CHECK (CHAR_LENGTH(TRIM(`email`)) > 0),
  CONSTRAINT `ck_users_phone_not_empty` CHECK (
    `phone` IS NULL OR CHAR_LENGTH(TRIM(`phone`)) > 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. LIÊN KẾT GOOGLE / FACEBOOK: lưu ID nhà cung cấp, không lưu mật khẩu của họ.
-- Backend chỉ liên kết sau khi kiểm tra OAuth; không tự gộp tài khoản qua một
-- địa chỉ email chưa xác minh. Mỗi user tối đa một liên kết mỗi nhà cung cấp.
CREATE TABLE IF NOT EXISTS `auth_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `provider` ENUM('google', 'facebook') NOT NULL,
  `provider_user_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_identity_provider_subject` (`provider`, `provider_user_id`),
  UNIQUE KEY `uq_identity_user_provider` (`user_id`, `provider`),
  CONSTRAINT `fk_identity_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_identity_subject_not_empty` CHECK (
    CHAR_LENGTH(TRIM(`provider_user_id`)) > 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. PHIÊN ĐĂNG NHẬP: dùng với cookie session token hoặc refresh token.
-- Khi kiểm tra phiên phải đối chiếu auth_version và status của users.
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `auth_version` INT UNSIGNED NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `last_used_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_token_hash` (`token_hash`),
  KEY `idx_session_user_state` (`user_id`, `revoked_at`, `expires_at`),
  KEY `idx_session_expires` (`expires_at`),
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_session_token_hash` CHECK (`token_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `ck_session_expiry` CHECK (`expires_at` > `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TOKEN QUÊN MẬT KHẨU: một lần, có hạn dùng, không lưu token nguyên văn.
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `auth_version_at_issue` INT UNSIGNED NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `used_at` DATETIME(6) DEFAULT NULL,
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reset_token_hash` (`token_hash`),
  KEY `idx_reset_user_state` (`user_id`, `used_at`, `revoked_at`),
  KEY `idx_reset_expires` (`expires_at`),
  CONSTRAINT `fk_reset_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_reset_token_hash` CHECK (`token_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `ck_reset_expiry` CHECK (`expires_at` > `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

-- A. ĐĂNG KÝ: Node.js validate form và băm mật khẩu trước khi gọi.
-- Ví dụ mysql2/promise:
--   await db.execute('CALL la_auth_register(?, ?, ?)', [email, phone, hash]);
-- Duplicate email/SĐT trả lỗi MySQL ER_DUP_ENTRY (1062).
DROP PROCEDURE IF EXISTS `la_auth_register`$$
CREATE PROCEDURE `la_auth_register`(
  IN p_email VARCHAR(254),
  IN p_phone VARCHAR(20),
  IN p_password_hash VARCHAR(255)
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_email VARCHAR(254);
  DECLARE v_phone VARCHAR(20);
  DECLARE v_now DATETIME(6);

  SET v_email = LOWER(TRIM(p_email));
  SET v_phone = TRIM(p_phone);
  SET v_now = UTC_TIMESTAMP(6);

  IF v_email IS NULL OR v_email = '' OR LOCATE('@', v_email) < 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_EMAIL';
  END IF;
  IF v_phone IS NULL OR v_phone NOT REGEXP '^[+][1-9][0-9]{7,14}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_PHONE_E164';
  END IF;
  IF p_password_hash IS NULL OR NOT (
    (LEFT(p_password_hash, 4) IN ('$2a$', '$2b$', '$2y$')
      AND CHAR_LENGTH(p_password_hash) = 60)
    OR (LEFT(p_password_hash, 10) = '$argon2id$'
      AND CHAR_LENGTH(p_password_hash) >= 60)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_PASSWORD_HASH_REQUIRED';
  END IF;

  INSERT INTO `users` (
    `email`, `phone`, `password_hash`, `status`, `auth_version`,
    `password_changed_at`, `created_at`, `updated_at`
  ) VALUES (v_email, v_phone, p_password_hash, 'active', 0, v_now, v_now, v_now);

  SELECT LAST_INSERT_ID() AS `user_id`, v_email AS `email`,
    v_phone AS `phone`, 0 AS `auth_version`;
END$$

-- B. TRA TÀI KHOẢN ĐĂNG NHẬP: chưa phải xác thực mật khẩu!
-- Node.js lấy row này, dùng bcrypt.compare / Argon2.verify với password_hash.
-- Chỉ khi khớp mới gọi la_auth_create_session. Không gửi row này cho frontend.
DROP PROCEDURE IF EXISTS `la_auth_get_login_user`$$
CREATE PROCEDURE `la_auth_get_login_user`(IN p_email VARCHAR(254))
SQL SECURITY INVOKER
READS SQL DATA
BEGIN
  SELECT `id`, `email`, `phone`, `password_hash`, `auth_version`
  FROM `users`
  WHERE `email` = LOWER(TRIM(p_email))
    AND `status` = 'active' AND `password_hash` IS NOT NULL
  LIMIT 1;
END$$

-- C. TẠO PHIÊN SAU KHI NODE.JS ĐÃ KIỂM TRA MẬT KHẨU.
-- p_expected_auth_version lấy từ kết quả tra đăng nhập, không lấy từ client.
-- Chặn tạo phiên bằng mật khẩu cũ nếu mật khẩu vừa đổi trong lúc xác thực.
-- TTL theo phút: ví dụ 10080 = 7 ngày. Node.js cấu hình theo chính sách project.
DROP PROCEDURE IF EXISTS `la_auth_create_session`$$
CREATE PROCEDURE `la_auth_create_session`(
  IN p_user_id BIGINT UNSIGNED,
  IN p_expected_auth_version INT UNSIGNED,
  IN p_token_hash VARCHAR(64),
  IN p_ttl_minutes INT
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE v_status VARCHAR(16);
  DECLARE v_version INT UNSIGNED;
  DECLARE v_now DATETIME(6);
  DECLARE v_expires DATETIME(6);
  DECLARE v_session_id BIGINT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_token_hash IS NULL OR p_token_hash NOT REGEXP '^[0-9a-f]{64}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_TOKEN_HASH';
  END IF;
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_ttl_minutes > 43200 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_SESSION_TTL';
  END IF;
  IF p_expected_auth_version IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_VERSION_REQUIRED';
  END IF;

  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
    SELECT `status`, `auth_version` INTO v_status, v_version
    FROM `users` WHERE `id` = p_user_id FOR UPDATE;
  END;
  IF v_found = 0 OR v_status <> 'active' OR v_version <> p_expected_auth_version THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_LOGIN_AGAIN';
  END IF;

  SET v_now = UTC_TIMESTAMP(6);
  SET v_expires = DATE_ADD(v_now, INTERVAL p_ttl_minutes MINUTE);
  INSERT INTO `auth_sessions` (
    `user_id`, `token_hash`, `auth_version`, `expires_at`, `created_at`
  ) VALUES (p_user_id, p_token_hash, v_version, v_expires, v_now);
  SET v_session_id = LAST_INSERT_ID();
  UPDATE `users` SET `last_login_at` = v_now, `updated_at` = v_now
  WHERE `id` = p_user_id;
  COMMIT;

  SELECT v_session_id AS `session_id`, v_expires AS `expires_at`;
END$$

-- D. QUÊN MẬT KHẨU: tra email hoặc SĐT và phát hành token.
-- SĐT phải được Node.js chuẩn hóa về dạng đã lưu, ví dụ +84901234567.
-- p_token_hash là hash của token Node.js đã tạo; TTL khuyến nghị gọi là 15 phút.
-- Kết quả email là địa chỉ DUY NHẤT dùng để gửi email xác thực.
-- AUTH_ACCOUNT_NOT_FOUND: Node.js xử lý chuyển về /login theo luồng đã yêu cầu.
-- Chỉ áp dụng cho tài khoản có mật khẩu nội bộ. Tài khoản chỉ dùng Google /
-- Facebook tiếp tục đăng nhập hoặc khôi phục qua nhà cung cấp tương ứng.
-- Token được ghi trước khi gửi mail. Nếu SMTP thất bại, backend thu hồi token
-- theo reset_id bằng truy vấn hướng dẫn ở cuối file; không báo đã gửi thành công.
DROP PROCEDURE IF EXISTS `la_auth_issue_password_reset`$$
CREATE PROCEDURE `la_auth_issue_password_reset`(
  IN p_identifier VARCHAR(254),
  IN p_token_hash VARCHAR(64),
  IN p_ttl_minutes INT
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_user_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_email VARCHAR(254);
  DECLARE v_version INT UNSIGNED;
  DECLARE v_identifier VARCHAR(254);
  DECLARE v_reset_id BIGINT UNSIGNED;
  DECLARE v_now DATETIME(6);
  DECLARE v_expires DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET v_identifier = TRIM(p_identifier);
  IF v_identifier IS NULL OR v_identifier = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_IDENTIFIER_REQUIRED';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash NOT REGEXP '^[0-9a-f]{64}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_TOKEN_HASH';
  END IF;
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_ttl_minutes > 60 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_RESET_TTL';
  END IF;

  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_user_id = NULL;
    IF LOCATE('@', v_identifier) > 0 THEN
      SELECT `id`, `email`, `auth_version`
        INTO v_user_id, v_email, v_version
      FROM `users`
      WHERE `email` = LOWER(v_identifier) AND `status` = 'active'
        AND `password_hash` IS NOT NULL
      LIMIT 1 FOR UPDATE;
    ELSE
      SELECT `id`, `email`, `auth_version`
        INTO v_user_id, v_email, v_version
      FROM `users`
      WHERE `phone` = v_identifier AND `status` = 'active'
        AND `password_hash` IS NOT NULL
      LIMIT 1 FOR UPDATE;
    END IF;
  END;
  IF v_user_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_ACCOUNT_NOT_FOUND';
  END IF;

  SET v_now = UTC_TIMESTAMP(6);
  SET v_expires = DATE_ADD(v_now, INTERVAL p_ttl_minutes MINUTE);
  UPDATE `password_reset_tokens` SET `revoked_at` = v_now
  WHERE `user_id` = v_user_id AND `used_at` IS NULL AND `revoked_at` IS NULL;

  INSERT INTO `password_reset_tokens` (
    `user_id`, `token_hash`, `auth_version_at_issue`, `expires_at`, `created_at`
  ) VALUES (v_user_id, p_token_hash, v_version, v_expires, v_now);
  SET v_reset_id = LAST_INSERT_ID();
  COMMIT;

  SELECT v_reset_id AS `reset_id`, v_user_id AS `user_id`,
    v_email AS `email`, v_expires AS `expires_at`;
END$$

-- E. ĐỔI MẬT KHẨU: gọi sau khi validate mật khẩu mới và xác nhận trùng nhau.
-- p_new_password_hash được băm tại Node.js, không phải mật khẩu nguyên văn.
-- Khóa users trước rồi mới khóa token để các luồng tạo phiên, phát hành token
-- và đổi mật khẩu dùng cùng thứ tự khóa. Mọi kiểm tra token lặp lại tại POST.
DROP PROCEDURE IF EXISTS `la_auth_reset_password`$$
CREATE PROCEDURE `la_auth_reset_password`(
  IN p_token_hash VARCHAR(64),
  IN p_new_password_hash VARCHAR(255)
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_user_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_token_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_email VARCHAR(254);
  DECLARE v_status VARCHAR(16);
  DECLARE v_version INT UNSIGNED;
  DECLARE v_now DATETIME(6);
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_token_hash IS NULL OR p_token_hash NOT REGEXP '^[0-9a-f]{64}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_RESET_TOKEN';
  END IF;
  IF p_new_password_hash IS NULL OR NOT (
    (LEFT(p_new_password_hash, 4) IN ('$2a$', '$2b$', '$2y$')
      AND CHAR_LENGTH(p_new_password_hash) = 60)
    OR (LEFT(p_new_password_hash, 10) = '$argon2id$'
      AND CHAR_LENGTH(p_new_password_hash) >= 60)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_PASSWORD_HASH_REQUIRED';
  END IF;

  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_user_id = NULL;
    SELECT `user_id` INTO v_user_id
    FROM `password_reset_tokens` WHERE `token_hash` = p_token_hash LIMIT 1;
  END;
  IF v_user_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_RESET_TOKEN';
  END IF;

  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
    SELECT `status`, `auth_version`, `email`
      INTO v_status, v_version, v_email
    FROM `users` WHERE `id` = v_user_id FOR UPDATE;
  END;
  IF v_found = 0 OR v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_RESET_TOKEN';
  END IF;

  SET v_now = UTC_TIMESTAMP(6);
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_token_id = NULL;
    SELECT `id` INTO v_token_id
    FROM `password_reset_tokens`
    WHERE `token_hash` = p_token_hash AND `user_id` = v_user_id
      AND `used_at` IS NULL AND `revoked_at` IS NULL
      AND `expires_at` > v_now AND `auth_version_at_issue` = v_version
    LIMIT 1 FOR UPDATE;
  END;
  IF v_token_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_INVALID_RESET_TOKEN';
  END IF;

  UPDATE `users`
  SET `password_hash` = p_new_password_hash, `password_changed_at` = v_now,
    `auth_version` = `auth_version` + 1, `updated_at` = v_now
  WHERE `id` = v_user_id;
  UPDATE `password_reset_tokens` SET `used_at` = v_now WHERE `id` = v_token_id;
  UPDATE `password_reset_tokens` SET `revoked_at` = v_now
  WHERE `user_id` = v_user_id AND `used_at` IS NULL AND `revoked_at` IS NULL;
  UPDATE `auth_sessions` SET `revoked_at` = v_now
  WHERE `user_id` = v_user_id AND `revoked_at` IS NULL;
  COMMIT;

  SELECT v_user_id AS `user_id`, v_email AS `email`,
    v_now AS `password_changed_at`;
END$$

DELIMITER ;

-- ============================================================================
-- CÁC TRUY VẤN THAM KHẢO CHO NODE.JS (chỉ là comment, không tự thực thi).
-- Dùng mysql2/promise và placeholder ?, không nối chuỗi dữ liệu người dùng.
--
-- 1. Đăng ký:
--    CALL la_auth_register(?, ?, ?);
--    Params: email đã chuẩn hóa, phone dạng +84..., bcrypt/Argon2id hash.
--    Với mysql2, resultSets[0] là mảng row trả về bởi SELECT trong procedure.
--
-- 2. Đăng nhập:
--    CALL la_auth_get_login_user(?);
--    Sau khi Node.js so sánh mật khẩu thành công:
--    CALL la_auth_create_session(?, ?, ?, ?);
--    Params: user.id, user.auth_version, SHA256(sessionToken), TTL-phút.
--    Trình duyệt chỉ nhận token gốc trong cookie HttpOnly thích hợp.
--
-- 3. Kiểm tra phiên mỗi request:
--    SELECT u.id, u.email, u.phone
--    FROM auth_sessions s JOIN users u ON u.id = s.user_id
--    WHERE s.token_hash = ? AND s.revoked_at IS NULL
--      AND s.expires_at > UTC_TIMESTAMP(6)
--      AND s.auth_version = u.auth_version AND u.status = 'active'
--    LIMIT 1;
--
-- 4. Đăng xuất:
--    UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(6)
--    WHERE token_hash = ? AND revoked_at IS NULL;
--
-- 5. Yêu cầu email đặt lại mật khẩu:
--    CALL la_auth_issue_password_reset(?, ?, 15);
--    Params: email hoặc phone đã chuẩn hóa, SHA256(rawResetToken).
--    Node.js gửi liên kết APP_BASE_URL/reset-password?token=<rawResetToken>
--    đến email trả về. GET liên kết không đánh dấu token đã dùng.
--    Nếu SMTP thất bại, thu hồi yêu cầu vừa tạo:
--    UPDATE password_reset_tokens SET revoked_at = UTC_TIMESTAMP(6)
--    WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL;
--
-- 6. GET /reset-password - kiểm tra trước khi hiển thị form:
--    SELECT t.id
--    FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
--    WHERE t.token_hash = ? AND t.used_at IS NULL AND t.revoked_at IS NULL
--      AND t.expires_at > UTC_TIMESTAMP(6)
--      AND t.auth_version_at_issue = u.auth_version AND u.status = 'active'
--    LIMIT 1;
--
-- 7. POST mật khẩu mới - không nhận user_id/email từ client:
--    CALL la_auth_reset_password(?, ?);
--    Params: SHA256(token nhận từ link), bcrypt/Argon2id hash mật khẩu mới.
--    Chỉ sau CALL thành công mới báo đổi thành công, gửi email thông báo
--    và chuyển về /login. Người dùng đăng nhập lại bằng mật khẩu mới.
--
-- Gợi ý mapping lỗi backend:
--   ER_DUP_ENTRY / 1062             -> Email hoặc SĐT đã được sử dụng.
--   AUTH_ACCOUNT_NOT_FOUND          -> Nhánh chuyển về /login theo yêu cầu.
--   AUTH_INVALID_RESET_TOKEN        -> Liên kết không hợp lệ hoặc hết hạn.
--   AUTH_LOGIN_AGAIN                -> Yêu cầu đăng nhập lại.
--   Các lỗi khác                    -> Log nội bộ đã lọc bí mật; UI báo chung.
-- Lưu ý: nhánh chuyển trang khác nhau có thể tiết lộ việc tài khoản tồn tại.
--
-- TÀI LIỆU ĐỐI CHIẾU:
-- https://www.apachefriends.org/faq_windows
-- https://mariadb.com/docs/server/server-usage/tables/create-table
-- https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/selecting-data/for-update
-- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
-- ============================================================================

SET SESSION time_zone = @la_previous_time_zone;
SET SESSION sql_mode = @la_previous_sql_mode;

-- ============================================================================
-- PHẦN ĐĂNG NHẬP HAI BƯỚC: DÙNG BẢNG USERS ĐÃ TẠO Ở TRÊN
-- ============================================================================
-- LUỒNG GIAO DIỆN:
-- 1. Chọn email hoặc SĐT, nhập thông tin và bấm Tiếp tục.
-- 2. Node.js gọi la_auth_check_login_identifier(type, identifier).
--    allow_password = 0: hiện message, chưa mở ô nhập mật khẩu.
--    allow_password = 1: mở ô mật khẩu và nút Đăng nhập.
-- 3. Khi gửi mật khẩu, Node.js gọi la_auth_get_login_user_by_identifier.
--    Kiểm tra lại tài khoản, rồi bcrypt.compare / Argon2.verify ở Node.js.
--    Chỉ khi mật khẩu đúng mới gọi la_auth_create_session của file gốc.
-- 4. Khi người dùng sửa email/SĐT, giao diện quay lại bước kiểm tra đầu tiên.
--
-- LƯU Ý TÍCH HỢP:
-- - type chỉ nhận 'email' hoặc 'phone'. Gmail là đăng nhập bằng email + mật khẩu
--   của ứng dụng LÁ; nút Đăng nhập bằng Google là luồng OAuth riêng.
-- - Chấp nhận Gmail và các email đã đăng ký khác, không chỉ @gmail.com.
-- - Email: trim + lowercase. Không tự xóa dấu chấm hoặc phần +tag của Gmail.
-- - SĐT Việt Nam: 0901234567 / 84901234567 / +84901234567 -> +84901234567.
--   Cho phép dấu cách, dấu chấm, gạch ngang và ngoặc trong SĐT nhập vào.
--   SĐT quốc tế khác phải có dấu + và đúng cấu trúc E.164.
-- - users.phone phải được lưu chuẩn E.164 như file đăng ký trước đó.
--   File này không sửa những số đã lưu sai định dạng trong dữ liệu cũ.
-- - SQL chỉ trả kết quả; Node.js và frontend mới hiển thị cảnh báo/ô mật khẩu.
-- - Kết quả bước 1 KHÔNG chứng minh đã đăng nhập. Backend không tin cờ
--   allow_password, user_id hoặc auth_version do trình duyệt gửi lên.
-- - Không gửi password_hash về frontend và không so mật khẩu bằng SQL/SHA/MD5.
-- - Dùng placeholder ? trong mysql2; không nối chuỗi truy vấn với input.
-- - Giới hạn tần suất cả bước tra tài khoản và bước kiểm tra mật khẩu tại Node.js.
--   Các thông báo khác nhau theo yêu cầu sẽ cho biết tài khoản có tồn tại.
-- ============================================================================

USE `qlthuchi`;
SET @la_login_previous_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DELIMITER $$

-- A. HELPER NỘI BỘ: chuẩn hóa, tra đúng cột có UNIQUE và kiểm tra trạng thái.
-- Không tạo phiên, không thay đổi dữ liệu và không trả result set.
DROP PROCEDURE IF EXISTS `la_auth_resolve_login_identifier`$$
CREATE PROCEDURE `la_auth_resolve_login_identifier`(
  IN p_type VARCHAR(16),
  IN p_identifier TEXT,
  OUT p_code VARCHAR(32),
  OUT p_user_id BIGINT UNSIGNED
)
SQL SECURITY INVOKER
READS SQL DATA
resolve_identifier: BEGIN
  DECLARE v_type VARCHAR(16);
  DECLARE v_identifier TEXT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_has_password TINYINT DEFAULT 0;

  SET p_code = 'INVALID_IDENTIFIER_TYPE';
  SET p_user_id = NULL;
  SET v_type = LOWER(TRIM(COALESCE(p_type, '')));
  SET v_identifier = TRIM(COALESCE(p_identifier, ''));

  IF v_type NOT IN ('email', 'phone') THEN
    LEAVE resolve_identifier;
  END IF;

  IF v_identifier = '' THEN
    SET p_code = IF(v_type = 'email', 'EMAIL_REQUIRED', 'PHONE_REQUIRED');
    LEAVE resolve_identifier;
  END IF;

  IF v_type = 'email' THEN
    SET v_identifier = LOWER(v_identifier);
    IF CHAR_LENGTH(v_identifier) > 254
      OR OCTET_LENGTH(v_identifier) <> CHAR_LENGTH(v_identifier)
      OR v_identifier NOT REGEXP '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    THEN
      SET p_code = 'INVALID_EMAIL';
      LEAVE resolve_identifier;
    END IF;
  ELSE
    IF CHAR_LENGTH(v_identifier) > 254 THEN
      SET p_code = 'INVALID_PHONE';
      LEAVE resolve_identifier;
    END IF;
    SET v_identifier = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      v_identifier, ' ', ''), '-', ''), '.', ''), '(', ''), ')', '');
    IF LEFT(v_identifier, 1) = '0' AND CHAR_LENGTH(v_identifier) = 10 THEN
      SET v_identifier = CONCAT('+84', SUBSTRING(v_identifier, 2));
    ELSEIF LEFT(v_identifier, 2) = '84' AND CHAR_LENGTH(v_identifier) = 11 THEN
      SET v_identifier = CONCAT('+', v_identifier);
    END IF;
    IF v_identifier NOT REGEXP '^[+][1-9][0-9]{7,14}$'
      OR v_identifier REGEXP '[^+0-9]'
    THEN
      SET p_code = 'INVALID_PHONE';
      LEAVE resolve_identifier;
    END IF;
  END IF;

  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET p_user_id = NULL;
    IF v_type = 'email' THEN
      SELECT `id`, `status`,
        (`password_hash` IS NOT NULL AND CHAR_LENGTH(`password_hash`) > 0)
        INTO p_user_id, v_status, v_has_password
      FROM `users` WHERE `email` = v_identifier LIMIT 1;
    ELSE
      SELECT `id`, `status`,
        (`password_hash` IS NOT NULL AND CHAR_LENGTH(`password_hash`) > 0)
        INTO p_user_id, v_status, v_has_password
      FROM `users` WHERE `phone` = v_identifier LIMIT 1;
    END IF;
  END;

  IF p_user_id IS NULL THEN
    SET p_code = IF(v_type = 'email', 'EMAIL_NOT_REGISTERED', 'PHONE_NOT_REGISTERED');
  ELSEIF v_status <> 'active' THEN
    SET p_code = 'ACCOUNT_DISABLED';
  ELSEIF v_has_password = 0 THEN
    -- Tài khoản chỉ dùng Google/Facebook có password_hash NULL.
    SET p_code = 'PASSWORD_NOT_SET';
  ELSE
    SET p_code = 'PASSWORD_REQUIRED';
  END IF;
END$$

-- B. BƯỚC 1: kết quả an toàn để Node.js trả về giao diện.
-- Luôn trả đúng một dòng: code, allow_password (0/1), message.
DROP PROCEDURE IF EXISTS `la_auth_check_login_identifier`$$
CREATE PROCEDURE `la_auth_check_login_identifier`(
  IN p_type VARCHAR(16),
  IN p_identifier TEXT
)
SQL SECURITY INVOKER
READS SQL DATA
BEGIN
  DECLARE v_code VARCHAR(32);
  DECLARE v_user_id BIGINT UNSIGNED;

  CALL `la_auth_resolve_login_identifier`(p_type, p_identifier, v_code, v_user_id);

  SELECT v_code AS `code`,
    IF(v_code = 'PASSWORD_REQUIRED', 1, 0) AS `allow_password`,
    CASE v_code
      WHEN 'PASSWORD_REQUIRED' THEN 'Tài khoản đã đăng ký. Vui lòng nhập mật khẩu.'
      WHEN 'PHONE_NOT_REGISTERED' THEN 'Số điện thoại chưa đăng ký.'
      WHEN 'EMAIL_NOT_REGISTERED' THEN 'Email chưa đăng ký.'
      WHEN 'PHONE_REQUIRED' THEN 'Vui lòng nhập số điện thoại.'
      WHEN 'EMAIL_REQUIRED' THEN 'Vui lòng nhập Gmail hoặc email đã đăng ký.'
      WHEN 'INVALID_PHONE' THEN 'Số điện thoại không hợp lệ.'
      WHEN 'INVALID_EMAIL' THEN 'Địa chỉ email không hợp lệ.'
      WHEN 'ACCOUNT_DISABLED' THEN 'Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ.'
      WHEN 'PASSWORD_NOT_SET' THEN 'Tài khoản chưa có mật khẩu. Vui lòng dùng cách đăng nhập Google hoặc Facebook đã liên kết.'
      ELSE 'Vui lòng chọn đăng nhập bằng email hoặc số điện thoại.'
    END AS `message`;
END$$

-- C. BƯỚC 2: CHỈ BACKEND gọi để lấy hash và kiểm tra mật khẩu.
-- Trả 0 dòng nếu tài khoản không hợp lệ, chưa đăng ký, bị khóa hoặc chưa có hash.
-- Trả 1 dòng khi có thể kiểm tra mật khẩu; chưa đồng nghĩa đăng nhập thành công.
DROP PROCEDURE IF EXISTS `la_auth_get_login_user_by_identifier`$$
CREATE PROCEDURE `la_auth_get_login_user_by_identifier`(
  IN p_type VARCHAR(16),
  IN p_identifier TEXT
)
SQL SECURITY INVOKER
READS SQL DATA
BEGIN
  DECLARE v_code VARCHAR(32);
  DECLARE v_user_id BIGINT UNSIGNED;

  CALL `la_auth_resolve_login_identifier`(p_type, p_identifier, v_code, v_user_id);

  SELECT `id`, `email`, `phone`, `password_hash`, `auth_version`
  FROM `users`
  WHERE `id` = v_user_id AND v_code = 'PASSWORD_REQUIRED'
    AND `status` = 'active'
    AND `password_hash` IS NOT NULL AND CHAR_LENGTH(`password_hash`) > 0
  LIMIT 1;
END$$

DELIMITER ;

SET SESSION sql_mode = @la_login_previous_sql_mode;

-- ============================================================================
-- VÍ DỤ GỌI TRONG PHPMYADMIN (bỏ -- ở dòng muốn chạy; không tự thêm user mẫu):
-- CALL la_auth_check_login_identifier('phone', '0901234567');
-- CALL la_auth_check_login_identifier('phone', '+84 901 234 567');
-- CALL la_auth_check_login_identifier('email', 'ban@gmail.com');
--
-- Chưa đăng ký:
--   code = PHONE_NOT_REGISTERED hoặc EMAIL_NOT_REGISTERED
--   allow_password = 0; message = cảnh báo tương ứng.
-- Đã đăng ký, đang hoạt động và có mật khẩu:
--   code = PASSWORD_REQUIRED; allow_password = 1.
-- Tài khoản bị khóa / chỉ dùng OAuth:
--   code = ACCOUNT_DISABLED / PASSWORD_NOT_SET; allow_password = 0.
--
-- NODE.JS + mysql2/promise: MINH HỌA ĐỌC KẾT QUẢ, KHÔNG TỰ CHẠY TRONG SQL.
--
-- Bước 1 (ví dụ POST /auth/login/check):
-- const [sets] = await pool.execute(
--   'CALL la_auth_check_login_identifier(?, ?)', [type, identifier]
-- );
-- const result = sets[0][0];
-- res.json(result); // chỉ có code, allow_password, message
--
-- Bước 2 (ví dụ POST /auth/login):
-- const [sets] = await pool.execute(
--   'CALL la_auth_get_login_user_by_identifier(?, ?)', [type, identifier]
-- );
-- const user = sets[0][0];
-- if (!user) { /* từ chối đăng nhập; yêu cầu kiểm tra tài khoản lại */ }
-- else {
--   // Nếu hash bắt đầu bằng $argon2id$: dùng argon2.verify(hash, password).
--   // Nếu hash là bcrypt: dùng bcrypt.compare(password, hash).
--   // Sai mật khẩu: thông báo "Mật khẩu không đúng.", không tạo phiên.
--   // Chỉ khi đúng: tạo random session token, băm SHA-256 rồi gọi:
--   // CALL la_auth_create_session(user.id, user.auth_version, tokenHash, ttl);
--   // auth_version phải lấy từ row vừa đọc; cookie chỉ phát sau CALL thành công.
-- }
-- Không gửi object user hoặc sets của bước 2 về frontend.
-- Bắt lỗi database ở backend; không trả stack trace/lỗi SQL thô cho người dùng.
--
-- Tham khảo cú pháp procedure:
-- https://mariadb.com/docs/server/server-usage/stored-routines/stored-procedures/create-procedure
-- ============================================================================
-- ============================================================================
-- TÀI KHOẢN MẪU: chỉ để phát triển và kiểm tra chức năng.
-- Email: demo.la@example.com
-- SĐT giao diện: 0901234567 | SĐT lưu trong users.phone: +84901234567
-- Mật khẩu ban đầu: LaDemo@123456
-- Không tạo danh tính Google/Facebook giả, phiên đăng nhập hoặc token reset sẵn.
-- Các dữ liệu đó chỉ phát sinh sau khi backend xử lý chức năng tương ứng.
-- Nếu email hoặc SĐT đã tồn tại, bỏ qua DEMO; không ghi đè mật khẩu/trạng thái cũ.
-- Nếu bạn đã đổi mật khẩu DEMO, import lại không đặt về mật khẩu ban đầu.
-- ============================================================================


-- ============================================================================
-- KIỂM TRA NGAY SAU IMPORT (chỉ SELECT/CALL tra cứu, không đổi mật khẩu):
-- SELECT id, email, phone, display_name, status FROM users;
-- CALL la_auth_check_login_identifier('email', 'demo.la@example.com');
-- CALL la_auth_check_login_identifier('phone', '0901234567');
-- Hai CALL trên trả allow_password = 1 khi tài khoản DEMO vừa được tạo.
-- CALL la_auth_check_login_identifier('email', 'chua-dang-ky@example.com');
-- CALL la_auth_check_login_identifier('phone', '0901234568');
-- Hai CALL trên trả cảnh báo chưa đăng ký nếu các thông tin đó chưa tồn tại.
--
-- Đăng ký tài khoản thật: gọi la_auth_register từ Node.js với hash mật khẩu.
-- Quên mật khẩu DEMO: có thể thử phát hành/kiểm tra token trong backend,
-- nhưng không gửi được mail tới bạn qua email mẫu example.com.
-- Để kiểm thử nhận mail, đăng ký tài khoản mới bằng email thật bạn sở hữu
-- và cấu hình SMTP trong Node.js. SQL không tự gửi mail.
-- ============================================================================

-- ============================================================================
-- BỔ SUNG V1: HỒ SƠ BẮT BUỘC SAU ĐĂNG NHẬP + XÁC THỰC EMAIL HOẶC SĐT
-- Database qlthuchi. Phần này đã nằm trong file đầy đủ, không cần import riêng.
-- Migration thêm cột cho bảng users CŨ, không chỉ CREATE TABLE IF NOT EXISTS.
-- Tài khoản cũ chưa hoàn tất cũng có onboarding_completed_at NULL.
-- Tuổi tính từ birth_date; monthly_income là VND, 0 là giá trị hợp lệ.
-- Hoàn tất = có hồ sơ hợp lệ VÀ ít nhất một kênh liên hệ đã xác thực.
-- SQL không tự gửi OTP. Node.js gửi email qua SMTP hoặc SĐT qua dịch vụ SMS.
-- ============================================================================
USE `qlthuchi`;
SET @la_onboarding_previous_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DELIMITER $$
DROP PROCEDURE IF EXISTS `la_migrate_onboarding_v1`$$
CREATE PROCEDURE `la_migrate_onboarding_v1`()
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND column_name = 'phone_verified_at'
  ) THEN
    ALTER TABLE `users` ADD COLUMN `phone_verified_at` DATETIME(6) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND column_name = 'onboarding_completed_at'
  ) THEN
    ALTER TABLE `users` ADD COLUMN `onboarding_completed_at` DATETIME(6) DEFAULT NULL;
  END IF;
END$$
CALL `la_migrate_onboarding_v1`()$$
DROP PROCEDURE `la_migrate_onboarding_v1`$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS `user_profiles` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `birth_date` DATE NOT NULL,
  `hometown` VARCHAR(150) NOT NULL,
  `monthly_income` DECIMAL(15,2) NOT NULL,
  `usage_purpose` ENUM('track_expenses','save_money','control_budget','repay_debt','other') NOT NULL,
  `usage_purpose_note` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profile_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_profile_name` CHECK (CHAR_LENGTH(TRIM(`full_name`)) > 0),
  CONSTRAINT `ck_profile_hometown` CHECK (CHAR_LENGTH(TRIM(`hometown`)) > 0),
  CONSTRAINT `ck_profile_income` CHECK (`monthly_income` >= 0),
  CONSTRAINT `ck_profile_other_purpose` CHECK (
    `usage_purpose` <> 'other'
    OR (`usage_purpose_note` IS NOT NULL AND CHAR_LENGTH(TRIM(`usage_purpose_note`)) > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_contact_verifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `channel` ENUM('email','phone') NOT NULL,
  `destination` VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `auth_version_at_issue` INT UNSIGNED NOT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `expires_at` DATETIME(6) NOT NULL,
  `used_at` DATETIME(6) DEFAULT NULL,
  `revoked_at` DATETIME(6) DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contact_request_key` (`request_key`),
  KEY `idx_contact_user_channel_created` (`user_id`,`channel`,`created_at`),
  KEY `idx_contact_expiry` (`expires_at`),
  CONSTRAINT `fk_contact_verification_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_contact_request_key` CHECK (`request_key` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `ck_contact_hash` CHECK (`token_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `ck_contact_attempts` CHECK (
    `max_attempts` BETWEEN 1 AND 10 AND `attempts` <= `max_attempts`
  ),
  CONSTRAINT `ck_contact_expiry` CHECK (`expires_at` > `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

-- Đổi email/SĐT thì hủy xác thực kênh đó. Kênh còn lại đã xác thực vẫn hợp lệ.
-- Chỉ tác động khi liên hệ đổi hoặc không còn kênh nào đã xác thực.
DROP TRIGGER IF EXISTS `la_users_contact_verification_guard`$$
CREATE TRIGGER `la_users_contact_verification_guard`
BEFORE UPDATE ON `users`
FOR EACH ROW
BEGIN
  IF NOT (BINARY NEW.email <=> BINARY OLD.email) THEN
    SET NEW.email_verified_at = NULL;
  END IF;
  IF NOT (NEW.phone <=> OLD.phone) OR NEW.phone IS NULL THEN
    SET NEW.phone_verified_at = NULL;
  END IF;
  IF NEW.email_verified_at IS NULL
    AND (NEW.phone IS NULL OR NEW.phone_verified_at IS NULL)
  THEN
    SET NEW.onboarding_completed_at = NULL;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `la_onboarding_get_state`$$
CREATE PROCEDURE `la_onboarding_get_state`(IN p_user_id BIGINT UNSIGNED)
SQL SECURITY INVOKER
READS SQL DATA
BEGIN
  SELECT u.id AS user_id, u.email, u.phone, u.display_name,
    u.email_verified_at, u.phone_verified_at, u.onboarding_completed_at,
    (p.user_id IS NOT NULL) AS profile_complete,
    (u.email_verified_at IS NOT NULL OR
      (u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL)) AS contact_verified,
    IF(u.onboarding_completed_at IS NOT NULL AND p.user_id IS NOT NULL AND
      (u.email_verified_at IS NOT NULL OR
        (u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL)), 0, 1)
      AS needs_onboarding,
    p.full_name, p.birth_date, TIMESTAMPDIFF(YEAR, p.birth_date, UTC_DATE()) AS age,
    p.hometown, p.monthly_income, p.usage_purpose, p.usage_purpose_note
  FROM `users` u LEFT JOIN `user_profiles` p ON p.user_id = u.id
  WHERE u.id = p_user_id AND u.status = 'active'
  LIMIT 1;
END$$

-- Lưu đủ các trường hồ sơ; chưa đánh dấu hoàn tất nếu chưa bấm Hoàn tất.
DROP PROCEDURE IF EXISTS `la_onboarding_save_profile`$$
CREATE PROCEDURE `la_onboarding_save_profile`(
  IN p_user_id BIGINT UNSIGNED,
  IN p_full_name VARCHAR(100),
  IN p_birth_date DATE,
  IN p_hometown VARCHAR(150),
  IN p_monthly_income DECIMAL(15,2),
  IN p_usage_purpose VARCHAR(32),
  IN p_usage_purpose_note VARCHAR(255)
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_status VARCHAR(16) DEFAULT NULL;
  DECLARE v_name VARCHAR(100);
  DECLARE v_hometown VARCHAR(150);
  DECLARE v_purpose VARCHAR(32);
  DECLARE v_note VARCHAR(255);
  DECLARE v_now DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET v_name = TRIM(p_full_name);
  SET v_hometown = TRIM(p_hometown);
  SET v_purpose = LOWER(TRIM(p_usage_purpose));
  SET v_note = NULLIF(TRIM(p_usage_purpose_note), '');
  IF v_name IS NULL OR v_name = '' OR v_hometown IS NULL OR v_hometown = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ONBOARDING_PROFILE_REQUIRED';
  END IF;
  IF p_birth_date IS NULL OR p_birth_date > UTC_DATE()
    OR p_birth_date < DATE_SUB(UTC_DATE(), INTERVAL 120 YEAR) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ONBOARDING_INVALID_BIRTH_DATE';
  END IF;
  IF p_monthly_income IS NULL OR p_monthly_income < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ONBOARDING_INVALID_INCOME';
  END IF;
  IF v_purpose IS NULL OR v_purpose NOT IN
    ('track_expenses','save_money','control_budget','repay_debt','other')
    OR (v_purpose = 'other' AND v_note IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ONBOARDING_INVALID_PURPOSE';
  END IF;
  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;
    SELECT status INTO v_status FROM users WHERE id = p_user_id FOR UPDATE;
  END;
  IF v_status IS NULL OR v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_LOGIN_AGAIN';
  END IF;
  SET v_now = UTC_TIMESTAMP(6);
  INSERT INTO user_profiles (user_id,full_name,birth_date,hometown,monthly_income,
    usage_purpose,usage_purpose_note,created_at,updated_at)
  VALUES (p_user_id,v_name,p_birth_date,v_hometown,p_monthly_income,
    v_purpose,v_note,v_now,v_now)
  ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),birth_date=VALUES(birth_date),
    hometown=VALUES(hometown),monthly_income=VALUES(monthly_income),
    usage_purpose=VALUES(usage_purpose),usage_purpose_note=VALUES(usage_purpose_note),
    updated_at=VALUES(updated_at);
  UPDATE users SET display_name=v_name,updated_at=v_now WHERE id=p_user_id;
  COMMIT;
  CALL la_onboarding_get_state(p_user_id);
END$$

-- OTP 6 số do Node.js tạo bằng crypto.randomInt, không lưu OTP nguyên văn.
-- request_key: randomBytes(32).toString('hex'), là challenge ID công khai.
-- token_hash: HMAC-SHA256(OTP_PEPPER,
--   JSON.stringify([request_key,String(user_id),channel,destination,otp])).hex
-- OTP_PEPPER chỉ giữ trong biến môi trường Node.js, không lưu trong SQL.
-- p_expected_destination lấy từ DB, không nhận email/SĐT tùy ý từ client.
DROP PROCEDURE IF EXISTS `la_onboarding_issue_verification`$$
CREATE PROCEDURE `la_onboarding_issue_verification`(
  IN p_user_id BIGINT UNSIGNED,
  IN p_channel VARCHAR(16),
  IN p_expected_destination VARCHAR(254),
  IN p_request_key VARCHAR(64),
  IN p_token_hash VARCHAR(64),
  IN p_ttl_minutes INT
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_status VARCHAR(16) DEFAULT NULL;
  DECLARE v_destination VARCHAR(254);
  DECLARE v_channel VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_version INT UNSIGNED;
  DECLARE v_verified DATETIME(6);
  DECLARE v_last_sent DATETIME(6);
  DECLARE v_day_start DATETIME(6);
  DECLARE v_sent_today INT UNSIGNED;
  DECLARE v_now DATETIME(6);
  DECLARE v_id BIGINT UNSIGNED;
  DECLARE v_expires DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET v_channel = LOWER(TRIM(p_channel));
  IF v_channel IS NULL OR v_channel NOT IN ('email','phone') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_INVALID_CHANNEL';
  END IF;
  IF p_request_key IS NULL OR CHAR_LENGTH(p_request_key) <> 64
    OR p_request_key NOT REGEXP '^[0-9a-f]{64}$'
    OR p_token_hash IS NULL OR CHAR_LENGTH(p_token_hash) <> 64
    OR p_token_hash NOT REGEXP '^[0-9a-f]{64}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_INVALID_HASH';
  END IF;
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_ttl_minutes > 10 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_INVALID_TTL';
  END IF;
  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;
    SELECT status,auth_version,
      IF(v_channel='email',email,phone),
      IF(v_channel='email',email_verified_at,phone_verified_at)
    INTO v_status,v_version,v_destination,v_verified
    FROM users WHERE id=p_user_id FOR UPDATE;
  END;
  IF v_status IS NULL OR v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_LOGIN_AGAIN';
  END IF;
  IF v_destination IS NULL OR v_destination = ''
    OR NOT (BINARY v_destination <=> BINARY p_expected_destination) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_CONTACT_CHANGED';
  END IF;
  IF v_verified IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_ALREADY_VERIFIED';
  END IF;
  SET v_now=UTC_TIMESTAMP(6);
  SET v_day_start=DATE_SUB(DATE(DATE_ADD(v_now, INTERVAL 7 HOUR)), INTERVAL 7 HOUR);
  SELECT COUNT(*) INTO v_sent_today FROM user_contact_verifications
  WHERE user_id=p_user_id AND created_at>=v_day_start AND created_at<DATE_ADD(v_day_start, INTERVAL 1 DAY);
  IF v_sent_today >= 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_DAILY_LIMIT';
  END IF;
  SELECT MAX(created_at) INTO v_last_sent FROM user_contact_verifications
  WHERE user_id=p_user_id AND channel=v_channel;
  IF v_last_sent IS NOT NULL AND v_last_sent > DATE_SUB(v_now, INTERVAL 60 SECOND) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_RESEND_TOO_SOON';
  END IF;
  SET v_expires=DATE_ADD(v_now, INTERVAL p_ttl_minutes MINUTE);
  UPDATE user_contact_verifications SET revoked_at=v_now
  WHERE user_id=p_user_id AND channel=v_channel AND used_at IS NULL AND revoked_at IS NULL;
  INSERT INTO user_contact_verifications
    (user_id,channel,destination,request_key,token_hash,auth_version_at_issue,
      attempts,max_attempts,expires_at,created_at)
  VALUES (p_user_id,v_channel,v_destination,p_request_key,p_token_hash,v_version,
    0,5,v_expires,v_now);
  SET v_id=LAST_INSERT_ID();
  COMMIT;
  SELECT v_id AS verification_id,p_request_key AS challenge_id,
    v_channel AS channel,v_destination AS destination,v_expires AS expires_at,
    60 AS resend_after_seconds, GREATEST(0,4-CAST(v_sent_today AS SIGNED)) AS remaining_today,
    DATE_ADD(v_day_start, INTERVAL 1 DAY) AS resets_at;
END$$

-- Sai OTP vẫn COMMIT số lần sai. Không SIGNAL+ROLLBACK mất bộ đếm thử.
-- Dùng khóa users trước rồi challenge để thống nhất với các luồng auth cũ.
DROP PROCEDURE IF EXISTS `la_onboarding_verify_contact`$$
CREATE PROCEDURE `la_onboarding_verify_contact`(
  IN p_user_id BIGINT UNSIGNED,
  IN p_request_key VARCHAR(64),
  IN p_submitted_hash VARCHAR(64)
)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_status VARCHAR(16) DEFAULT NULL;
  DECLARE v_version INT UNSIGNED;
  DECLARE v_email VARCHAR(254);
  DECLARE v_phone VARCHAR(20);
  DECLARE v_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_channel VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_destination VARCHAR(254);
  DECLARE v_hash CHAR(64);
  DECLARE v_issue_version INT UNSIGNED;
  DECLARE v_attempts INT;
  DECLARE v_max INT;
  DECLARE v_expires DATETIME(6);
  DECLARE v_used DATETIME(6);
  DECLARE v_revoked DATETIME(6);
  DECLARE v_now DATETIME(6);
  DECLARE v_code VARCHAR(32) DEFAULT 'VERIFY_NOT_FOUND';
  DECLARE v_remaining INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  IF p_request_key IS NULL OR CHAR_LENGTH(p_request_key) <> 64
    OR p_request_key NOT REGEXP '^[0-9a-f]{64}$'
    OR p_submitted_hash IS NULL OR CHAR_LENGTH(p_submitted_hash) <> 64
    OR p_submitted_hash NOT REGEXP '^[0-9a-f]{64}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VERIFY_INVALID_HASH';
  END IF;
  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;
    SELECT status,auth_version,email,phone INTO v_status,v_version,v_email,v_phone
    FROM users WHERE id=p_user_id FOR UPDATE;
  END;
  IF v_status IS NULL OR v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_LOGIN_AGAIN';
  END IF;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_id = NULL;
    SELECT id,channel,destination,token_hash,auth_version_at_issue,attempts,
      max_attempts,expires_at,used_at,revoked_at
    INTO v_id,v_channel,v_destination,v_hash,v_issue_version,v_attempts,
      v_max,v_expires,v_used,v_revoked
    FROM user_contact_verifications
    WHERE request_key=p_request_key AND user_id=p_user_id FOR UPDATE;
  END;
  SET v_now=UTC_TIMESTAMP(6);
  IF v_id IS NOT NULL THEN
    SET v_remaining=GREATEST(v_max-v_attempts,0);
    IF v_used IS NOT NULL THEN
      SET v_code='VERIFY_ALREADY_USED';
    ELSEIF v_revoked IS NOT NULL THEN
      SET v_code='VERIFY_REVOKED';
    ELSEIF v_expires <= v_now THEN
      SET v_code='VERIFY_EXPIRED';
    ELSEIF v_issue_version <> v_version OR
      NOT (BINARY v_destination <=> BINARY IF(v_channel='email',v_email,v_phone)) THEN
      SET v_code='VERIFY_CONTACT_CHANGED';
      UPDATE user_contact_verifications SET revoked_at=v_now WHERE id=v_id;
    ELSEIF v_attempts >= v_max THEN
      SET v_code='VERIFY_ATTEMPTS_EXCEEDED';
      UPDATE user_contact_verifications SET revoked_at=v_now WHERE id=v_id;
    ELSEIF BINARY v_hash <> BINARY p_submitted_hash THEN
      SET v_attempts=v_attempts+1;
      SET v_remaining=GREATEST(v_max-v_attempts,0);
      SET v_code=IF(v_remaining=0,'VERIFY_ATTEMPTS_EXCEEDED','VERIFY_CODE_INVALID');
      UPDATE user_contact_verifications SET attempts=v_attempts,
        revoked_at=IF(v_remaining=0,v_now,NULL) WHERE id=v_id;
    ELSE
      SET v_code='VERIFY_SUCCESS';
      UPDATE user_contact_verifications SET used_at=v_now WHERE id=v_id;
      UPDATE user_contact_verifications SET revoked_at=v_now
      WHERE user_id=p_user_id AND channel=v_channel AND id<>v_id
        AND used_at IS NULL AND revoked_at IS NULL;
      IF v_channel='email' THEN
        UPDATE users SET email_verified_at=v_now,updated_at=v_now WHERE id=p_user_id;
      ELSE
        UPDATE users SET phone_verified_at=v_now,updated_at=v_now WHERE id=p_user_id;
      END IF;
    END IF;
  END IF;
  COMMIT;
  SELECT v_code AS code,IF(v_code='VERIFY_SUCCESS',1,0) AS verified,
    v_remaining AS attempts_remaining;
END$$

DROP PROCEDURE IF EXISTS `la_onboarding_complete`$$
CREATE PROCEDURE `la_onboarding_complete`(IN p_user_id BIGINT UNSIGNED)
SQL SECURITY INVOKER
MODIFIES SQL DATA
BEGIN
  DECLARE v_status VARCHAR(16) DEFAULT NULL;
  DECLARE v_verified TINYINT DEFAULT 0;
  DECLARE v_name VARCHAR(100) DEFAULT NULL;
  DECLARE v_birth DATE;
  DECLARE v_home VARCHAR(150);
  DECLARE v_income DECIMAL(15,2);
  DECLARE v_purpose VARCHAR(32);
  DECLARE v_note VARCHAR(255);
  DECLARE v_now DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  START TRANSACTION;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;
    SELECT status,(email_verified_at IS NOT NULL OR
      (phone IS NOT NULL AND phone_verified_at IS NOT NULL))
    INTO v_status,v_verified FROM users WHERE id=p_user_id FOR UPDATE;
  END;
  IF v_status IS NULL OR v_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUTH_LOGIN_AGAIN';
  END IF;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_name = NULL;
    SELECT full_name,birth_date,hometown,monthly_income,usage_purpose,usage_purpose_note
    INTO v_name,v_birth,v_home,v_income,v_purpose,v_note
    FROM user_profiles WHERE user_id=p_user_id FOR UPDATE;
  END;
  IF v_name IS NULL OR TRIM(v_name)='' OR v_home IS NULL OR TRIM(v_home)=''
    OR v_birth IS NULL OR v_birth>UTC_DATE()
    OR v_birth<DATE_SUB(UTC_DATE(), INTERVAL 120 YEAR)
    OR v_income IS NULL OR v_income<0
    OR v_purpose IS NULL OR v_purpose NOT IN
      ('track_expenses','save_money','control_budget','repay_debt','other')
    OR (v_purpose='other' AND (v_note IS NULL OR TRIM(v_note)='')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ONBOARDING_PROFILE_REQUIRED';
  END IF;
  IF v_verified = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ONBOARDING_CONTACT_NOT_VERIFIED';
  END IF;
  SET v_now=UTC_TIMESTAMP(6);
  UPDATE users SET onboarding_completed_at=COALESCE(onboarding_completed_at,v_now),
    display_name=v_name,updated_at=v_now WHERE id=p_user_id;
  COMMIT;
  CALL la_onboarding_get_state(p_user_id);
END$$
DELIMITER ;

SET SESSION sql_mode = @la_onboarding_previous_sql_mode;

-- Finance ledger. Balances and period totals are derived from active rows.
CREATE TABLE IF NOT EXISTS finance_wallets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  UNIQUE KEY uq_fin_wallet_owner (user_id,id),
  UNIQUE KEY uq_fin_wallet_name (user_id,name),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE finance_wallets
  ADD COLUMN IF NOT EXISTS kind ENUM('cash','bank','ewallet','credit') NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS opening_amount DECIMAL(18,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(18,0) NULL,
  ADD COLUMN IF NOT EXISTS payment_due DATE NULL,
  ADD COLUMN IF NOT EXISTS note VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS archived_at DATETIME(6) NULL;

CREATE TABLE IF NOT EXISTS finance_wallet_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_id BIGINT UNSIGNED NOT NULL,
  related_wallet_id BIGINT UNSIGNED NULL,
  operation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('transfer','adjustment','payment') NOT NULL,
  delta DECIMAL(30,0) NOT NULL,
  movement_date DATE NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  note VARCHAR(500) NOT NULL,
  UNIQUE KEY uq_fin_wallet_operation (user_id,operation_key,wallet_id),
  KEY idx_fin_wallet_movement_date (user_id,wallet_id,movement_date,id),
  FOREIGN KEY (user_id,wallet_id) REFERENCES finance_wallets(user_id,id),
  FOREIGN KEY (user_id,related_wallet_id) REFERENCES finance_wallets(user_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('income','expense') NOT NULL,
  name VARCHAR(80) NOT NULL,
  icon VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  UNIQUE KEY uq_fin_category_owner (user_id,id,kind),
  UNIQUE KEY uq_fin_category_name (user_id,kind,name),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE finance_categories
  ADD COLUMN IF NOT EXISTS color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN IF NOT EXISTS hidden_at DATETIME(6) NULL,
  ADD COLUMN IF NOT EXISTS default_key VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_fin_category_default (user_id,default_key);

CREATE TABLE IF NOT EXISTS user_finance_settings (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  number_style ENUM('dots','commas') NOT NULL DEFAULT 'dots',
  cycle_start_day TINYINT UNSIGNED NOT NULL DEFAULT 1 CHECK (cycle_start_day BETWEEN 1 AND 31),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('income','expense') NOT NULL,
  amount DECIMAL(18,0) NOT NULL CHECK (amount > 0),
  wallet_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  transaction_date DATE NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(6) NULL,
  UNIQUE KEY uq_fin_tx_owner (user_id,id),
  KEY idx_fin_tx_date (user_id,deleted_at,transaction_date,id),
  KEY idx_fin_tx_wallet (user_id,wallet_id,deleted_at),
  KEY idx_fin_tx_category (user_id,category_id,kind),
  FOREIGN KEY (user_id,wallet_id) REFERENCES finance_wallets(user_id,id),
  FOREIGN KEY (user_id,category_id,kind) REFERENCES finance_categories(user_id,id,kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_transaction_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  action ENUM('create','update','delete') NOT NULL,
  before_state JSON NULL,
  after_state JSON NULL,
  changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_fin_history (user_id,transaction_id,id),
  FOREIGN KEY (user_id,transaction_id) REFERENCES finance_transactions(user_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_goals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  target_amount DECIMAL(18,0) NOT NULL CHECK (target_amount > 0),
  saved_amount DECIMAL(18,0) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
  due_date DATE NULL,
  note VARCHAR(500) NULL,
  deleted_at DATETIME(6) NULL,
  KEY idx_fin_goal_owner (user_id,id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE finance_goals
  ADD COLUMN IF NOT EXISTS due_date DATE NULL,
  ADD COLUMN IF NOT EXISTS note VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME(6) NULL;

CREATE TABLE IF NOT EXISTS finance_budgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('income','expense') NOT NULL DEFAULT 'expense' CHECK (kind='expense'),
  period DATE NOT NULL CHECK (DAYOFMONTH(period)=1),
  base_amount DECIMAL(18,0) NOT NULL CHECK (base_amount>0),
  carry_amount DECIMAL(24,0) NOT NULL DEFAULT 0 CHECK (carry_amount>=0),
  threshold TINYINT UNSIGNED NOT NULL DEFAULT 80 CHECK (threshold BETWEEN 1 AND 100),
  auto_renew TINYINT UNSIGNED NOT NULL DEFAULT 0 CHECK (auto_renew IN (0,1)),
  UNIQUE KEY uq_fin_budget_period (user_id,category_id,period),
  KEY idx_fin_budget_renewal (auto_renew,period,user_id),
  FOREIGN KEY (user_id,category_id,kind) REFERENCES finance_categories(user_id,id,kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NODE.JS / FRONTEND:
-- Sau login và ở /me: CALL la_onboarding_get_state(userId-từ-session).
-- needs_onboarding=1 -> /onboarding. needs_onboarding=0 -> trang chủ hiện có.
-- Backend chặn API nghiệp vụ bằng 403 ONBOARDING_REQUIRED nếu chưa xong.
-- /onboarding/*, /me và /logout dùng auth session nhưng không dùng gate này.
-- Lưu hồ sơ và xác thực có thể làm ở bất kỳ thứ tự nào; hoàn tất cần cả hai.
-- Mọi p_user_id lấy từ session đã xác thực, không lấy từ body/query client.
-- Khi gửi OTP thất bại, Node.js thu hồi đúng verification_id vừa tạo:
-- UPDATE user_contact_verifications SET revoked_at=UTC_TIMESTAMP(6)
-- WHERE id=? AND user_id=? AND used_at IS NULL AND revoked_at IS NULL;
-- Khi kiểm tra OTP, Node.js đọc challenge theo request_key VÀ session user_id
-- để tính lại HMAC với destination/channel đã lưu, rồi CALL verify_contact.
-- Không trả/log OTP, token_hash hoặc OTP_PEPPER. challenge_id được trả cho client.
-- OTP mặc định hạn 5 phút, 5 lần thử, chờ 60 giây trước gửi lại.
-- Không tự đặt cờ verified/completed theo request client; chỉ dùng các procedure.
-- Đổi email/SĐT cần endpoint riêng kiểm tra mật khẩu, UNIQUE, chuẩn hóa liên hệ;
-- onboarding chỉ xác thực liên hệ đang có, không cho tùy ý đổi người nhận OTP.

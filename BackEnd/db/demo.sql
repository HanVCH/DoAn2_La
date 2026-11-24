USE `qlthuchi`;
SET time_zone = '+00:00';
INSERT INTO `users` (
  `email`, `phone`, `password_hash`, `display_name`, `status`, `auth_version`,
  `password_changed_at`, `created_at`, `updated_at`
)
SELECT
  'demo.la@example.com', '+84901234567',
  '$2a$12$EwGIhtswPcSZ3D/yykUWrehEbawo6g/3D/jTNniDFVdL20F2sAqmW',
  'Tài khoản mẫu LÁ', 'active', 0,
  UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
WHERE NOT EXISTS (
  SELECT 1 FROM `users`
  WHERE `email` = 'demo.la@example.com' OR `phone` = '+84901234567'
);
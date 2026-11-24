import { readConfig } from '../config.js';
import { initializeSchema } from './schema-tools.js';

try {
  await initializeSchema(readConfig().database);
  console.log('Đã khởi tạo/kiểm tra qlthuchi. Dữ liệu tài khoản được giữ nguyên; không thêm demo.');
} catch (error) {
  console.error('Không thể khởi tạo database:', ['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code) ? 'Hãy bật MySQL trong XAMPP và kiểm tra DB_HOST/DB_PORT.' : error.code === 'ER_ACCESS_DENIED_ERROR' ? 'Kiểm tra DB_USER và DB_PASSWORD trong .env.' : error.code ? error.code : error.message);
  process.exitCode = 1;
}

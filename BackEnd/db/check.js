import mysql from 'mysql2/promise';
import { readConfig } from '../config.js';
import { inspectSchema, checkProcedures } from './schema-tools.js';

let connection;
try {
  const settings = readConfig().database;
  if (!settings.user) throw new Error('Chưa cấu hình DB_USER trong .env.');
  connection = await mysql.createConnection(settings);
  await connection.query("SET time_zone = '+00:00'");
  const problems = [...await inspectSchema(connection, settings.database), ...await checkProcedures(connection, settings.database)];
  if (problems.length) throw new Error(problems.join('\n') + '\nChạy npm run db:migrate nếu thiếu bảng/procedure. Bảng cũ khác cấu trúc cần migration riêng.');
  console.log('qlthuchi: đủ bảng xác thực và giao dịch, 13 procedure và trigger xác thực liên hệ; kết nối UTC thành công.');
} catch (error) {
  console.error('Database chưa sẵn sàng:', error.code || error.message);
  process.exitCode = 1;
} finally { await connection?.end(); }

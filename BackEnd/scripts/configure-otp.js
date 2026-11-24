import { randomBytes } from 'node:crypto';
import { readFile,writeFile,copyFile } from 'node:fs/promises';

const filename = new URL('../../.env',import.meta.url);
let source;
try { source = await readFile(filename,'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await copyFile(new URL('../../.env.example',import.meta.url),filename);
  source = await readFile(filename,'utf8');
}
const current = source.match(/^OTP_PEPPER\s*=\s*([^\r\n]*)/m)?.[1]?.trim();
if (current && !['""',"''"].includes(current)) {
  console.log('OTP_PEPPER đã tồn tại; giữ nguyên khóa để các mã đang chờ vẫn hợp lệ.');
} else {
  const line = 'OTP_PEPPER=' + randomBytes(32).toString('base64');
  source = /^OTP_PEPPER\s*=/m.test(source) ? source.replace(/^OTP_PEPPER[^\r\n]*/m,line) : source + '\n' + line + '\n';
  await writeFile(filename,source,{mode:0o600});
  console.log('Đã tạo OTP_PEPPER ngẫu nhiên trong .env. Giá trị không được hiển thị.');
}

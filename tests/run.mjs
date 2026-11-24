import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import mysql from 'mysql2/promise';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv[2] || 'all';
const candidates = [process.env.MARIADB_BIN, 'D:/xampp/mysql/bin', 'C:/xampp/mysql/bin'].filter(Boolean);
const bin = candidates.find(dir => existsSync(path.join(dir, process.platform === 'win32' ? 'mysqld.exe' : 'mysqld')));
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
}
let daemon, browserServer, log, testDatabase;
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (child.connected) child.send('shutdown');
  else child.kill();
  let timer;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill(); resolve(); }, 5000); })]);
  clearTimeout(timer);
}
try {
  if (!bin) throw new Error('Không tìm thấy MariaDB. Đặt MARIADB_BIN tới thư mục bin của XAMPP để chạy test biệt lập.');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = path.join(root, 'artifacts/test-data/mariadb');
  mkdirSync(path.dirname(data), { recursive: true });
  if (!existsSync(path.join(data, 'mysql'))) {
    const code = await run(path.join(bin, process.platform === 'win32' ? 'mysql_install_db.exe' : 'mariadb-install-db'), [`--datadir=${data}`, `--port=${port}`, '--silent']);
    if (code) throw new Error('Không thể khởi tạo MariaDB test.');
  }
  log = openSync(path.join(root, 'artifacts/test-data/mariadb-test.log'), 'a');
  daemon = spawn(path.join(bin, process.platform === 'win32' ? 'mysqld.exe' : 'mysqld'), [
    '--no-defaults', `--basedir=${path.dirname(bin)}`, `--datadir=${data}`, `--port=${port}`,
    '--bind-address=127.0.0.1', '--skip-log-bin', '--innodb-buffer-pool-size=32M', '--console',
  ], { cwd: root, windowsHide: true, stdio: ['ignore', log, log] });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (daemon.exitCode !== null) throw new Error('MariaDB test đã dừng. Xem artifacts/test-data/mariadb-test.log.');
    try { const connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '' }); await connection.end(); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!ready) throw new Error('MariaDB test khởi động quá lâu.');
  const env = { ...process.env, TEST_DB_HOST: '127.0.0.1', TEST_DB_PORT: String(port), TEST_DB_USER: 'root', TEST_DB_PASSWORD: '' };
  testDatabase = { host: '127.0.0.1', port, user: 'root', password: '' };
  console.log('MariaDB test biệt lập đã sẵn sàng; không kết nối database người dùng.');
  let code = 0;
  if (['all', 'backend'].includes(mode)) code = await run(process.execPath, ['--test', '--test-concurrency=1', 'tests/backend/*.test.mjs'], env);
  if (!code && mode !== 'backend') {
    // Own the server directly. IPC shutdown works on Windows without taskkill
    // or process-tree permissions and allows the fixture to release SQL/SMTP.
    browserServer = spawn(process.execPath, ['tests/support/browser-server.mjs'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser fixture startup timed out')), 15000);
      browserServer.once('error', error => { clearTimeout(timer); reject(error); });
      browserServer.once('exit', code => { clearTimeout(timer); reject(new Error(`Browser fixture exited: ${code}`)); });
      browserServer.once('message', message => { if (message === 'ready') { clearTimeout(timer); resolve(); } });
    });
    code = await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...(mode === 'ui' ? ['--ui'] : []), ...process.argv.slice(3)], { ...env, LA_TEST_MANAGED_SERVER: 'true' });
  }
  process.exitCode = code;
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await stopChild(browserServer);
  if (daemon && daemon.exitCode === null) {
    if (testDatabase) {
      let admin;
      try { admin = await mysql.createConnection(testDatabase); await admin.query('SHUTDOWN'); }
      catch { /* Fall back to stopping only our spawned test daemon. */ }
      finally { await admin?.end().catch(() => {}); }
    }
    await stopChild(daemon);
  }
  if (log !== undefined) closeSync(log);
}

import { startFixture } from './fixture.mjs';
import { hashPassword } from '../../BackEnd/services/passwords.js';
import { normalizePhone } from '../../shared/auth-policy.mjs';
const fixture = await startFixture({ port: 3100 });
const encoded = await hashPassword('LaCu2026');
for (const [email, phone, hash] of [
  ['recovery-ui@gmail.com','0911111111',encoded],
  ['recovery-flow@gmail.com','0922222222',encoded],
  ['recovery-support@gmail.com','0933333333',null],
  ['login-ui@gmail.com','0944444444',encoded],
  ['app-shell@gmail.com','0955555555',encoded],
]) await fixture.db.execute('INSERT INTO users(email,phone,password_hash) VALUES (?,?,?)',[email,normalizePhone(phone),hash]);
// A completed synthetic account for layout/navigation tests, isolated from user data.
const [shellUser] = await fixture.db.execute('SELECT id FROM users WHERE email=?',['app-shell@gmail.com']);
await fixture.db.call('la_onboarding_save_profile',[shellUser.id,'Trần Thảo Nguyên','1998-06-12','Đà Nẵng','18000000.00','save_money',null]);
await fixture.db.execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP(6) WHERE id=?',[shellUser.id]);
await fixture.db.call('la_onboarding_complete',[shellUser.id]);
// Test-only route, never mounted by production createApp.
fixture.app.get('/__test/mail', (request,response) => response.json(fixture.messages.filter(message => message.to.includes(request.query.to))));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async()=>{await fixture.close();process.exit(0);});
process.on('message', async message => {
  if (message === 'shutdown') { await fixture.close(); process.exit(0); }
});
process.send?.('ready');
console.log('LÁ browser test fixture ready on loopback.');

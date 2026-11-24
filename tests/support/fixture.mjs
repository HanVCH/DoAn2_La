import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createApp } from '../../FontEnd/app.js';
import { readConfig } from '../../BackEnd/config.js';
import { openDatabase } from '../../BackEnd/db/database.js';
import { initializeSchema } from '../../BackEnd/db/schema-tools.js';
import { createMailer } from '../../BackEnd/services/mailer.js';

export async function startFixture({ port = 0, smsAvailable = false, resendAvailable = false } = {}) {
  if (!process.env.TEST_DB_PORT) throw new Error('Dùng npm run test:backend hoặc npm run test:browser để khởi động MySQL test riêng.');
  const database = `la_test_${randomBytes(8).toString('hex')}`;
  const settings = { host: process.env.TEST_DB_HOST, port: Number(process.env.TEST_DB_PORT), user: process.env.TEST_DB_USER, password: process.env.TEST_DB_PASSWORD, database };
  if (resendAvailable) {
    // XAMPP installations can already have a database using general_ci.
    const admin = await mysql.createConnection({ ...settings, database: undefined });
    try { await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`); }
    finally { await admin.end(); }
  }
  await initializeSchema(settings);
  const messages = [], smtpState = { reject: false };
  const smtp = new SMTPServer({
    secure: false, authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], logger: false,
    onRcptTo(_address, _session, callback) {
      if (smtpState.reject) { const error = new Error('Test SMTP rejection'); error.responseCode = 550; callback(error); }
      else callback();
    },
    onData(stream, session, callback) {
      simpleParser(stream).then(mail => {
        messages.push({ to: session.envelope.rcptTo.map(address => address.address), text: mail.text, html: mail.html, subject: mail.subject }); callback();
      }, callback);
    },
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  const config = readConfig({ APP_BASE_URL: 'http://127.0.0.1' });
  config.otpPepper = randomBytes(32).toString('base64');
  config.database = settings;
  config.smtp = { host: '127.0.0.1', port: smtp.server.address().port, secure: false, requireTLS: false, from: 'LÁ <no-reply@la.test>', user: '', pass: '' };
  const resendState = { reject: false, calls: 0 };
  if (resendAvailable) { config.otpEmailProvider = 'resend'; config.resend = {apiKey:'re_test_only',from:'LÁ <onboarding@resend.dev>'}; }
  const db = openDatabase(settings), mailer = createMailer(config, {resendFetch: async (url,options) => {
    if (!resendAvailable || url !== 'https://api.resend.com/emails') throw new Error('Unexpected test request');
    resendState.calls++;
    if (resendState.reject) return new Response(JSON.stringify({message:'Rejected'}),{status:403});
    const data=JSON.parse(options.body);
    messages.push({to:data.to,text:data.text,html:data.html,subject:data.subject});
    return new Response(JSON.stringify({id:'test-email-id'}),{status:200});
  }});
  // Reserve the HTTP port before creating middleware so configured CORS origins are exact.
  const net = await import('node:net');
  if (!port) port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); }); });
  config.appBaseUrl = config.frontendOrigin = `http://127.0.0.1:${port}`;
  const smsMessages = [], smsState = { reject: false };
  const sms = { ready: smsAvailable, async sendOtp(destination,otp) { if (smsState.reject) throw new Error('Test SMS rejection'); smsMessages.push({destination,otp}); } };
  const app = createApp({ config, db, mailer, sms });
  const server = await new Promise(resolve => { const listener = app.listen(port, '127.0.0.1', () => resolve(listener)); });
  async function close() {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    await new Promise(resolve => smtp.close(resolve));
    if (!/^la_test_[a-f0-9]{16}$/.test(database)) throw new Error('Refusing to drop a non-test schema');
    const admin = await mysql.createConnection({ ...settings, database: undefined });
    try { await admin.query(`DROP DATABASE \`${database}\``); } finally { await admin.end(); }
  }
  return { app, base: config.appBaseUrl, db, mailer, config, messages, smtpState, resendState, sms, smsMessages, smsState, close };
}
export function createClient(base) {
  const cookies = new Map();
  let csrf = '';
  async function request(url, { body, method = 'GET', headers = {} } = {}) {
    const response = await fetch(`${base}${url}`, { method, redirect: 'manual', headers: {
      Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...headers,
    }, body: body ? JSON.stringify(body) : undefined });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'); const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  return {
    cookies, get: url => request(url),
    async init() { const response = await request('/api/auth/csrf'); csrf = (await response.json()).data.csrfToken; },
    post: (url, body, headers) => request(url, { method: 'POST', body, headers }),
    put: (url, body, headers) => request(url, { method: 'PUT', body, headers }),
    delete: (url, body, headers) => request(url, { method: 'DELETE', body, headers }),
  };
}
export const account = { email: 'hoiphuc@gmail.com', phone: '0912345678', password: 'LaCu2026', confirmPassword: 'LaCu2026' };
export async function register(client, data = account) { return client.post('/api/auth/register', data); }
export function lastResetToken(fixture, email = account.email) {
  return fixture.messages.filter(message => message.to.includes(email) && message.subject.includes('Yêu cầu')).at(-1)?.text.match(/token=([a-f0-9]{64})/)[1];
}
export async function setup(t) {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const client = createClient(fixture.base); await client.init();
  return { ...fixture, client };
}

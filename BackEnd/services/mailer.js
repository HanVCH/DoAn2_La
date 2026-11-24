import nodemailer from 'nodemailer';
import { createResend } from './resend.js';

export function createMailer(config, options = {}) {
  const resend = createResend(config, options.resendFetch);
  const provider = config.otpEmailProvider || 'smtp';
  const { smtp } = config;
  const ready = Boolean(config.appBaseUrl && smtp.host && smtp.from && (!smtp.user || smtp.pass));
  const transport = ready ? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  }) : null;
  async function send(to, subject, text, html) {
    if (!transport) throw new Error('MAIL_NOT_CONFIGURED');
    const result = await transport.sendMail({ from: smtp.from, to, subject, text, html });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('MAIL_NOT_ACCEPTED');
  }
  return {
    ready,
    otpReady: Boolean(config.appBaseUrl && (provider === 'resend' ? resend.ready : provider === 'smtp' && ready)),
    otpConfigurationMessage: !config.appBaseUrl ? 'Thiếu APP_BASE_URL trong cấu hình backend.' : provider === 'resend' ? resend.configurationMessage : provider === 'smtp' ? 'Chưa cấu hình SMTP để gửi email xác thực.' : 'OTP_EMAIL_PROVIDER phải là smtp hoặc resend trong BackEnd/.env.',
    async sendVerificationLink(email, token) {
      const url = new URL('/onboarding/verify-email', config.appBaseUrl);
      url.searchParams.set('token', token);
      const subject = 'LÁ - Xác thực email';
      const note = 'Liên kết có hiệu lực 5 phút và chỉ dùng một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.';
      const text = `Xác thực email tài khoản LÁ: ${url.href}\n\n${note}`;
      const html = `<div style="font-family:Arial,sans-serif;color:#233C32;background:#F6F7F2;padding:28px"><h1>lá</h1><h2>Xác thực email</h2><p><a href="${url.href}">Xác thực email</a></p><p>${note}</p></div>`;
      if (provider === 'resend') return resend.sendEmail(email, { subject, text, html });
      if (provider !== 'smtp') throw new Error('OTP_PROVIDER_INVALID');
      await send(email, subject, text, html);
    },
    async sendReset(email, token) {
      // Only the configured origin may appear in the link. Never trust Host.
      const url = new URL('/reset-password', config.appBaseUrl);
      url.searchParams.set('token', token);
      const minutes = config.tokenTtlMs / 60000;
      const text = `Bạn vừa yêu cầu đặt lại mật khẩu tài khoản LÁ.\n\nĐặt lại mật khẩu: ${url.href}\n\nLiên kết có hiệu lực ${minutes} phút và chỉ dùng một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.`;
      const html = `<div style="font-family:Arial,sans-serif;background:#F6F7F2;padding:32px;color:#233C32"><h1 style="font-size:28px">lá</h1><h2>Đặt lại mật khẩu của bạn</h2><p>Bạn vừa yêu cầu đặt lại mật khẩu tài khoản LÁ.</p><p style="margin:28px 0"><a href="${url.href}" style="display:inline-block;padding:14px 24px;background:#39664D;border-radius:12px;color:white;text-decoration:none;font-weight:bold">Đặt lại mật khẩu</a></p><p>Liên kết có hiệu lực <strong>${minutes} phút</strong> và chỉ dùng một lần.</p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.</p><p>LÁ · QUẢN LÝ THU CHI CÁ NHÂN</p></div>`;
      await send(email, 'LÁ - Yêu cầu đặt lại mật khẩu', text, html);
    },
    async sendPasswordChanged(email) {
      await send(email, 'LÁ - Mật khẩu đã được thay đổi',
        'Mật khẩu tài khoản LÁ của bạn vừa được thay đổi. Các phiên đăng nhập cũ đã được thu hồi. Nếu bạn không thực hiện thay đổi này, hãy khôi phục tài khoản hoặc liên hệ hỗ trợ ngay. Chúng tôi không bao giờ gửi mật khẩu qua email.',
        '<div style="font-family:Arial,sans-serif;color:#233C32"><h2>Mật khẩu đã được thay đổi</h2><p>Mật khẩu tài khoản LÁ của bạn vừa được thay đổi. Các phiên đăng nhập cũ đã được thu hồi.</p><p>Nếu bạn không thực hiện thay đổi này, hãy khôi phục tài khoản hoặc liên hệ hỗ trợ ngay.</p><p>Chúng tôi không bao giờ gửi mật khẩu qua email.</p></div>');
    },
    close() { transport?.close(); },
  };
}

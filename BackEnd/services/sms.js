// A real opt-in Twilio adapter; no local delivery fallback in production.
export function createSms(config, send = fetch) {
  const settings = config.sms;
  const ready = Boolean(settings.enabled && /^AC[a-f0-9]{32}$/i.test(settings.accountSid) && settings.authToken && settings.from);
  return {
    ready,
    async sendOtp(destination, otp) {
      if (!ready) throw new Error('SMS_NOT_CONFIGURED');
      const response = await send(`https://api.twilio.com/2010-04-01/Accounts/${settings.accountSid}/Messages.json`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${settings.accountSid}:${settings.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: destination, From: settings.from, Body: `Ma xac thuc LA: ${otp}. Het han sau 5 phut. Khong chia se ma nay.` }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.sid || !['accepted','scheduled','queued','sending','sent','delivered'].includes(result.status)) throw new Error('SMS_SEND_FAILED');
    },
  };
}

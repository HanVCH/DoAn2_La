const tlsErrors = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID']);

// Server-only adapter. Inject fetch in tests; never expose provider credentials/errors.
export function createResend(config, request = fetch) {
  const ready = Boolean(config.resend?.apiKey && config.resend?.from);
  const missing = ['RESEND_API_KEY', 'RESEND_FROM'].filter(name => !config.resend?.[name === 'RESEND_API_KEY' ? 'apiKey' : 'from']);
  return {
    ready,
    configurationMessage: `Thiếu ${missing.join(', ')} trong D:\\DoAn2\\BackEnd\\.env.`,
    async sendEmail(email, message) {
      if (!ready) throw new Error('RESEND_NOT_CONFIGURED');
      try {
        const response = await request('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.resend.from, to: [email], ...message }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.error || typeof data.id !== 'string' || !data.id) {
          const testRecipientDenied = response.status === 403 && /^You can only send testing emails/i.test(data?.message || '');
          const authDenied = response.status===401 || ['invalid_api_key','restricted_api_key'].includes(data?.name);
          const code = testRecipientDenied ? 'RESEND_TEST_RECIPIENT' : authDenied ? 'RESEND_AUTH_FAILED' : 'RESEND_SEND_FAILED';
          throw new Error(code);
        }
      } catch (error) {
        if (tlsErrors.has(error.cause?.code ?? error.code)) throw new Error('RESEND_TLS_FAILED');
        if (['RESEND_TEST_RECIPIENT', 'RESEND_AUTH_FAILED'].includes(error.message)) throw error;
        throw new Error('RESEND_SEND_FAILED');
      }
    },
  };
}

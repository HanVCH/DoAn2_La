import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { createToken } from './tokens.js';
import { ApiError } from '../middleware/errors.js';
import { profileInput } from '../../shared/profile-policy.mjs';

export const otpHash = (pepper, challengeId, userId, channel, destination, otp) => createHmac('sha256', pepper)
  .update(JSON.stringify([challengeId, String(userId), channel, destination, otp])).digest('hex');
const dateOnly = value => value instanceof Date ? value.toISOString().slice(0,10) : value;
const maskDestination = (channel,value) => channel === 'email' ? value.replace(/^(.).*(@.*)$/,'$1***$2') : `${value.slice(0,3)}••••${value.slice(-3)}`;
const dailyLimit = (remaining,resetAt)=>({limit:5,remaining:Number(remaining),resetAt});

async function sendLimit(db,userId) {
  const [row] = await db.execute(`SELECT GREATEST(0,5-COUNT(v.id)) AS remaining, bounds.reset_at AS resetAt
    FROM (SELECT DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 7 HOUR)),INTERVAL 7 HOUR)+INTERVAL 1 DAY AS reset_at) bounds
    LEFT JOIN user_contact_verifications v ON v.user_id=?
      AND v.created_at>=bounds.reset_at-INTERVAL 1 DAY AND v.created_at<bounds.reset_at
    GROUP BY bounds.reset_at`,[userId]);
  return dailyLimit(row.remaining,row.resetAt);
}
export async function getOnboardingState(db, userId) {
  const [row] = await db.call('la_onboarding_get_state', [String(userId)]);
  if (!row) throw new ApiError(401,'UNAUTHENTICATED','Vui lòng đăng nhập lại.');
  return { ...row, user_id: String(row.user_id), birth_date: dateOnly(row.birth_date), monthly_income: row.monthly_income === null ? null : String(row.monthly_income),
    profile_complete: Boolean(Number(row.profile_complete)), contact_verified: Boolean(Number(row.contact_verified)), needs_onboarding: Boolean(Number(row.needs_onboarding)) };
}
export const onboardingRedirect = (config, state) => state.needs_onboarding ? '/onboarding' : config.homePath;
export function createOnboardingService({ db,config,mailer,sms }) {
  const otpReady = () => Buffer.byteLength(config.otpPepper || '', 'utf8') >= 32;
  function requireOtp() {
    if (!otpReady()) throw new ApiError(503,'OTP_NOT_CONFIGURED','Dịch vụ xác thực chưa được cấu hình OTP_PEPPER.');
  }
  return {
    async state(userId) {
      const state = await getOnboardingState(db,userId);
      const pending = await db.execute(`SELECT v.request_key,v.channel,v.destination,v.expires_at,
        GREATEST(0,60-TIMESTAMPDIFF(SECOND,v.created_at,UTC_TIMESTAMP(6))) AS resend_after_seconds
        FROM user_contact_verifications v JOIN users u ON u.id=v.user_id
        WHERE v.user_id=? AND v.used_at IS NULL AND v.revoked_at IS NULL
        AND v.expires_at>UTC_TIMESTAMP(6) AND v.auth_version_at_issue=u.auth_version
        AND BINARY v.destination=BINARY IF(v.channel='email',u.email,u.phone)
        ORDER BY v.id DESC`,[String(userId)]);
      return { ...state, verification_configuration_message: !otpReady() ? 'Thiếu OTP_PEPPER trong file .env được backend đọc.' : !(mailer.otpReady ?? mailer.ready) ? mailer.otpConfigurationMessage : '', verification_methods: { email: otpReady() && (mailer.otpReady ?? mailer.ready), phone: otpReady() && sms.ready },
        verification_send_limit:await sendLimit(db,userId),
        pending_verifications: pending.map(row=>({challengeId:row.request_key,channel:row.channel,destination:maskDestination(row.channel,row.destination),expiresAt:row.expires_at,resendAfterSeconds:Number(row.resend_after_seconds)})) };
    },
    async saveProfile(userId, body) {
      const { errors,value } = profileInput(body);
      if (Object.keys(errors).length) throw new ApiError(400,'ONBOARDING_INVALID_PROFILE','Vui lòng kiểm tra thông tin hồ sơ.',{errors});
      await db.call('la_onboarding_save_profile',[String(userId),value.fullName,value.birthDate,value.hometown,value.monthlyIncome,value.usagePurpose,value.usagePurposeNote]);
      return this.state(userId);
    },
    async send(userId, channel) {
      if (!['email','phone'].includes(channel)) throw new ApiError(400,'VERIFY_INVALID_CHANNEL','Vui lòng chọn xác thực email hoặc số điện thoại.');
      requireOtp();
      if (channel === 'email' && !(mailer.otpReady ?? mailer.ready)) throw new ApiError(503,'MAIL_NOT_CONFIGURED',mailer.otpConfigurationMessage || 'Chưa cấu hình dịch vụ gửi mã email.');
      if (channel === 'phone' && !sms.ready) throw new ApiError(503,'SMS_NOT_CONFIGURED','Chưa cấu hình dịch vụ SMS. Bạn có thể chọn xác thực bằng email.');
      const state = await getOnboardingState(db,userId);
      const destination = channel === 'email' ? state.email : state.phone;
      if (!destination) throw new ApiError(400,'VERIFY_CONTACT_MISSING','Tài khoản chưa có thông tin liên hệ ở kênh này.');
      const otp = channel === 'email' ? createToken() : randomInt(0,1000000).toString().padStart(6,'0');
      const challengeId = createToken();
      let issued;
      try {
        [issued] = await db.call('la_onboarding_issue_verification',[String(userId),channel,destination,challengeId,otpHash(config.otpPepper,challengeId,userId,channel,destination,otp),5]);
      } catch (error) {
        if (error.sqlMessage === 'VERIFY_DAILY_LIMIT') {
          throw new ApiError(429,'VERIFY_DAILY_LIMIT','Bạn đã dùng hết 5 lượt gửi hôm nay. Lượt gửi được làm mới lúc 00:00 giờ Việt Nam.',
            {sendLimit:await sendLimit(db,userId)});
        }
        if (error.sqlMessage === 'VERIFY_RESEND_TOO_SOON') {
          const [row] = await db.execute('SELECT GREATEST(1, CEIL(60 - TIMESTAMPDIFF(MICROSECOND, MAX(created_at), UTC_TIMESTAMP(6))/1000000)) AS retry_after FROM user_contact_verifications WHERE user_id=? AND channel=?',[String(userId),channel]);
          throw new ApiError(429,'VERIFY_RESEND_TOO_SOON','Vui lòng chờ trước khi gửi lại mã.',{retryAfter: Math.min(60,Number(row?.retry_after || 60))});
        }
        if (['VERIFY_ALREADY_VERIFIED', 'VERIFY_CONTACT_CHANGED', 'AUTH_LOGIN_AGAIN'].includes(error.sqlMessage)) throw error;
        // Log only the database error identifier. Driver error messages can contain contact data or tokens.
        const dbCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'UNKNOWN';
        console.error('[onboarding] verification_issue_failed', { channel, dbCode, errno: Number.isInteger(error.errno) ? error.errno : undefined });
        throw new ApiError(503,'VERIFY_ISSUE_FAILED','Máy chủ chưa tạo được yêu cầu xác thực. Email chưa được gửi. Vui lòng thử lại sau.');
      }
      if (!issued) {
        console.error('[onboarding] verification_issue_no_result', { channel });
        throw new ApiError(503,'VERIFY_ISSUE_FAILED','Máy chủ chưa tạo được yêu cầu xác thực. Email chưa được gửi. Vui lòng thử lại sau.');
      }
      const quota = dailyLimit(issued.remaining_today,issued.resets_at);
      try {
        if (channel === 'email') await mailer.sendVerificationLink(issued.destination,`${challengeId}.${otp}`);
        else await sms.sendOtp(issued.destination,otp);
      } catch (error) {
        await db.execute('UPDATE user_contact_verifications SET revoked_at=UTC_TIMESTAMP(6) WHERE id=? AND user_id=? AND used_at IS NULL AND revoked_at IS NULL',[String(issued.verification_id),String(userId)]);
        const messages = {
          RESEND_TEST_RECIPIENT: 'Resend chỉ gửi thư thử tới email của chủ tài khoản Resend. Hãy dùng tài khoản LÁ có email đó hoặc cấu hình miền gửi đã xác minh.',
          RESEND_AUTH_FAILED: 'Resend từ chối xác thực. Hãy kiểm tra RESEND_API_KEY trong BackEnd/.env.',
          RESEND_TLS_FAILED: 'Máy chủ chưa xác thực được chứng chỉ HTTPS của Resend. Hãy khởi động lại LÁ bằng npm.cmd run dev trên Windows.',
        };
        const message = channel === 'email' ? messages[error.message] || 'Chưa thể gửi liên kết xác thực. Vui lòng thử lại sau.' : 'Chưa thể gửi mã xác thực. Vui lòng thử lại sau.';
        throw new ApiError(502,channel === 'email' ? 'MAIL_SEND_FAILED' : 'SMS_SEND_FAILED',message,
          {sendLimit:quota,cooldownSeconds:Number(issued.resend_after_seconds)});
      }
      const masked = maskDestination(channel,issued.destination);
      return { challengeId: issued.challenge_id, channel: issued.channel, destination: masked, expiresAt: issued.expires_at,
        resendAfterSeconds:Number(issued.resend_after_seconds),sendLimit:quota };
    },
    async confirm(userId, body) {
      requireOtp();
      if (typeof body.challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(body.challengeId) || typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp)) throw new ApiError(400,'VERIFY_INVALID_INPUT','Vui lòng nhập mã xác thực gồm đúng 6 chữ số.');
      const [challenge] = await db.execute("SELECT channel,destination FROM user_contact_verifications WHERE request_key=? AND user_id=? AND channel='phone' LIMIT 1",[body.challengeId,String(userId)]);
      if (!challenge) throw new ApiError(400,'VERIFY_NOT_FOUND','Không tìm thấy yêu cầu xác thực. Vui lòng gửi mã mới.');
      const submitted = otpHash(config.otpPepper,body.challengeId,userId,challenge.channel,challenge.destination,body.otp);
      const [result] = await db.call('la_onboarding_verify_contact',[String(userId),body.challengeId,submitted]);
      if (!result) throw new Error('Missing verification result');
      const remaining = Number(result.attempts_remaining);
      if (result.code === 'VERIFY_CODE_INVALID') throw new ApiError(400,result.code,`Mã xác thực không đúng. Bạn còn ${remaining} lần thử.`,{attemptsRemaining:remaining});
      if (result.code === 'VERIFY_ATTEMPTS_EXCEEDED') throw new ApiError(429,result.code,'Đã hết lượt thử. Vui lòng yêu cầu mã mới.',{attemptsRemaining:0});
      if (result.code !== 'VERIFY_SUCCESS') throw new ApiError(400,result.code,'Mã đã hết hạn, đã dùng, bị thu hồi hoặc liên hệ đã thay đổi. Vui lòng gửi mã mới.');
      return this.state(userId);
    },
    async confirmEmail(token) {
      requireOtp();
      const invalid = () => new ApiError(400,'VERIFY_EMAIL_LINK_INVALID','Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu liên kết mới nếu email chưa được xác thực.');
      if (typeof token !== 'string' || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) throw invalid();
      const [challengeId, secret] = token.split('.');
      const [challenge] = await db.execute("SELECT user_id,destination,token_hash FROM user_contact_verifications WHERE request_key=? AND channel='email' LIMIT 1",[challengeId]);
      if (!challenge) throw invalid();
      const submitted = otpHash(config.otpPepper,challengeId,challenge.user_id,'email',challenge.destination,secret);
      // Reject invalid bearer tokens before the SQL procedure increments attempts.
      const stored = Buffer.from(challenge.token_hash,'hex');
      const candidate = Buffer.from(submitted,'hex');
      if (stored.length !== candidate.length || !timingSafeEqual(stored,candidate)) throw invalid();
      const [result] = await db.call('la_onboarding_verify_contact',[String(challenge.user_id),challengeId,submitted]);
      if (result?.code !== 'VERIFY_SUCCESS') throw invalid();
    },
    async complete(userId) {
      await db.call('la_onboarding_complete',[String(userId)]);
      // Read again so a concurrent contact change cannot be hidden by an old result.
      return this.state(userId);
    },
  };
}

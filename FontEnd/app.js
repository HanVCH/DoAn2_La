import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { authConfig, registerAccount, loginAccount, startSocialAuth } from './integrations/auth.js';
import { readConfig } from '../BackEnd/config.js';
import { openDatabase } from '../BackEnd/db/database.js';
import { createMailer } from '../BackEnd/services/mailer.js';
import { createAuthRouter } from '../BackEnd/routes/auth.js';
import { csrfPage, csrfGuard, cors } from '../BackEnd/middleware/security.js';
import { errorHandler } from '../BackEnd/middleware/errors.js';
import { reply } from '../BackEnd/middleware/errors.js';
import { requireAuth } from '../BackEnd/middleware/auth.js';
import { requireOnboardingCompleted } from '../BackEnd/middleware/onboarding.js';
import { createOnboardingRouter } from '../BackEnd/routes/onboarding.js';
import { createSms } from '../BackEnd/services/sms.js';
import { createAppPagesRouter } from './routes/app-pages.js';
import { createTransactionsRouter, financeSummary } from '../BackEnd/routes/transactions.js';
import { createGoalsRouter } from '../BackEnd/routes/goals.js';
import { createBudgetsRouter } from '../BackEnd/routes/budgets.js';
import { createWalletsRouter } from '../BackEnd/routes/wallets.js';
import { createSettingsRouter } from '../BackEnd/routes/settings.js';
import { renewDueBudgets } from '../BackEnd/services/budgets.js';
import { createSupportRouter } from '../BackEnd/routes/support.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export function createApp(options = {}) {
  const config = options.config || readConfig();
  const db = options.db || openDatabase(config.database);
  const mailer = options.mailer || createMailer(config);
  const sms = options.sms || createSms(config);
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(directory, 'views'));
  app.use(cors(config));
  app.use(express.json({ limit: '8kb' }));
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.use(express.static(path.join(directory, 'public')));
  app.get('/js/auth-policy.mjs', (_request, response) => response.sendFile(path.join(directory, '../shared/auth-policy.mjs')));
  app.get('/js/profile-policy.mjs', (_request, response) => response.sendFile(path.join(directory, '../shared/profile-policy.mjs')));
  app.get('/js/transaction-policy.mjs', (_request, response) => response.sendFile(path.join(directory, '../shared/transaction-policy.mjs')));
  app.get('/js/category-icons.mjs', (_request, response) => response.sendFile(path.join(directory, '../shared/category-icons.mjs')));
  app.use('/assets/fonts', express.static(path.join(path.dirname(require.resolve('@fontsource/noto-sans/package.json')), 'files')));
  app.use(csrfPage(config));
  app.use(createAuthRouter({ db, config, mailer }));
  app.use(createOnboardingRouter({ db,config,mailer,sms }));
  app.use(createAppPagesRouter({db,config}));
  // Every business API passes this gate; auth/setup endpoints stay accessible.
  const authApi = requireAuth(db), completedApi = requireOnboardingCompleted(db);
  const isSetupApi = request => /^\/(?:auth|onboarding)(?:\/|$)/.test(request.path);
  app.use('/api',
    (request,response,next)=>isSetupApi(request)?next():authApi(request,response,next),
    (request,response,next)=>isSetupApi(request)?next():completedApi(request,response,next));
  app.get('/api/home',(request,response)=>reply(response,200,'HOME_READY','Tài khoản đã sẵn sàng.',{full_name:request.onboardingState.full_name}));
  app.use('/api/transactions',createTransactionsRouter({db,config}));
  app.use('/api/goals',createGoalsRouter({db,config}));
  app.use('/api/budgets',createBudgetsRouter({db,config}));
  app.use('/api/wallets',createWalletsRouter({db,config}));
  app.use('/api/settings',createSettingsRouter({db,config}));
  app.use('/api/support',createSupportRouter({config,fetchAi:options.supportFetch}));
  app.get('/api/reports',async(request,response)=>{
    response.set('Cache-Control','no-store');
    reply(response,200,'REPORT_READY','Báo cáo chi tiêu.',await financeSummary(db,request.authUser.id,request.query.month,{report:true}));
  });
  app.get('/api/finance/summary',async(request,response)=>{
    response.set('Cache-Control','no-store');
    reply(response,200,'FINANCE_SUMMARY','Tổng hợp giao dịch.',await financeSummary(db,request.authUser.id,request.query.month));
  });
  app.get('/register', (_request, response) => response.set('Cache-Control', 'no-store').render('register', { loginPath: authConfig.loginPath }));
  app.post('/api/auth/register', csrfGuard(config), registerAccount);
  app.post('/api/auth/login', csrfGuard(config), loginAccount);
  app.get('/auth/:provider', startSocialAuth);
  app.get('/login', (request, response) => {
    const notices = {
      'account-not-found': 'Thông tin chưa khớp với tài khoản đã đăng ký. Vui lòng kiểm tra lại hoặc tạo tài khoản.',
      'password-reset': 'Đổi mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
    };
    const notice = typeof request.query.notice === 'string' && Object.hasOwn(notices, request.query.notice) ? notices[request.query.notice] : '';
    response.set('Cache-Control', 'no-store').render('login', { forgotPasswordPath: authConfig.forgotPasswordPath, notice });
  });
  app.get('/terms', (_request, response) => response.status(501).render('information', {
    title: 'Điều khoản sử dụng', description: 'Nội dung điều khoản sử dụng đang chờ được cung cấp trước khi mở đăng ký.',
  }));
  app.get('/privacy', (_request, response) => response.status(501).render('information', {
    title: 'Chính sách bảo mật', description: 'Nội dung chính sách bảo mật đang chờ được cung cấp trước khi mở đăng ký.',
  }));
  app.use('/api',(_request,response)=>reply(response,404,'NOT_FOUND','Không tìm thấy chức năng này.'));
  app.use(errorHandler);
  app.locals.close = async () => { mailer.close(); await db.close(); };
  app.locals.renewBudgets = ()=>renewDueBudgets(db);
  return app;
}

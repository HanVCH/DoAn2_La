import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { csrfGuard,createRateLimiter,accountLimit } from '../middleware/security.js';
import { ApiError,reply } from '../middleware/errors.js';
import { createOnboardingService,onboardingRedirect } from '../services/onboarding.js';

export function createOnboardingRouter(dependencies) {
  const { db,config } = dependencies;
  const service = createOnboardingService(dependencies), router = Router(), limiter = createRateLimiter();
  router.use(['/onboarding','/api/onboarding'],(_request,response,next)=>{response.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});next();});
  // A GET may come from a mail scanner. Only explicit confirmation changes state.
  router.get('/onboarding/verify-email',limiter.middleware('email-link-page',60,15*60000),(request,response)=>{
    const token = typeof request.query.token === 'string' && /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(request.query.token) ? request.query.token : '';
    // Browsers send Origin: null on form POSTs from a no-referrer page.
    // strict-origin keeps the form's origin and strips the token from Referer.
    response.set('Referrer-Policy','strict-origin');
    response.status(token ? 200 : 400).render('verify-email',{token,verified:false});
  });
  router.post('/onboarding/verify-email',csrfGuard(config),limiter.middleware('email-link-confirm',30,15*60000),async(request,response)=>{
    try {
      await service.confirmEmail(request.body?.token);
      return response.render('verify-email',{token:'',verified:true});
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return response.status(error.status).render('verify-email',{token:'',verified:false,message:error.message});
    }
  });
  router.get('/onboarding',requireAuth(db,{page:true}),async(request,response)=>{
    const state = await service.state(request.authUser.id);
    if (!state.needs_onboarding) return response.redirect(config.homePath);
    response.render('onboarding',{state});
  });
  router.use('/api/onboarding',requireAuth(db));
  router.use('/api/onboarding',(request,response,next)=>{
    if (request.method === 'GET') return next();
    csrfGuard(config)(request,response,next);
  });
  router.get('/api/onboarding',async(request,response)=>reply(response,200,'ONBOARDING_STATE','Thông tin thiết lập của bạn.',await service.state(request.authUser.id)));
  router.put('/api/onboarding/profile',limiter.middleware('profile',30,15*60000),async(request,response)=>reply(response,200,'ONBOARDING_PROFILE_SAVED','Đã lưu thông tin. Hãy xác thực liên hệ và bấm Hoàn tất.',await service.saveProfile(request.authUser.id,request.body || {})));
  router.post('/api/onboarding/verification/send',limiter.middleware('otp-send',15,15*60000),async(request,response)=>{
    const result = await service.send(request.authUser.id,request.body?.channel);
    if (result.channel === 'email') return reply(response,200,'VERIFY_LINK_SENT','Đã gửi liên kết xác thực. Kiểm tra hộp thư đến hoặc thư rác.',result);
    return reply(response,200,'VERIFY_CODE_SENT','Đã gửi mã xác thực. Mã có hiệu lực 5 phút.',result);
  });
  router.post('/api/onboarding/verification/confirm',limiter.middleware('otp-confirm',60,15*60000),async(request,response)=>{
    accountLimit(limiter,response,`otp-confirm-user:${request.authUser.id}`,30,15*60000);
    return reply(response,200,'VERIFY_SUCCESS','Xác thực liên hệ thành công.',await service.confirm(request.authUser.id,request.body || {}));
  });
  router.post('/api/onboarding/complete',limiter.middleware('onboarding-complete',30,15*60000),async(request,response)=>{
    const state = await service.complete(request.authUser.id);
    if (state.needs_onboarding) throw new ApiError(403,'ONBOARDING_REQUIRED','Thông tin liên hệ vừa thay đổi. Vui lòng kiểm tra lại.',state,'/onboarding');
    return reply(response,200,'ONBOARDING_COMPLETED','Đã hoàn tất thiết lập. Chào mừng bạn đến với LÁ!',state,onboardingRedirect(config,state));
  });
  return router;
}

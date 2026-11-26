import { Router } from 'express';
import { ApiError, reply } from '../middleware/errors.js';
import { accountLimit, createRateLimiter, csrfGuard } from '../middleware/security.js';
import { askSupport } from '../services/support-chat.js';

export function createSupportRouter({config,fetchAi}) {
  const router = Router();
  const limits = createRateLimiter();
  const minute = 60_000;
  router.use((_request,response,next)=>{
    response.set('Cache-Control','no-store');
    next();
  });
  router.post('/chat',csrfGuard(config),limits.middleware('support-ip',30,minute),async (request,response)=>{
    const message = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
    if (!message || message.length > 500) throw new ApiError(400,'SUPPORT_MESSAGE_INVALID','Nhập câu hỏi từ 1 đến 500 ký tự.');
    accountLimit(limits,response,`support-user:${request.authUser.id}`,6,minute);
    accountLimit(limits,response,`support-day:${request.authUser.id}`,60,24 * 60 * minute);
    reply(response,200,'SUPPORT_REPLY','Đã xử lý câu hỏi.',{answer:await askSupport(config.supportAi,message,fetchAi)});
  });
  return router;
}

import { Router } from 'express';
import { categoryIcons } from '../../shared/category-icons.mjs';
import { createAppNavigation, DEFAULT_HOME_PATH } from '../../shared/app-navigation.mjs';
import { requireAuth } from '../../BackEnd/middleware/auth.js';
import { requireOnboardingCompleted } from '../../BackEnd/middleware/onboarding.js';

export function createAppPagesRouter({db,config}) {
  const router = Router(), pages = createAppNavigation(config.homePath);
  const guard = [requireAuth(db,{page:true}),requireOnboardingCompleted(db,{page:true})];
  router.get('/',...guard,(_request,response)=>response.redirect(config.homePath));
  if (config.homePath !== DEFAULT_HOME_PATH) router.get(DEFAULT_HOME_PATH,...guard,(_request,response)=>response.redirect(config.homePath));
  for (const page of pages) router.get(page.path,...guard,(request,response)=>{
    const state = request.onboardingState;
    const displayName = state.full_name || state.display_name || 'Bạn';
    const navigation = Object.fromEntries(pages.map(item=>[item.id,item.path]));
    response.set({'Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff'}).render('app-layout',{
      page,pages,navigation,state,displayName,initial:[...displayName.trim()][0]?.toLocaleUpperCase('vi-VN') || 'L',supportEmail:config.supportEmail,categoryIcons,
    });
  });
  router.use((error,request,response,next)=>{
    if(response.headersSent)return next(error);
    response.status(503).set('Cache-Control','no-store').render('session-unavailable',{retryPath:request.path});
  });
  return router;
}

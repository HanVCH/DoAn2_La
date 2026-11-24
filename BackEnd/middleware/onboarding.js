import { getOnboardingState } from '../services/onboarding.js';
import { ApiError } from './errors.js';

export function requireOnboardingCompleted(db, { page = false } = {}) {
  return async (request,response,next) => {
    const state = await getOnboardingState(db,request.authUser.id);
    if (state.needs_onboarding) {
      if (page) return response.redirect('/onboarding');
      throw new ApiError(403,'ONBOARDING_REQUIRED','Vui lòng hoàn tất hồ sơ và xác thực email hoặc số điện thoại.',null,'/onboarding');
    }
    request.onboardingState = state;
    next();
  };
}

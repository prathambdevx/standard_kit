import { Hono } from 'hono';
import {
  capiCallbackHandler,
  capiClaimSessionHandler,
  capiLogoutHandler,
  startCapiAuthorizeHandler,
} from './capi_handlers';
import {
  authorizeHandler,
  discoveryHandler,
  jwksHandler,
  logoutHandler,
  tokenHandler,
  userinfoHandler,
} from './idp_handlers';
import {
  resendOtpHandler,
  sendOtpHandler,
  submitOtpDetailsHandler,
  verifyOtpHandler,
} from './otp_handlers';

// In-house phone/email OTP + a custom OIDC IdP, all mounted under one router.
// otp/* is your own customer-facing API; idp/* is the OIDC wire protocol
// Shopify speaks to your app; capi/* is the mirror image — your app as the
// OAuth client of Shopify's own Customer Account API.
const authRouter = new Hono();

authRouter.post('/otp/send', sendOtpHandler);
authRouter.post('/otp/resend', resendOtpHandler);
authRouter.post('/otp/verify', verifyOtpHandler);
authRouter.post('/otp/details', submitOtpDetailsHandler);

authRouter.get('/idp/.well-known/openid-configuration', discoveryHandler);
authRouter.get('/idp/jwks', jwksHandler);
authRouter.get('/idp/authorize', authorizeHandler);
authRouter.post('/idp/token', tokenHandler);
authRouter.get('/idp/userinfo', userinfoHandler);
authRouter.get('/idp/logout', logoutHandler);

authRouter.get('/capi/start', startCapiAuthorizeHandler);
authRouter.get('/capi/callback', capiCallbackHandler);
authRouter.post('/capi/claim', capiClaimSessionHandler);
authRouter.post('/capi/logout', capiLogoutHandler);

export default authRouter;

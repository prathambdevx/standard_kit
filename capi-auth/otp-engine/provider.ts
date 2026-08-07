// Selects which OTP engine your app uses. Callers (routes/handlers.ts) import
// from here and never from an implementation directly, so swapping providers
// never touches a call site.
//
// The custom OIDC IdP, if you're using capi-idp/, is unaffected by this
// choice: the browser still stays on your own login UI either way. Only who
// generates and checks the code changes.
//
// To add a real delivery vendor (SMS/email API) instead of the in-house
// engine: write a second module exposing the identical
// createOtp/resendOtp/verifyOtp surface (same shape as ./index.ts, but the
// actual send/verify round-trips the vendor's API instead of a local HMAC
// compare), then branch on an env flag here the same way `active()` does
// below — resolved per call, not destructured once at import, so a toggle
// takes effect immediately rather than freezing whichever provider was active
// at boot.
import * as inHouseOtp from './index';

function active() {
  return inHouseOtp;
}

export const createOtp: typeof inHouseOtp.createOtp = (...args) => active().createOtp(...args);
export const resendOtp: typeof inHouseOtp.resendOtp = (...args) => active().resendOtp(...args);
export const verifyOtp: typeof inHouseOtp.verifyOtp = (...args) => active().verifyOtp(...args);

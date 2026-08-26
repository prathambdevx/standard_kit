// A deliberately minimal, generic reference for wiring OTP send → verify →
// (details-required branch) → CAPI claim → logged in. This is NOT meant to be
// copied as-is — it has no styling and no error copy — it exists so you can
// see the shape of the state machine before building your own branded UI
// around it. bsc-platform's actual implementation (packages/commerce/src/auth/flow.ts
// + apps/web/src/modules/auth/) is ~450 lines because it also handles resend
// cooldowns, per-channel copy, and analytics — start here, add only what you need.
'use client';

import { useState } from 'react';
import { exchangeCapiClaim } from '../capi_callback';
import type { AuthStores } from '../commerce';

type Step = 'credentials' | 'verify' | 'details' | 'done';

type OtpClient = {
  send: (username: string, channel: 'phone' | 'email') => Promise<{ otpId: string }>;
  verify: (
    otpId: string,
    code: string,
  ) => Promise<
    | { status: 'verified'; claimToken: string; bindSecret: string }
    | { status: 'details_required' }
  >;
  submitDetails: (input: {
    otpId: string;
    email: string;
    phone?: string;
  }) => Promise<{ claimToken: string; bindSecret: string }>;
  claimCapiSession: (input: { claimToken: string; bindSecret: string }) => Promise<{
    sessionId: string;
  }>;
};

/** Reference only — see the file header. Wire your own UI around this shape. */
export function useLoginFlowExample(otp: OtpClient, auth: AuthStores) {
  const [step, setStep] = useState<Step>('credentials');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (username: string, channel: 'phone' | 'email') => {
    setError(null);
    const { otpId: id } = await otp.send(username, channel);
    setOtpId(id);
    setStep('verify');
  };

  const finishWithClaim = async (claimToken: string, bindSecret: string) => {
    const result = await exchangeCapiClaim({
      claimToken,
      bindSecret,
      claimCapiSession: otp.claimCapiSession,
      session: auth.session,
      capiSession: auth.capiSession,
    });
    setStep(result.ok ? 'done' : 'credentials');
    if (!result.ok) setError('Login failed — try again.');
  };

  const verifyCode = async (code: string) => {
    if (!otpId) return;
    setError(null);
    const result = await otp.verify(otpId, code);
    if (result.status === 'details_required') {
      setStep('details');
      return;
    }
    await finishWithClaim(result.claimToken, result.bindSecret);
  };

  const submitDetails = async (email: string, phone?: string) => {
    if (!otpId) return;
    setError(null);
    const { claimToken, bindSecret } = await otp.submitDetails({ otpId, email, phone });
    await finishWithClaim(claimToken, bindSecret);
  };

  return { step, error, sendCode, verifyCode, submitDetails };
}

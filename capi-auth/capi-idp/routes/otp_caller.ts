// Puts WHO asked on every otp_* metric line of this request. Without it an SMS-pumping
// investigation sees which numbers were targeted but not the caller, the only actionable half.
import type { Context } from 'hono';
import { setOtpMetricContext } from '../../services/otp_engine/metrics';
import { setLoginTraceId } from './login_trace';

// Diagnostics only: the leftmost x-forwarded-for entry is caller-authored, so never rate-limit on it.
export function noteOtpCaller(c: Context, loginTraceId?: string): void {
  setLoginTraceId(c, loginTraceId);
  const hops =
    c.req
      .header('x-forwarded-for')
      ?.split(',')
      .map((p) => p.trim())
      .filter(Boolean) ?? [];
  const requestId = c.get('requestId');
  const userAgent = c.req.header('user-agent')?.slice(0, 120);
  setOtpMetricContext({
    ...(requestId ? { request_id: requestId } : {}),
    ...(loginTraceId ? { login_trace_id: loginTraceId } : {}),
    ...(hops[0] ? { client_ip: hops[0] } : {}),
    ...(hops.length > 1 && hops.at(-1) !== hops[0] ? { proxy_ip: hops.at(-1) } : {}),
    ...(hops.length ? { xff_hops: hops.length } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
  });
}

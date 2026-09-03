import handler from 'vinext/server/app-router-entry';
import { runDueRecurringPayrollRules } from './app/lib/server/payroll-store';

const worker = {
  async fetch(request: Request, workerEnv: Cloudflare.Env, context: ExecutionContext) {
    const response = await handler.fetch(request, workerEnv, context);
    const headers = new Headers(response.headers);
    const existingCsp = headers.get('content-security-policy')?.replace(/;\s*$/, '');
    const framePolicy = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
    headers.set('content-security-policy', existingCsp ? `${existingCsp}; ${framePolicy}` : framePolicy);
    headers.set('x-frame-options', 'DENY');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'same-origin');
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async scheduled(_controller: ScheduledController, _workerEnv: Cloudflare.Env, context: ExecutionContext) {
    context.waitUntil(runDueRecurringPayrollRules(undefined, 'scheduled'));
  },
};

export default worker;

import { clearSessionCookie, errorResponse, json, logoutSession } from '../../../lib/server/payroll-store';

export async function POST(request: Request) {
  try {
    await logoutSession(request);
    return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie(request) } });
  } catch (error) {
    return errorResponse(error);
  }
}

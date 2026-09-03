import { errorResponse, json, requireSession, resetPassword, sessionCookie } from '../../../lib/server/payroll-store';

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request, undefined, true);
    const body = await request.json() as { oldPasswordDigest?: string; newPasswordDigest?: string };
    const session = await resetPassword(actor, body.oldPasswordDigest ?? '', body.newPasswordDigest ?? '');
    return json({ ok: true }, {
      headers: { 'set-cookie': sessionCookie(request, session.token, session.expiresAt) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

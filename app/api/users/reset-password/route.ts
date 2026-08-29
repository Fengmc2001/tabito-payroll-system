import { errorResponse, json, requireSession, resetPassword } from '../../../lib/server/payroll-store';

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request, undefined, true);
    const body = await request.json() as { oldPasswordDigest?: string; newPasswordDigest?: string };
    await resetPassword(actor, body.oldPasswordDigest ?? '', body.newPasswordDigest ?? '');
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

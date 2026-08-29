import { adminResetPassword, errorResponse, json, requireSession } from '../../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json() as { newPasswordDigest?: string };
    await adminResetPassword(actor, id, body.newPasswordDigest ?? '');
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

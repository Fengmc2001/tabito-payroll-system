import {
  deleteRecurringPayrollRule,
  errorResponse,
  json,
  requireSession,
  updateRecurringPayrollRule,
} from '../../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json() as { active?: boolean; title?: string; endMonth?: string; expectedUpdatedAt?: string };
    return json({ rule: await updateRecurringPayrollRule(actor, id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { expectedUpdatedAt?: string };
    await deleteRecurringPayrollRule(actor, id, body.expectedUpdatedAt);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

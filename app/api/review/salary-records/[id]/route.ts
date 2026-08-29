import { errorResponse, json, requireSession, reviewSalaryRecord } from '../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json() as { decision?: 'approve' | 'reject'; auditMemo?: string };
    if (!body.decision) return json({ error: '缺少审核动作。' }, { status: 400 });
    return json({ record: await reviewSalaryRecord(actor, id, body.decision, body.auditMemo ?? '') });
  } catch (error) {
    return errorResponse(error);
  }
}

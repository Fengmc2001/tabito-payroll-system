import {
  deleteProxySalaryRecord,
  errorResponse,
  json,
  requireSession,
  saveProxySalaryRecord,
} from '../../../../../lib/server/payroll-store';
import { SalaryRecord } from '../../../../../lib/payroll';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json() as { targetUserId?: string; record?: SalaryRecord; submit?: boolean };
    if (!body.record) return json({ error: '缺少工资记录。' }, { status: 400 });
    return json({
      record: await saveProxySalaryRecord(actor, body.targetUserId ?? '', { ...body.record, id }, Boolean(body.submit)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const targetUserId = url.searchParams.get('userId') ?? '';
    const expectedUpdatedAt = url.searchParams.get('updatedAt') ?? undefined;
    await deleteProxySalaryRecord(actor, targetUserId, id, expectedUpdatedAt);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

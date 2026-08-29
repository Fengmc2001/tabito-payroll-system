import { deleteSalaryRecord, errorResponse, getSalaryRecord, json, requireSession, saveSalaryRecord } from '../../../lib/server/payroll-store';
import { SalaryRecord } from '../../../lib/payroll';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return json({ record: await getSalaryRecord(actor.userId, id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const record = { ...(await request.json() as SalaryRecord), id };
    return json({ record: await saveSalaryRecord(actor.userId, record) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    await deleteSalaryRecord(actor.userId, id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

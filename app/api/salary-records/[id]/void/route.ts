import { errorResponse, json, requireSession, voidSalaryRecord } from '../../../../lib/server/payroll-store';

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const actor = await requireSession(request);
    const {id} = await context.params;
    const input = await request.json() as {expectedUpdatedAt?: string; reason?: string; paymentChecked?: boolean};
    await voidSalaryRecord(actor, id, input.expectedUpdatedAt || '', input.reason || '', input.paymentChecked === true);
    return json({ok: true});
  } catch (error) { return errorResponse(error); }
}

import { errorResponse, json, requireSession, getRecordHistory, getVisibleSalaryRecord } from '../../../../lib/server/payroll-store';
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  try { const actor = await requireSession(request); const {id} = await context.params;
    const history = await getRecordHistory(actor, id);
    return json({record: await getVisibleSalaryRecord(actor, id), history});
  } catch (error) { return errorResponse(error); }
}

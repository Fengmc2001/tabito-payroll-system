import { errorResponse, json, requireSession, reopenSalaryRecord } from '../../../../lib/server/payroll-store';
export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  try { const actor = await requireSession(request); const {id} = await context.params; const body = await request.json() as { expectedUpdatedAt: string };
    return json({record: await reopenSalaryRecord(actor, id, body.expectedUpdatedAt)});
  } catch (error) { return errorResponse(error); }
}

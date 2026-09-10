import { errorResponse, json, requireSession, reassignSalaryRecord } from '../../../../../lib/server/payroll-store';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try { const actor = await requireSession(request); const {id} = await context.params; const body = await request.json() as { reviewerUserId: string | null; expectedUpdatedAt: string };
    return json({record: await reassignSalaryRecord(actor, id, body.reviewerUserId, body.expectedUpdatedAt)});
  } catch (error) { return errorResponse(error); }
}

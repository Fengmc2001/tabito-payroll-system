import { errorResponse, json, requireSession, updateAccountAccess } from '../../../../../lib/server/payroll-store';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try { const actor = await requireSession(request); const {id} = await context.params;
    return json({user: await updateAccountAccess(actor, id, await request.json())});
  } catch (error) { return errorResponse(error); }
}

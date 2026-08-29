import { deactivateDepartment, errorResponse, json, requireSession } from '../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return json({ department: await deactivateDepartment(actor, id) });
  } catch (error) {
    return errorResponse(error);
  }
}

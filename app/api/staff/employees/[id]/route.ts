import { errorResponse, getStaffEmployeeDetail, json, requireSession } from '../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    return json({ employee: await getStaffEmployeeDetail(actor, id) });
  } catch (error) {
    return errorResponse(error);
  }
}

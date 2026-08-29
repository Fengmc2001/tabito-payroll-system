import { errorResponse, json, listPayrollDepartments, requireSession } from '../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ departments: await listPayrollDepartments(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

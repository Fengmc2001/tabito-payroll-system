import { errorResponse, json, listStaffEmployees, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ employees: await listStaffEmployees(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

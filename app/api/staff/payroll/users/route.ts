import { errorResponse, json, listProxyPayrollUsers, requireSession } from '../../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ users: await listProxyPayrollUsers(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

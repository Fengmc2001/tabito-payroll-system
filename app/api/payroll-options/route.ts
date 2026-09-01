import { errorResponse, json, listPayrollDepartments, listPayrollWorkManagers, requireSession } from '../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const [departments, workManagers] = await Promise.all([
      listPayrollDepartments(actor),
      listPayrollWorkManagers(actor),
    ]);
    return json({ departments, workManagers });
  } catch (error) {
    return errorResponse(error);
  }
}

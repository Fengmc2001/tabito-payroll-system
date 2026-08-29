import { createDepartment, errorResponse, json, listAdminDepartments, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ departments: await listAdminDepartments(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json() as { label?: string };
    return json({ department: await createDepartment(actor, body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, json, listManagedUsers, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ users: await listManagedUsers(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, json, requireSession, updateManagedUser } from '../../../../lib/server/payroll-store';
import { AccountRole, AccountStatus } from '../../../../lib/payroll';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json() as {
      role?: AccountRole;
      status?: AccountStatus;
      workManager?: boolean;
      revokeSessions?: boolean;
    };
    return json({ user: await updateManagedUser(actor, id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, getAccount, json, requireSession, saveProfile } from '../../../lib/server/payroll-store';
import { Profile } from '../../../lib/payroll';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requireSession(request, id, true);
    return json({ account: await getAccount(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requireSession(request, id, true);
    const body = await request.json() as { profile?: Profile };
    if (!body.profile) return json({ error: '缺少个人资料。' }, { status: 400 });
    return json({ account: await saveProfile(id, body.profile) });
  } catch (error) {
    return errorResponse(error);
  }
}

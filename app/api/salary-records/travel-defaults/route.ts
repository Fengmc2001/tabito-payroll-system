import { errorResponse, getTravelDefaults, json, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const query = new URL(request.url).searchParams;
    return json({travel: await getTravelDefaults(actor, query.get('userId') || actor.userId, query.get('currency') || 'JPY')});
  } catch (error) { return errorResponse(error); }
}

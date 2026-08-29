import { errorResponse, getAuditOverview, json, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const params = new URL(request.url).searchParams;
    return json({ overview: await getAuditOverview(actor, {
      year: params.get('year') ?? undefined,
      month: params.get('month') ?? undefined,
      userId: params.get('userId') ?? undefined,
    }) });
  } catch (error) {
    return errorResponse(error);
  }
}

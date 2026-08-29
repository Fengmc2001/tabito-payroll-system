import { applySalaryRecords, errorResponse, json, requireSession } from '../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    await requireSession(request, userId);
    const body = await request.json().catch(() => ({})) as { month?: unknown };
    return json({ records: await applySalaryRecords(userId, typeof body.month === 'string' ? body.month : undefined) });
  } catch (error) {
    return errorResponse(error);
  }
}

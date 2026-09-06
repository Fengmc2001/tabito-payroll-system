import { ApiError, applySalaryRecords, errorResponse, json, requireSession } from '../../../../lib/server/payroll-store';

import { monthIsValid } from '../../../../lib/payroll';

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    await requireSession(request, userId);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError(400, '请求内容必须为有效 JSON。'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || !('month' in body) || typeof body.month !== 'string' || !monthIsValid(body.month)) {
      throw new ApiError(400, '请选择有效的申报月份。');
    }
    return json({ records: await applySalaryRecords(userId, body.month) });
  } catch (error) {
    return errorResponse(error);
  }
}

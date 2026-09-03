import { errorResponse, json, listRecurringPayrollRules, requireSession } from '../../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const targetUserId = new URL(request.url).searchParams.get('userId') || undefined;
    return json({ rules: await listRecurringPayrollRules(actor, targetUserId) });
  } catch (error) {
    return errorResponse(error);
  }
}

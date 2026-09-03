import { errorResponse, json, requireSession, runRecurringPayrollRulesManually } from '../../../../../lib/server/payroll-store';

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json().catch(() => ({})) as { month?: string; targetUserId?: string };
    return json(await runRecurringPayrollRulesManually(actor, body.month, body.targetUserId));
  } catch (error) {
    return errorResponse(error);
  }
}

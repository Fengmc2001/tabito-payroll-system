import { errorResponse, json, listRecentAuditLogs, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ logs: await listRecentAuditLogs(actor, 10) });
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, json, listAuditLogs, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 100);
    return json({ logs: await listAuditLogs(actor, limit) });
  } catch (error) {
    return errorResponse(error);
  }
}

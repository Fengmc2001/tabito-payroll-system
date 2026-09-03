import {
  errorResponse,
  json,
  listProxySalaryRecords,
  requireSession,
  saveProxySalaryRecord,
} from '../../../../lib/server/payroll-store';
import { SalaryRecord } from '../../../../lib/payroll';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const params = new URL(request.url).searchParams;
    return json({ records: await listProxySalaryRecords(actor, params.get('userId') ?? '', params.get('month') ?? '') });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json() as { targetUserId?: string; record?: SalaryRecord; submit?: boolean };
    if (!body.record) return json({ error: '缺少工资记录。' }, { status: 400 });
    return json({
      record: await saveProxySalaryRecord(actor, body.targetUserId ?? '', body.record, Boolean(body.submit)),
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

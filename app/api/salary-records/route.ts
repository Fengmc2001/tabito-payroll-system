import { errorResponse, json, listSalaryRecords, requireSession, saveSalaryRecord } from '../../lib/server/payroll-store';
import { SalaryRecord } from '../../lib/payroll';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ records: await listSalaryRecords(actor.userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const record = await request.json() as SalaryRecord;
    return json({ record: await saveSalaryRecord(actor.userId, record) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { createProxyPayrollBatch, errorResponse, json, requireSession } from '../../../../lib/server/payroll-store';
import { ProxyPayrollBatchInput } from '../../../../lib/payroll';

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const input = await request.json() as ProxyPayrollBatchInput;
    return json(await createProxyPayrollBatch(actor, input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

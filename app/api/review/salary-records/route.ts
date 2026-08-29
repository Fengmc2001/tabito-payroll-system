import { errorResponse, json, listReviewSalaryRecords, requireSession } from '../../../lib/server/payroll-store';
import { SalaryStatus } from '../../../lib/payroll';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const statusValue = new URL(request.url).searchParams.get('status');
    if (statusValue && !['2', '3', '4'].includes(statusValue)) {
      return json({ error: '审核状态筛选无效。' }, { status: 400 });
    }
    const status = statusValue ? Number(statusValue) as SalaryStatus : undefined;
    return json({ items: await listReviewSalaryRecords(actor, status) });
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, getStaffTransferSheet, json, requireSession } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const month = new URL(request.url).searchParams.get('month') ?? undefined;
    return json({ rows: await getStaffTransferSheet(actor, month) });
  } catch (error) {
    return errorResponse(error);
  }
}

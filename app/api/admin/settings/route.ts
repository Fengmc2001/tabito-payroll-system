import { errorResponse, getAdminSettings, json, requireSession, updateAdminSettings } from '../../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    return json({ settings: await getAdminSettings(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json() as { registrationOpen?: boolean };
    return json({ settings: await updateAdminSettings(actor, body) });
  } catch (error) {
    return errorResponse(error);
  }
}

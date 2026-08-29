import { errorResponse, getBootstrapStatus, json } from '../../lib/server/payroll-store';

export async function GET() {
  try {
    return json({ bootstrap: await getBootstrapStatus() });
  } catch (error) {
    return errorResponse(error);
  }
}

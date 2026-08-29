import { errorResponse, json, uploadFile } from '../../lib/server/payroll-store';

export async function POST(request: Request) {
  try {
    return json({ file: await uploadFile(request) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

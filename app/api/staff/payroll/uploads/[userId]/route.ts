import { errorResponse, json, uploadFileForUser } from '../../../../../lib/server/payroll-store';

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId } = await context.params;
    return json({ file: await uploadFileForUser(request, userId) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, json, loginUser, requireSameOriginMutation, sessionCookie } from '../../../lib/server/payroll-store';

export async function POST(request: Request) {
  try {
    requireSameOriginMutation(request);
    const body = await request.json() as { email?: string; passwordDigest?: string };
    const result = await loginUser(body.email ?? '', body.passwordDigest ?? '');
    return json(
      { account: result.account, session: { expiresAt: result.session.expiresAt } },
      { headers: { 'set-cookie': sessionCookie(request, result.session.token, result.session.expiresAt) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

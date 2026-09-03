import {
  errorResponse,
  getAccount,
  json,
  registerUser,
  requireSameOriginMutation,
  requireSession,
  sessionCookie,
} from '../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request, undefined, true);
    return json({ account: await getAccount(actor.userId), session: { expiresAt: actor.expiresAt } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOriginMutation(request);
    const body = await request.json() as { email?: string; passwordDigest?: string; bootstrapSecret?: string };
    const result = await registerUser(body.email ?? '', body.passwordDigest ?? '', body.bootstrapSecret ?? '');
    return json(
      { account: result.account, session: { expiresAt: result.session.expiresAt } },
      {
        status: 201,
        headers: { 'set-cookie': sessionCookie(request, result.session.token, result.session.expiresAt) },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

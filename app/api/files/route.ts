import { deleteFile, downloadFile, errorResponse, json } from '../../lib/server/payroll-store';

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get('key') ?? '';
    if (!key) return json({ error: '缺少附件编号。' }, { status: 400 });
    return await downloadFile(request, key);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get('key') ?? '';
    if (!key) return json({ error: '缺少附件编号。' }, { status: 400 });
    await deleteFile(request, key);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

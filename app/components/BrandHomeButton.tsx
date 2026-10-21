'use client';

import { appPath } from '../lib/app-path';
import { COMPANY_NAME } from '../lib/payroll';

export function BrandHomeButton({ onHome }: { onHome: () => void }) {
  return <button className="brand-lockup" type="button" aria-label={`${COMPANY_NAME}，返回首页`} onClick={onHome}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={appPath('/tabito-logo-brush-kai-20261021.png')} width={2022} height={778} alt="" aria-hidden="true" draggable={false} />
  </button>;
}

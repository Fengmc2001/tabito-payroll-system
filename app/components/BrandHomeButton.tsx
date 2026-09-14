'use client';

import { appPath } from '../lib/app-path';
import { COMPANY_NAME } from '../lib/payroll';

export function BrandHomeButton({ onHome }: { onHome: () => void }) {
  return <button className="brand-lockup" type="button" aria-label={`${COMPANY_NAME}，返回首页`} onClick={onHome}>
    {/* Serve the supplied local artwork unchanged; no image optimization endpoint is needed. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={appPath('/tabito-logo-253970.png')} width={2007} height={783} alt="" aria-hidden="true" draggable={false} />
  </button>;
}

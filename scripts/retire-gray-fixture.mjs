import { GRAY_CLEAR_CONFIRMATION } from './gray-fixture-common.mjs';

process.env.PAYROLL_GRAY_CONFIRM = GRAY_CLEAR_CONFIRMATION;
await import('./clear-gray-fixture.mjs');

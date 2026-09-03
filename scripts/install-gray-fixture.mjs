import { GRAY_SEED_CONFIRMATION } from './gray-fixture-common.mjs';

process.env.PAYROLL_GRAY_CONFIRM = GRAY_SEED_CONFIRMATION;
await import('./seed-gray-fixture.mjs');
await import('./verify-gray-fixture.mjs');

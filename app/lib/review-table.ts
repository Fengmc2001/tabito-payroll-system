import type {ReviewSalaryItem} from './payroll';

export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_MEMO_LIMIT = 1000;
export function reviewPage(items: ReviewSalaryItem[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / REVIEW_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, requestedPage));
  return {page, pages, items: items.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE)};
}
export function rejectionReasonError(reason: string) {
  if (!reason.trim()) return '请填写驳回理由。';
  if (reason.trim().length > REVIEW_MEMO_LIMIT) return `驳回理由不能超过 ${REVIEW_MEMO_LIMIT} 个字符。`;
  return '';
}
export function employeeName(item: ReviewSalaryItem) {
  return item.user.displayName.trim() || item.user.email;
}

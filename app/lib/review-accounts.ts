import type {ReviewSalaryItem} from './payroll';

export function reviewAccountOptions(items: ReviewSalaryItem[], month: string) {
  const accounts = new Map<string, {id: string; name: string; email: string; pending: number; processed: number; complete: boolean}>();
  for (const {user, record} of items) {
    let option = accounts.get(user.id);
    if (!option) {
      option = {id: user.id, name: user.displayName.trim() || user.email, email: user.email, pending: 0, processed: 0, complete: false};
      accounts.set(user.id, option);
    }
    if (!record.workDate.startsWith(month + '-')) continue;
    if (record.status === 2) option.pending++;
    if (record.status === 3 || record.status === 4) option.processed++;
  }
  for (const option of accounts.values()) option.complete = option.pending === 0 && option.processed > 0;
  return [...accounts.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

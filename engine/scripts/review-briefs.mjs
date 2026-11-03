// Pass briefs. Pass 1 discovers, pass 2 checks its own citations, later passes deepen.
import { GRACE } from './bridge-budget.mjs';

export function passRole(index) {
  if (index <= 1) return 'discover';
  if (index === 2) return 'self-verify';
  return 'deepen';
}

export function passRoles(passes) {
  return Array.from({ length: passes }, (_, i) => passRole(i + 1));
}

export function renderBrief({ pass = 1, passes = 2, toolBudget = 40, filesRead = [], files = [] } = {}) {
  const role = passRole(pass);
  const unread = files.filter((file) => !filesRead.includes(file));
  const lines = [
    `Pass ${pass} of ${passes}: ${role}.`,
    `Budget: ${toolBudget} calls (+${GRACE} grace). Submit no finding if none.`,
  ];
  if (role === 'self-verify') {
    lines.push('Re-read every citation you made. Drop or correct a finding whose line does not say what you claimed.');
    lines.push(`Unread files: ${unread.join(', ') || '(none)'}.`);
  }
  if (role === 'deepen') lines.push('Spend the remaining calls on your own highest-severity leads.');
  return `${lines.join('\n')}\n`;
}

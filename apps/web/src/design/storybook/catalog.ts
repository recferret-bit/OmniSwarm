export interface Story {
  id: string;
  group: string;
  title: string;
  usage: string;
  do: string;
  dont: string;
  code: string;
}

export const STORIES: Story[] = [
  { id: 'button', group: 'Actions', title: 'Button', usage: 'One verb. Primary is ember with field ink.', do: 'Use primary once per view.', dont: 'Do not put paper or white text on ember. Secondary is paper and sits on the field.', code: 'Button variant="primary"' },
  { id: 'badge', group: 'Actions', title: 'Badge', usage: 'Status is a short mono label.', do: 'Shipped, later, good, warn, bad.', dont: 'Do not use a badge as a certificate of safety.', code: 'Pill tone="good"' },
  { id: 'panel', group: 'Surface', title: 'Panel and stat', usage: 'A plate holds one idea. A stat is a number with a mono label.', do: 'Keep the number specific.', dont: 'Do not round the plate.', code: 'Panel / StatGrid' },
  { id: 'field', group: 'Inputs', title: 'Field', usage: 'Label, control, hint or error.', do: 'Say what is wrong in the error.', dont: 'Do not rely on color alone. The error text is the message.', code: 'Field label="GitHub repository"' },
  { id: 'choice', group: 'Inputs', title: 'Choice', usage: 'Scope and other exclusive options.', do: 'Show the disabled state.', dont: 'Do not hide the unselected options.', code: '.radio-card' },
  { id: 'switch', group: 'Inputs', title: 'Switch and range', usage: 'A switch is on or off. A range shows a weight.', do: 'Name the switch. Show the number.', dont: 'Do not pretend a storybook range changes a live review.', code: '.switch / .range' },
  { id: 'alert', group: 'Feedback', title: 'Alert and toast', usage: 'Alerts stay. Toasts arrive and can be dismissed.', do: 'Use warn for an incomplete run, bad for a failed check.', dont: 'Do not animate a toast when reduced motion is on.', code: 'Alert tone="warn"' },
  { id: 'report', group: 'Report', title: 'Tabs, timeline, table', usage: 'The report and the request use these.', do: 'Keep one tab selected. Mark the current step.', dont: 'Do not drop the file:line column.', code: 'ReportTabs / Timeline' },
  { id: 'account', group: 'Report', title: 'Account', usage: 'The connected account is a chamfered chip.', do: 'Offer sign out beside the id.', dont: 'Do not print a key or a seed.', code: 'AccountChip' },
];

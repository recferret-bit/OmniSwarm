import { toolDefinitions as auditorToolDefinitions, handlers } from './bridge-tools-auditor.mjs';

// The verification identity runs the catalogued suites before reviewers start. Its tool list is the auditor's;
// submit_audit_report still refuses it because the handler requires role === 'auditor'.
export const role = 'verification';
export const toolDefinitions = auditorToolDefinitions;
export { handlers };

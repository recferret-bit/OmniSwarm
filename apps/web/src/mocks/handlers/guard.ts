// Dev/e2e only. POST /api/guard/reports: a signed-in account files a report, which waits for the
// owner's review on the loopback admin listener (not mocked: the web app never calls it). The
// input rules are read from intake-api.schema.json, so the mock cannot drift from the contract.
import schema from '@omniswarm/schemas/intake-api.schema.json';
import { http, HttpResponse } from 'msw';
import type { GuardReportRequest, GuardReportResponse } from '@/lib/api/schema.gen';
import { clock, readState, updateState } from '../db';
import { apiError, uuid } from './intake';

const rules = schema.$defs['guard-report-request'].properties;
const FIELDS = new Set(Object.keys(rules));

function fits(value: unknown, rule: { pattern: string; maxLength?: number }): value is string {
  return typeof value === 'string' && new RegExp(rule.pattern, 'u').test(value)
    && (rule.maxLength === undefined || [...value].length <= rule.maxLength);
}

function isReport(body: unknown): body is GuardReportRequest {
  if (typeof body !== 'object' || body === null) return false;
  const report = body as Record<string, unknown>;
  return Object.keys(report).every((key) => FIELDS.has(key)) && fits(report.account, schema.$defs['account-id'])
    && fits(report.evidenceUrl, rules.evidenceUrl) && fits(report.reason, rules.reason);
}

// A resubmission of the reporter's pending report on the same account returns that report's id.
const report = http.post('/api/guard/reports', async ({ request }) => {
  const body: unknown = await request.json().catch(() => null);
  if (!isReport(body)) return apiError('VALIDATION_ERROR', 400, 'Invalid guard report');
  const reporter = readState().session;
  if (!reporter) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  const reportId = updateState((state) => {
    const open = state.guardReports.find((item) => item.reporter === reporter && item.account === body.account);
    if (open) return open.id;
    const id = uuid();
    state.guardReports.push({ id, reporter, account: body.account, evidenceUrl: body.evidenceUrl, reason: body.reason, createdAt: clock.now() });
    return id;
  });
  const response: GuardReportResponse = { queued: true, reportId };
  return HttpResponse.json(response, { status: 202 });
});

export const guardHandlers = [report];

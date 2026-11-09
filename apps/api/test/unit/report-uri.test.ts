import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainReportUri } from '../../src/worker/report-uri.ts';

test('chainReportUri rewrites only an http scheme', () => {
  assert.equal(chainReportUri('http://reports.test/a/report.html'), 'https://reports.test/a/report.html');
  assert.equal(chainReportUri('https://reports.test/a/report.html'), 'https://reports.test/a/report.html');
  assert.equal(chainReportUri('http://reports.test/http://nested'), 'https://reports.test/http://nested');
});

// Dev/e2e only. The reports origin serving each request's canonical report files.
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readState } from '../db';
import { REPORTS_ORIGIN, reportFiles } from '../reports';

const files = http.get<{ id: string; file: string }>(`${REPORTS_ORIGIN}/:id/:file`, ({ params }) => {
  const row = readState().requests.find((item) => item.id === params.id);
  if (!row) return new HttpResponse(null, { status: 404 });
  const content = reportFiles(readState().controls.tampered);
  if (params.file === 'findings-and-scores.json') return HttpResponse.json(content.findings as JsonBodyType);
  if (params.file === 'general-review.json') return HttpResponse.json(content.general as JsonBodyType);
  return new HttpResponse(null, { status: 404 });
});

export const fileHandlers = [files];

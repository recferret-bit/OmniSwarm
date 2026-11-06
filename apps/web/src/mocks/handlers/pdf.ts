// Dev/e2e only. A one-page stand-in: PDF header plus the report name.
import { HttpResponse } from 'msw';

export const MOCK_PDF = '%PDF-1.1\n% OmniSwarm report\n%%EOF\n';

export function pdfResponse() {
  return new HttpResponse(MOCK_PDF, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="report.pdf"',
    },
  });
}

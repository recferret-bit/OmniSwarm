// The attestation hex is stored on its own. The page recomputes sha256 over the
// canonical findings and general-review documents and compares the two.
export const REPORT_FINDINGS = { findings: [{ id: 'F-1', severity: 'low', title: 'Missing owner check' }] };
export const REPORT_GENERAL = { summary: 'No critical issue in this sample.' };
export const TAMPED_FINDINGS = { findings: [{ id: 'F-1', severity: 'low', title: 'Missing owner check (tampered)' }] };

export const ATTESTED_SHA256 = 'f1d565b590ebe3953a45032be451719096222b9ee003ceee21900c1136bc35b1';

// canonicalJson and digestReport come from @omniswarm/schemas/canonical-json, the same
// bytes the intake worker hashes when it attests a report.
export { canonicalJson, digestReport } from '@omniswarm/schemas/canonical-json';

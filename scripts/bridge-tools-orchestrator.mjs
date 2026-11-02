// Orchestrator submits. It cannot run target tests or file a new reviewer finding.
import { SAFE_ANNOTATIONS, objSchema, strProp } from './bridge-tools-common.mjs';

export const role = 'orchestrator';

export function toolDefinitions() {
  const submit = (name) => ({ name, description: name, annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({ report_json: strProp() }) });
  return [
    { name: 'get_audit_context', description: 'Read the audit scope.', annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({}) },
    { name: 'read_file', description: 'Read a source file.', annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({ path: strProp() }) },
    { name: 'search_code', description: 'Search source.', annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({ pattern: strProp() }) },
    { name: 'list_files', description: 'List source files.', annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({}) },
    submit('submit_merge_suggestions'),
    submit('submit_adjudication'),
    submit('submit_general_review'),
  ];
}

export function acceptGeneralReview(body, knownClusters) {
  const known = new Set(knownClusters || []);
  for (const finding of body?.topFindings || []) {
    if (!known.has(finding.clusterId)) {
      const error = new Error('new_finding_in_general_review');
      error.code = 'new_finding_in_general_review';
      throw error;
    }
  }
  return body;
}

export const handlers = { async submit_general_review() { return 'committed'; } };

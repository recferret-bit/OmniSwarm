export const FAILURE_MESSAGES = {
  provider_policy: 'Provider refused the security review; resolve account access with the provider before retrying.',
  usage_limit: 'Provider usage/session limit reached; wait for the limit to reset before retrying.',
  mcp_unavailable: 'Docker MCP tools were unavailable; check the bridge connection and workspace trust.',
  timeout: 'Audit process exceeded its time budget.',
  process_error: 'Audit process exited unsuccessfully.',
  missing_report: 'Process finished without submitting the required report.',
  invalid_report: 'Submitted report failed contract validation.',
  setup_error: 'Audit process could not be configured or started.',
  missing_exit: 'Worker exit status is missing; successful completion is unverified.',
  transport_lost: 'Agent transport disconnected; saved session remains available for recovery.',
  auth_required: 'The agent requires its existing subscription login before this review can continue.',
  cancelled: 'Review cancelled; its saved session and submitted evidence were retained.',
  protocol_error: 'Agent returned invalid or unsupported protocol messages.',
  control_timeout: 'Agent setup/control operation did not complete; review reasoning has no time limit.',
  runtime_missing: 'Pinned ACP runtime is missing; run audit setup-agents before starting a review.',
  runtime_version_rejected: 'Installed ACP adapter does not match the pinned runtime version.',
  session_identity_rejected: 'Saved session does not match this reviewer, model, source or assignment.',
  session_directory_rejected: 'Session directory permissions or file type are invalid.',
  session_record_failed: 'Session progress could not be saved; review stopped to preserve recovery consistency.',
  resume_unsupported: 'This agent does not advertise support for loading the saved session.',
  model_changed: 'Agent selected a different model; no automatic model substitution is permitted.',
  model_mismatch: 'Provider served a different model than requested; the review is incomplete.',
  turn_incomplete: 'Agent ended its turn without a successful completion status.',
  live_required: 'An API reviewer had no recorded replay for this request and live provider calls are off (set OMNI_LIVE=1 only for a paid live run).',
  provider_error: 'Agent/provider rejected the turn; inspect its private session record.',
  native_turn_failed: 'Native CLI did not produce a successful structured turn result.',
  sandbox_unavailable: 'Docker sandbox was lost before review completion; inspect harness/host/lifecycle.json and resume into a fresh sandbox.',
  permission_denied: 'Agent requested a host capability unavailable to this audit session.',
  cost_ceiling: 'The reviewer reached the run cost ceiling (--max-cost-usd) before this assignment, so it was not reviewed.',
};

const RPC_ERROR_REASONS = [
  ['provider_policy', /flagged for possible cybersecurity risk|apply for Daybreak access/i],
  // "You've hit your session limit", "...your weekly limit", "...your 5-hour limit" (Claude subscriptions name the window).
  ['usage_limit', /you.ve hit your (?:[\w-]+ ){0,2}limit|usage limit (?:reached|exceeded)|quota exceeded|RESOURCE_EXHAUSTED/i],
  ['auth_required', /authentication required|auth required|subscription_login_required|not logged in|please (?:log|sign) in/i],
  ['mcp_unavailable', /audit (?:MCP|tool).*?(?:not (?:show up|attached)|empty)|audit_docker.*?(?:unavailable|not attached)|project MCP server (?:never attached|is not attached)|folder untrusted/i],
];

// R-07: a label comes from a JSON-RPC error object (`error.code`, `error.message`, `error.data.reason`) that the session
// received as the response to a request, never from log or output text, which can quote the target's own source.
// `error` is the object or its JSON encoding (SessionError carries the encoding). Anything else yields null.
export function classifyRpcError(error) {
  let frame = error;
  if (typeof frame === 'string') { try { frame = JSON.parse(frame); } catch { return null; } }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const fields = [frame.message, frame.code, frame.data?.reason, frame.data?.message, frame.data?.status].filter(value => typeof value === 'string' || typeof value === 'number').map(String);
  const text = fields.join('\n');
  return RPC_ERROR_REASONS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

// Labels explain failures without copying source, credentials, or provider payloads into diagnostics.
// `result.rpcError` is the only text-derived input; stdout and stderr are ignored on purpose.
export function classifyAuditFailure(result, fallback = 'missing_report') {
  let reason = fallback;
  const structured = classifyRpcError(result.rpcError);
  if (structured) reason = structured;
  else if (result.timedOut || result.code === 124) reason = 'timeout';
  else if (result.code == null) reason = 'missing_exit';
  else if (result.code !== 0) reason = 'process_error';
  return { reason, message: FAILURE_MESSAGES[reason] };
}

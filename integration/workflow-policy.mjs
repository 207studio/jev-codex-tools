// This module only produces bounded advice.  It deliberately has no executor,
// approval, filesystem, network, or test-running capability.
export const POLICY_VERSION = '1';
export const STRATEGIES = Object.freeze([
  'MAIN_DIRECT', 'MAIN_SCOPED', 'BATCH_JEV', 'CHILD_PROCEDURE',
  'CHILD_IMPLEMENTATION', 'CHILD_DESIGN', 'UNKNOWN',
]);
export const DEFAULT_MODELS = Object.freeze({
  procedure: Object.freeze({model:'gpt-5.6-luna', reasoning_effort:'low'}),
  implementation: Object.freeze({model:'gpt-5.6-terra', reasoning_effort:'medium'}),
  design: Object.freeze({model:'gpt-6-astra', reasoning_effort:'high'}),
});

const ROLES = Object.freeze(['procedure', 'implementation', 'design']);
const KINDS = Object.freeze(['lookup', 'edit', 'debug', 'design', 'bulk', 'mixed']);
const EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const REASONS = Object.freeze([
  'KNOWN_LOOKUP', 'MANUAL_MODEL', 'BULK_SEMANTICS', 'KNOWN_ROLE', 'KNOWN_TASK',
  'DISABLED', 'NO_GOAL', 'INPUT_WITHHELD', 'DECIDED', 'EXPLICIT_UNKNOWN',
  'LOW_CONFIDENCE', 'INVALID_RESPONSE', 'UNAVAILABLE',
]);
const SPEC_KEYS = Object.freeze(['context_id', 'kind', 'scope_known', 'role', 'semantic_items', 'independent_units', 'parallel_benefit', 'goal', 'manual_model']);
const MODEL_KEYS = Object.freeze(['model', 'reasoning_effort']);
const META_KEYS = Object.freeze(['source', 'confidence', 'reason', 'api_calls']);

export class WorkflowPolicyError extends Error {
  constructor(code) { super(code); this.name = 'WorkflowPolicyError'; this.code = code; }
}
const fail = code => { throw new WorkflowPolicyError(code); };
const isPlainRecord = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const dataRecord = (value, allowed, code) => {
  if (!isPlainRecord(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(code);
  }
  return value;
};
const hasData = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const safeIdentifier = value => typeof value === 'string' && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const safeModel = value => typeof value === 'string' && value.length >= 1 && value.length <= 100 && /^[A-Za-z0-9._/-]+$/.test(value);
const safeInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

function validateModelHint(input, code) {
  dataRecord(input, MODEL_KEYS, code);
  if (!hasData(input, 'model') || !hasData(input, 'reasoning_effort') || !safeModel(input.model) || !EFFORTS.includes(input.reasoning_effort)) fail(code);
  return Object.freeze({model:input.model, reasoning_effort:input.reasoning_effort});
}

export function validateModels(input = DEFAULT_MODELS) {
  dataRecord(input, ROLES, 'INVALID_MODELS');
  if (Reflect.ownKeys(input).length !== ROLES.length || ROLES.some(role => !hasData(input, role))) fail('INVALID_MODELS');
  return Object.freeze(Object.fromEntries(ROLES.map(role => [role, validateModelHint(input[role], 'INVALID_MODELS')])));
}

export function validateSpec(input) {
  dataRecord(input, SPEC_KEYS, 'INVALID_SPEC');
  const required = ['context_id', 'kind', 'scope_known', 'role', 'semantic_items', 'independent_units', 'parallel_benefit'];
  if (required.some(key => !hasData(input, key))) fail('INVALID_SPEC');
  if (!safeIdentifier(input.context_id) || !KINDS.includes(input.kind) || typeof input.scope_known !== 'boolean' || !['procedure', 'implementation', 'design', 'mixed'].includes(input.role) || !safeInteger(input.semantic_items, 0, 100000) || !safeInteger(input.independent_units, 1, 32) || typeof input.parallel_benefit !== 'boolean') fail('INVALID_SPEC');
  const goal = hasData(input, 'goal') ? input.goal : '';
  if (typeof goal !== 'string' || Buffer.byteLength(goal, 'utf8') > 1000) fail('INVALID_SPEC');
  const normalized = {context_id:input.context_id, kind:input.kind, scope_known:input.scope_known, role:input.role, semantic_items:input.semantic_items, independent_units:input.independent_units, parallel_benefit:input.parallel_benefit, goal};
  if (hasData(input, 'manual_model')) normalized.manual_model = validateModelHint(input.manual_model, 'INVALID_SPEC');
  return Object.freeze(normalized);
}

const childForRole = role => ({procedure:'CHILD_PROCEDURE', implementation:'CHILD_IMPLEMENTATION', design:'CHILD_DESIGN'})[role] || null;
function deterministic(spec) {
  if (spec.manual_model) return ['MAIN_SCOPED', 'MANUAL_MODEL'];
  if (spec.kind === 'lookup') return ['MAIN_DIRECT', 'KNOWN_LOOKUP'];
  if (spec.semantic_items >= 5) return ['BATCH_JEV', 'BULK_SEMANTICS'];
  const child = spec.kind !== 'mixed' && spec.independent_units >= 2 && spec.parallel_benefit ? childForRole(spec.role) : null;
  if (child) return [child, 'KNOWN_ROLE'];
  return [spec.kind === 'edit' && spec.scope_known ? 'MAIN_DIRECT' : 'MAIN_SCOPED', 'KNOWN_TASK'];
}
function eligible(spec, strategy, source) {
  if (strategy === 'UNKNOWN') return true;
  if (source === 'policy') return deterministic(spec)[0] === strategy;
  if (source === 'jev') {
    if (spec.kind !== 'mixed' || spec.manual_model || spec.semantic_items >= 5 || strategy === 'BATCH_JEV') return false;
    if (strategy === 'MAIN_SCOPED') return true;
    return strategy.startsWith('CHILD_') && spec.independent_units >= 2 && spec.parallel_benefit;
  }
  return source === 'unavailable' && strategy === 'UNKNOWN';
}

export function formatPlan(specInput, strategy, metadata, models = DEFAULT_MODELS) {
  const spec = validateSpec(specInput);
  const validatedModels = validateModels(models);
  if (!STRATEGIES.includes(strategy)) fail('INVALID_METADATA');
  dataRecord(metadata, META_KEYS, 'INVALID_METADATA');
  if (!hasData(metadata, 'source') || !hasData(metadata, 'confidence') || !hasData(metadata, 'reason') || !hasData(metadata, 'api_calls')) fail('INVALID_METADATA');
  const {source, confidence, reason, api_calls} = metadata;
  if (!['policy', 'jev', 'unavailable'].includes(source) || !REASONS.includes(reason) || !safeInteger(api_calls, 0, 1) || !(confidence === null || (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) || !eligible(spec, strategy, source)) fail('INVALID_METADATA');
  if (source === 'policy') {
    if (api_calls !== 0 || confidence !== null) fail('INVALID_METADATA');
    if (strategy === 'UNKNOWN') {
      if (spec.kind !== 'mixed' || spec.manual_model || spec.semantic_items >= 5 || !['DISABLED', 'NO_GOAL', 'INPUT_WITHHELD'].includes(reason)) fail('INVALID_METADATA');
    } else {
      const expected = deterministic(spec);
      if (strategy !== expected[0] || reason !== expected[1]) fail('INVALID_METADATA');
    }
  }
  if (source === 'jev') {
    if (api_calls !== 1) fail('INVALID_METADATA');
    if (strategy === 'UNKNOWN') {
      if (!['EXPLICIT_UNKNOWN', 'LOW_CONFIDENCE'].includes(reason)) fail('INVALID_METADATA');
    } else if (reason !== 'DECIDED' || !Number.isFinite(confidence) || confidence < 0.7) fail('INVALID_METADATA');
  }
  // api_calls means this client's request attempts, not provider billing.  The
  // zero-attempt form is reserved for known local/preflight unavailability.
  if (source === 'unavailable' && (strategy !== 'UNKNOWN' || !['INVALID_RESPONSE', 'UNAVAILABLE'].includes(reason) || (api_calls === 0 && reason !== 'UNAVAILABLE'))) fail('INVALID_METADATA');
  const selectedRole = {CHILD_PROCEDURE:'procedure', CHILD_IMPLEMENTATION:'implementation', CHILD_DESIGN:'design'}[strategy];
  const model_hint = spec.manual_model || (selectedRole ? validatedModels[selectedRole] : null);
  return Object.freeze({strategy, source, confidence, reason, api_calls, model_hint, fork_turns:'none', lookup_bytes:1000, expanded_lookup_bytes:4000, verification:'existing_required_checks', advisory_only:true});
}

const containsSensitiveInput = goal => /(?:\b(?:api[_-]?key|secret|password|token|credential)\b\s*[:=]|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bbearer\s+\S+|\b(?:sk|pk)-[A-Za-z0-9_-]{8,}|\bAKIA[0-9A-Z]{12,}|\bghp_[A-Za-z0-9]{8,}|\bxox[baprs]-[A-Za-z0-9-]{8,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(goal);
const instructions = 'Choose only from the supplied criteria. This is advisory workflow planning; do not request execution, approvals, or test skips.';
function responseChoice(result) {
  if (!isPlainRecord(result) || Reflect.ownKeys(result).some(key => key !== 'answer' && key !== 'diagnostic')) return null;
  const answerDescriptor = Object.getOwnPropertyDescriptor(result, 'answer');
  const diagnosticDescriptor = Object.getOwnPropertyDescriptor(result, 'diagnostic');
  if (!answerDescriptor || !diagnosticDescriptor || !Object.prototype.hasOwnProperty.call(answerDescriptor, 'value') || !Object.prototype.hasOwnProperty.call(diagnosticDescriptor, 'value')) return null;
  const answer = answerDescriptor.value;
  const diagnostic = diagnosticDescriptor.value;
  if (!isPlainRecord(diagnostic) || !hasData(diagnostic, 'status')) return null;
  const statusDescriptor = Object.getOwnPropertyDescriptor(diagnostic, 'status');
  if (!statusDescriptor || !Object.prototype.hasOwnProperty.call(statusDescriptor, 'value') || typeof statusDescriptor.value !== 'string') return null;
  if (answer === null) return {choice:null, confidence:null, status:statusDescriptor.value};
  if (!isPlainRecord(answer) || Reflect.ownKeys(answer).some(key => key !== 'choice' && key !== 'confidence' && key !== 'diagnostic') || !hasData(answer, 'choice') || !hasData(answer, 'confidence')) return null;
  const choiceDescriptor = Object.getOwnPropertyDescriptor(answer, 'choice');
  const confidenceDescriptor = Object.getOwnPropertyDescriptor(answer, 'confidence');
  if (!choiceDescriptor || !confidenceDescriptor || !Object.prototype.hasOwnProperty.call(choiceDescriptor, 'value') || !Object.prototype.hasOwnProperty.call(confidenceDescriptor, 'value')) return null;
  return {choice:choiceDescriptor.value, confidence:confidenceDescriptor.value, status:statusDescriptor.value};
}

const preflightStatuses = new Set(['missing_key', 'invalid_request', 'request_too_large']);
const attemptsForStatus = status => preflightStatuses.has(status) ? 0 : 1;

export async function planWorkflow(input, options = {}) {
  const spec = validateSpec(input);
  dataRecord(options, ['decide', 'enabled', 'models'], 'INVALID_OPTIONS');
  const decide = hasData(options, 'decide') ? options.decide : undefined;
  const enabled = hasData(options, 'enabled') ? options.enabled : false;
  const models = hasData(options, 'models') ? options.models : DEFAULT_MODELS;
  const validatedModels = validateModels(models);
  if (typeof enabled !== 'boolean') fail('INVALID_OPTIONS');
  const known = deterministic(spec);
  if (spec.manual_model || spec.semantic_items >= 5) return formatPlan(spec, known[0], {source:'policy', confidence:null, reason:known[1], api_calls:0}, validatedModels);
  if (spec.kind !== 'mixed') return formatPlan(spec, known[0], {source:'policy', confidence:null, reason:known[1], api_calls:0}, validatedModels);
  if (!enabled) return formatPlan(spec, 'UNKNOWN', {source:'policy', confidence:null, reason:'DISABLED', api_calls:0}, validatedModels);
  if (!spec.goal) return formatPlan(spec, 'UNKNOWN', {source:'policy', confidence:null, reason:'NO_GOAL', api_calls:0}, validatedModels);
  if (containsSensitiveInput(spec.goal)) return formatPlan(spec, 'UNKNOWN', {source:'policy', confidence:null, reason:'INPUT_WITHHELD', api_calls:0}, validatedModels);
  if (typeof decide !== 'function') return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:null, reason:'UNAVAILABLE', api_calls:0}, validatedModels);
  const state = {goal:spec.goal, kind:spec.kind, scope_known:spec.scope_known, role:spec.role, semantic_items:spec.semantic_items, independent_units:spec.independent_units, parallel_benefit:spec.parallel_benefit};
  const criteria = Object.assign(Object.create(null), {
    MAIN_SCOPED:'Use one main task when work is sequential or needs shared context.',
    UNKNOWN:'Use when the supplied task metadata is insufficient for a bounded plan.',
  });
  if (spec.independent_units >= 2 && spec.parallel_benefit) Object.assign(criteria, {
    CHILD_PROCEDURE:'Delegate mechanical, known procedural steps.',
    CHILD_IMPLEMENTATION:'Delegate one scoped implementation, edit, or review unit.',
    CHILD_DESIGN:'Delegate design work with conflicting constraints to resolve.',
  });
  let result;
  try { result = await decide(state, instructions, criteria, {timeout:1500, retries:0, diagnose:false, minConfidence:0.7}); }
  catch { return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:null, reason:'UNAVAILABLE', api_calls:1}, validatedModels); }
  const choice = responseChoice(result);
  if (!choice) return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:null, reason:'INVALID_RESPONSE', api_calls:1}, validatedModels);
  const api_calls = attemptsForStatus(choice.status);
  if (choice.choice === null) return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:null, reason:choice.status === 'invalid_response' ? 'INVALID_RESPONSE' : 'UNAVAILABLE', api_calls}, validatedModels);
  if (choice.status === 'explicit_unknown' && choice.choice === 'UNKNOWN' && Number.isFinite(choice.confidence) && choice.confidence >= 0 && choice.confidence <= 1) return formatPlan(spec, 'UNKNOWN', {source:'jev', confidence:choice.confidence, reason:'EXPLICIT_UNKNOWN', api_calls:1}, validatedModels);
  if (choice.status === 'low_confidence' && Number.isFinite(choice.confidence) && choice.confidence >= 0 && choice.confidence < 0.7) return formatPlan(spec, 'UNKNOWN', {source:'jev', confidence:choice.confidence, reason:'LOW_CONFIDENCE', api_calls:1}, validatedModels);
  if (choice.status !== 'decided') return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:null, reason:'UNAVAILABLE', api_calls}, validatedModels);
  if (!Number.isFinite(choice.confidence) || choice.confidence < 0 || choice.confidence > 1) return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:null, reason:'INVALID_RESPONSE', api_calls:1}, validatedModels);
  if (choice.choice === 'UNKNOWN') return formatPlan(spec, 'UNKNOWN', {source:'jev', confidence:choice.confidence, reason:'EXPLICIT_UNKNOWN', api_calls:1}, validatedModels);
  if (choice.confidence < 0.7) return formatPlan(spec, 'UNKNOWN', {source:'jev', confidence:choice.confidence, reason:'LOW_CONFIDENCE', api_calls:1}, validatedModels);
  if (!Object.prototype.hasOwnProperty.call(criteria, choice.choice) || !eligible(spec, choice.choice, 'jev')) return formatPlan(spec, 'UNKNOWN', {source:'unavailable', confidence:choice.confidence, reason:'INVALID_RESPONSE', api_calls:1}, validatedModels);
  return formatPlan(spec, choice.choice, {source:'jev', confidence:choice.confidence, reason:'DECIDED', api_calls:1}, validatedModels);
}

// Bounded, local-only explanation for an uncertain outcome.  This deliberately
// accepts codes rather than provider text, state, prompts, paths, or errors.
const semantic = Object.freeze({
  EXPLICIT_UNKNOWN:['판단 정보 부족','필요한 정보를 추가'],
  LOW_CONFIDENCE:['판단 신뢰도 부족','근거를 보강'],
  MISSING_EVIDENCE:['근거 부족','필요한 정보를 추가'],
  AMBIGUOUS_QUESTION:['질문 해석이 모호함','질문을 구체화'],
  CONFLICTING_EVIDENCE:['근거가 서로 충돌함','충돌한 근거를 확인'],
  MISSING_OPTION:['선택지가 부족함','필요한 선택지를 추가'],
  UNKNOWN:['원인 확인 불가','근거를 확인'],
});
const runtime = Object.freeze({
  LOW_CONFIDENCE:['판단 신뢰도 부족','근거를 보강'],
  MISSING_KEY:['인증 정보 없음','인증 설정을 확인'],
  INPUT_LIMIT:['입력 한도 초과','입력 범위를 줄임'],
  BUDGET_EXHAUSTED:['판단 시간 한도 소진','나중에 다시 판단'],
  REQUEST_TOO_LARGE:['요청 크기 초과','입력 범위를 줄임'],
  HTTP_ERROR:['서비스 응답 실패','서비스 상태를 확인'],
  TIMEOUT:['응답 시간 초과','나중에 다시 판단'],
  TRANSPORT_ERROR:['연결 오류','연결 상태를 확인'],
  INVALID_JSON:['응답 형식 오류','서비스 응답을 확인'],
  INVALID_RESPONSE:['응답 검증 실패','서비스 응답을 확인'],
  INVALID_MODEL:['모델 식별 실패','서비스 설정을 확인'],
  INVALID_REQUEST:['요청 구성 오류','요청 설정을 확인'],
  INPUT_WITHHELD:['민감한 입력 보류','안전한 요약을 제공'],
});
const unresolved = Object.freeze(['원인 확인 불가','근거를 확인']);
const normalized = value => typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') : '';

// The result is intentionally fixed-vocabulary Korean.  It is suitable for
// CLI, cache, and verification output because it cannot echo private input.
export function formatUnknownReason(info = {}) {
  let status = '', diagnosis = '', attempted = false, confidence = null;
  try { status = normalized(info?.status); diagnosis = normalized(info?.diagnosis?.reason); attempted = info?.diagnosis?.request_attempted === true; confidence = info?.diagnosis?.confidence; } catch {}
  // Runtime facts win over an old or injected semantic diagnosis. A bounded
  // diagnosis may itself report a local input/budget boundary.
  const runtimeCode = runtime[status] ? status : runtime[diagnosis] ? diagnosis : '';
  if (runtimeCode) {
    const details = runtime[runtimeCode];
    return Object.freeze({code:runtimeCode, category:'runtime', label:details[0], next_action:details[1], source:'runtime', inferred:false,
      display:`UNKNOWN · ${details[0]} — ${details[1]}`});
  }
  // A provider reason is a labelled inference only when the bounded reason
  // request actually ran and returned a supported semantic code.
  const providerReason = attempted && Number.isFinite(confidence) && confidence >= 0.7 && confidence <= 1 && diagnosis && !['UNKNOWN','LOW_CONFIDENCE'].includes(diagnosis) && semantic[diagnosis] ? diagnosis : '';
  if (providerReason) {
    const details = semantic[providerReason];
    return Object.freeze({code:providerReason, category:'semantic', label:details[0], next_action:details[1], source:'jev', inferred:true,
      display:`UNKNOWN · ${details[0]} (추정) — ${details[1]}`});
  }
  const code = 'UNKNOWN', details = unresolved;
  return Object.freeze({code, category:'unresolved', label:details[0], next_action:details[1], source:'local', inferred:false,
    display:`UNKNOWN · ${details[0]} — ${details[1]}`});
}

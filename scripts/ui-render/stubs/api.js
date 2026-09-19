/**
 * Stub for the generated Convex API object, used only by the offline UI render
 * harness. Each entry carries the `module:function` path the component would
 * have called, so the stub hooks can key fixtures off it.
 *
 * Every module and function the components actually reference must appear here:
 * a missing entry is not a silent no-op — `api.x.y` throws while rendering, so
 * the harness would fail on a component that is perfectly fine.
 */
const ref = (name) => ({ __name: name });

export const api = {
  assessments: {
    retryAssessment: ref("assessments:retryAssessment"),
  },
  cases: {
    createWithInbox: ref("cases:createWithInbox"),
    get: ref("cases:get"),
    getTimeline: ref("cases:getTimeline"),
    list: ref("cases:list"),
    retryInboxProvision: ref("cases:retryInboxProvision"),
  },
  deductions: {
    listByCase: ref("deductions:listByCase"),
  },
  emails: {
    listByCase: ref("emails:listByCase"),
    listCommunication: ref("emails:listCommunication"),
    retryProcessing: ref("emails:retryProcessing"),
  },
  letters: {
    approveLetter: ref("letters:approveLetter"),
    draftLetter: ref("letters:draftLetter"),
    getDraftReadiness: ref("letters:getDraftReadiness"),
    getForCase: ref("letters:getForCase"),
    getSupportingSources: ref("letters:getSupportingSources"),
    presentForApproval: ref("letters:presentForApproval"),
    saveLetterEdits: ref("letters:saveLetterEdits"),
    startNewDraft: ref("letters:startNewDraft"),
  },
  outbound: {
    sendLetter: ref("outbound:sendLetter"),
    setLandlordEmail: ref("outbound:setLandlordEmail"),
  },
  research: {
    retryResearch: ref("research:retryResearch"),
  },
  responses: {
    retryResponseAnalysis: ref("responses:retryResponseAnalysis"),
  },
  sources: {
    listByCase: ref("sources:listByCase"),
  },
  users: {
    current: ref("users:current"),
    ensureDemo: ref("users:ensureDemo"),
  },
};

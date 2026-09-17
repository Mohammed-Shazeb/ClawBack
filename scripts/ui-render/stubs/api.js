/**
 * Stub for the generated Convex API object, used only by the offline UI render
 * harness. Each entry carries the `module:function` path the component would
 * have called, so the stub hooks can key fixtures off it.
 */
const ref = (name) => ({ __name: name });

export const api = {
  letters: {
    getForCase: ref("letters:getForCase"),
    getDraftReadiness: ref("letters:getDraftReadiness"),
    getSupportingSources: ref("letters:getSupportingSources"),
    draftLetter: ref("letters:draftLetter"),
    saveLetterEdits: ref("letters:saveLetterEdits"),
    presentForApproval: ref("letters:presentForApproval"),
    approveLetter: ref("letters:approveLetter"),
    startNewDraft: ref("letters:startNewDraft"),
  },
  emails: {
    listByCase: ref("emails:listByCase"),
    listCommunication: ref("emails:listCommunication"),
    retryProcessing: ref("emails:retryProcessing"),
  },
  outbound: {
    sendLetter: ref("outbound:sendLetter"),
    setLandlordEmail: ref("outbound:setLandlordEmail"),
  },
  responses: {
    retryResponseAnalysis: ref("responses:retryResponseAnalysis"),
  },
};

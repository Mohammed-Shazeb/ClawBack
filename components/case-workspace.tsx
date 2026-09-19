"use client";

import { CaseOverview } from "./case-overview";
import { useCurrentUser } from "./current-user";
import { WorkspaceGate } from "./workspace-gate";

/**
 * The case screen's client entry point.
 *
 * The route itself is a server component — it only unwraps `params` — so it
 * cannot read the session. This exists to make that reading a client concern and
 * to hand `CaseOverview` a plain id, which keeps the overview renderable offline
 * with a fixed id.
 */
export function CaseWorkspace({ caseId }: { caseId: string }) {
  const { userId } = useCurrentUser();

  return (
    <WorkspaceGate>
      <CaseOverview caseId={caseId} userId={userId} />
    </WorkspaceGate>
  );
}

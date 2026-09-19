import { CaseList } from "@/components/case-list";
import { WorkspaceGate } from "@/components/workspace-gate";

export default function CasesPage() {
  return (
    <WorkspaceGate>
      <CaseList />
    </WorkspaceGate>
  );
}
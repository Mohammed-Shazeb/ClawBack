import { NewCaseForm } from "@/components/new-case-form";
import { WorkspaceGate } from "@/components/workspace-gate";

export default function NewCasePage() {
  return (
    <WorkspaceGate>
      <NewCaseForm />
    </WorkspaceGate>
  );
}
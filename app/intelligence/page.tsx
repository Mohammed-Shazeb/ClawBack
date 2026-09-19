import { Intelligence } from "@/components/clarity/intelligence";
import { CaseDataProvider } from "@/components/clarity/case-data-provider";
import { RequireAuth } from "@/components/clarity/states";

export default function IntelligencePage() {
  return (
    <RequireAuth>
      <CaseDataProvider>
        <Intelligence />
      </CaseDataProvider>
    </RequireAuth>
  );
}

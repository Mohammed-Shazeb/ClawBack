import { CaseOverview } from "@/components/clarity/case-overview";
import { CaseDataProvider } from "@/components/clarity/case-data-provider";
import { RequireAuth } from "@/components/clarity/states";

export default function CasePage() {
  return (
    <RequireAuth>
      <CaseDataProvider>
        <CaseOverview />
      </CaseDataProvider>
    </RequireAuth>
  );
}

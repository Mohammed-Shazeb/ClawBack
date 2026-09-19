import { Timeline } from "@/components/clarity/timeline";
import { CaseDataProvider } from "@/components/clarity/case-data-provider";
import { RequireAuth } from "@/components/clarity/states";

export default function TimelinePage() {
  return (
    <RequireAuth>
      <CaseDataProvider>
        <Timeline />
      </CaseDataProvider>
    </RequireAuth>
  );
}

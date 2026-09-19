import { Suspense } from "react";

import { Evidence } from "@/components/clarity/evidence";
import { CaseDataProvider } from "@/components/clarity/case-data-provider";
import { RequireAuth } from "@/components/clarity/states";

export default function EvidencePage() {
  return (
    <RequireAuth>
      <CaseDataProvider>
        {/* `Evidence` reads `?d=` to preselect a deduction; Suspense keeps the
            search-params read from opting the whole route out of prerender. */}
        <Suspense fallback={null}>
          <Evidence />
        </Suspense>
      </CaseDataProvider>
    </RequireAuth>
  );
}

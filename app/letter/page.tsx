import { Letter } from "@/components/clarity/letter";
import { CaseDataProvider } from "@/components/clarity/case-data-provider";
import { RequireAuth } from "@/components/clarity/states";

export default function LetterPage() {
  return (
    <RequireAuth>
      <CaseDataProvider>
        <Letter />
      </CaseDataProvider>
    </RequireAuth>
  );
}

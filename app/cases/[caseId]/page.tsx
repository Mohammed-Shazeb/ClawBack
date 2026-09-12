import { CaseOverview } from "@/components/case-overview";

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <CaseOverview caseId={caseId} />;
}
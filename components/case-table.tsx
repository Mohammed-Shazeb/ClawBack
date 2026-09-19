"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { caseReference, caseStatus } from "@/lib/case-status";
import { formatCurrency } from "@/lib/format";
import { Badge } from "./ui/primitives";

export type CaseTableRow = {
  _id: string;
  jurisdiction: string;
  depositAmount: number;
  totalDeductions: number;
  potentiallyDisputableAmount: number;
  status: string;
  createdAt: number;
};

/**
 * The cases index.
 *
 * A real table, because this is tabular data: the columns are comparable down
 * the page, and the disputable figure is the one that carries weight. Columns
 * that only matter on a wide screen drop away on small ones rather than
 * squeezing into unreadable cells.
 *
 * The table sits inside a Panel that clips its overflow, so the wrapper scrolls
 * horizontally instead: on a narrow screen the remaining columns stay reachable
 * rather than being cut off at the panel edge.
 */
export function CaseTable({ cases }: { cases: CaseTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <Th>Case</Th>
            <Th className="hidden md:table-cell">Jurisdiction</Th>
            <Th align="right" className="hidden lg:table-cell">
              Deposit
            </Th>
            <Th align="right" className="hidden lg:table-cell">
              Deductions
            </Th>
            {/* The full label is the honest one, but it does not fit beside the
                case reference on a phone, and a wrapped header is worse than a
                shorter one. */}
            <Th align="right">
              <span className="sm:hidden">Disputable</span>
              <span className="hidden sm:inline">Potentially disputable</span>
            </Th>
            <Th className="hidden sm:table-cell">Status</Th>
            <th className="w-8" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => {
            const status = caseStatus(item.status);
            return (
              <tr
                key={item._id}
                className="group relative border-b border-line transition-colors last:border-0 hover:bg-surface-muted"
              >
                <td className="px-5 py-3.5">
                  <Link
                    href={`/cases/${item._id}`}
                    className="text-[13px] font-medium text-ink after:absolute after:inset-0"
                  >
                    {caseReference(item._id)}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </td>

                <td className="hidden px-5 py-3.5 text-[13px] text-ink-secondary md:table-cell">
                  {item.jurisdiction}
                </td>

                <td className="tabular hidden px-5 py-3.5 text-right text-[13px] text-ink-secondary lg:table-cell">
                  {formatCurrency(item.depositAmount)}
                </td>

                <td className="tabular hidden px-5 py-3.5 text-right text-[13px] text-ink-secondary lg:table-cell">
                  {formatCurrency(item.totalDeductions)}
                </td>

                <td className="tabular px-5 py-3.5 text-right text-[13px] font-semibold text-ink">
                  {formatCurrency(item.potentiallyDisputableAmount)}
                </td>

                <td className="hidden px-5 py-3.5 sm:table-cell">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>

                <td className="pr-4">
                  <ChevronRight
                    size={14}
                    aria-hidden="true"
                    className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted ${
        align === "right" ? "text-right" : ""
      } ${className}`}
    >
      {children}
    </th>
  );
}

"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE app-wide pagination (standardised 2026-11-26 at Jeet's
 * direction, matching the Contacts style): a "Showing a–b of N …"
 * summary plus chevron + numbered page buttons, the current page
 * filled with the primary colour. On small screens the summary
 * stacks above and the controls sit CENTERED; from sm up they
 * share one row — summary left, controls right. Every paginated
 * list (Contacts, Notifications, Automation activity, …) uses
 * this component so the UI stays consistent.
 */
export function PaginationBar({
  page,
  pageCount,
  onPageChange,
  summary,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  summary?: ReactNode;
  className?: string;
}) {
  // All pages when few; otherwise a window around the current page
  // with the first two and last two pinned (ellipses mark the gaps).
  const pageList = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set([1, 2, page - 1, page, page + 1, pageCount - 1, pageCount]);
    return [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  }, [pageCount, page]);

  if (!summary && pageCount <= 1) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3",
        className,
      )}
    >
      {summary ? (
        <p className="text-muted-foreground text-xs sm:flex-1">{summary}</p>
      ) : null}
      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-1.5 sm:justify-end">
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          {pageList.map((n, idx) => (
            <Fragment key={n}>
              {idx > 0 && n - (pageList[idx - 1] ?? n) > 1 ? (
                <span className="text-muted-foreground px-0.5 text-xs">…</span>
              ) : null}
              <button
                type="button"
                onClick={() => onPageChange(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={cn(
                  "size-8 rounded-full border text-xs font-medium transition-colors",
                  n === page
                    ? "bg-primary border-transparent text-primary-foreground"
                    : "bg-card hover:border-primary/40",
                )}
              >
                {n}
              </button>
            </Fragment>
          ))}
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

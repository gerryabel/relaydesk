import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the customer ticket list (Phase 9 Task 2).
 *
 * Mirrors the real row layout so the list does not reflow when data arrives,
 * and is purely decorative (`aria-hidden`) so a screen reader announces the
 * page heading instead of six empty cards.
 */
export function CustomerTicketListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index}>
          <Card className="p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton variant="text" className="h-4 w-20" />
                <Skeleton variant="rect" className="h-5 w-24 rounded-md" />
              </div>
              <Skeleton variant="text" className="h-4 w-3/4" />
              <Skeleton variant="text" className="h-3 w-1/2" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

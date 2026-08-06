'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export function TicketListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="p-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex-1">
                <Skeleton variant="text" className="h-4 w-3/4" />
                <Skeleton variant="text" className="mt-2 h-3 w-1/2" />
              </div>
              <div className="flex gap-2">
                <Skeleton variant="rect" className="h-6 w-16 rounded-md" />
                <Skeleton variant="rect" className="h-6 w-16 rounded-md" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

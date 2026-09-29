import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAutomationExecutionById } from '@/lib/automation/executions';
import { ExecutionNotFoundError } from '@/lib/automation/execution-service';
import { ExecutionDetail } from '@/components/automations/execution-detail';

type ExecutionDetailPageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Execution detail / debugging view.
 *
 * Renders the historical execution record: rule name snapshot, source event
 * context, and the per-action timeline with the action configuration that was
 * actually executed. A missing source event degrades gracefully; a missing or
 * cross-workspace execution 404s without disclosing ownership.
 */
export default async function AutomationExecutionDetailPage({ params }: ExecutionDetailPageProps) {
  const { id } = await params;

  let detail;
  try {
    detail = await getAutomationExecutionById(id);
  } catch (error) {
    if (error instanceof ExecutionNotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header>
          <Link
            href="/dashboard/automations/executions"
            className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            ← Back to execution history
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Execution detail</h1>
        </header>

        <ExecutionDetail detail={detail} />
      </div>
    </div>
  );
}

import { getTicketById } from '@/lib/tickets/server';
import { TicketNotFoundError } from '@/lib/tickets/server';
import EditTicketForm from '@/components/tickets/edit-ticket-form';
import { notFound } from 'next/navigation';

type EditTicketPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTicketPage({ params }: EditTicketPageProps) {
  const { id } = await params;
  let ticket;

  try {
    ticket = await getTicketById(id);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      notFound();
    }

    throw error;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Edit ticket</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Ubah detail tiket sesuai perkembangan terkini.
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <EditTicketForm ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

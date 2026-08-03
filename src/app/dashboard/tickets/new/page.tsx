import CreateTicketForm from '@/components/tickets/create-ticket-form';

export default function NewTicketPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Create ticket</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Tulis ringkasan masalah atau permintaan kerja.
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <CreateTicketForm />
        </div>
      </div>
    </div>
  );
}

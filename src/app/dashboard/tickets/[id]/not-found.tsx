export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="text-xl font-semibold">Ticket not found</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Tiket yang kamu cari tidak ada atau tidak dapat diakses.
        </p>
      </div>
    </div>
  );
}

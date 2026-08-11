# Phase 4 — Task 4: Search

Version: 0.3.0-alpha

## Objective

Memperluas pencarian ticket agar tidak hanya mengandalkan `title`, tetapi juga mencakup `description`, `creator.name`, dan `assignee.name` tanpa mengubah schema atau migration yang ada.

## Scope

* Mengaktifkan OR search yang sudah ada untuk field `title` dan `description`.
* Menambahkan pencarian berdasarkan `creator.name` dan `assignee.name`.
* Memastikan UI search menggunakan wording yang lebih generik.
* Menjaga API contract yang sudah ada tetap stabil.

Out of scope untuk task ini:

* External search service.
* Index atau migration baru.
* Perubahan schema atau relasi assignee.

## Architecture Changes

Perubahan dilakukan di layer service agar tetap terpusat:

* `src/lib/tickets/server.ts` — memperluas `buildTicketWhere` agar OR search menyertakan `createdBy.name` dan `assignedTo.name`.
* `src/app/dashboard/tickets/page.tsx` — memastikan UI page mengirim object query `search: { q }` agar memanfaatkan OR search.
* `src/components/tickets/ticket-filters.tsx` — memperbarui placeholder agar sesuai cakupan search yang baru.

Tidak ada perubahan pada `schema.ts`, `sort.ts`, `pagination.ts`, atau route API karena kontrak sudah sesuai kebutuhan Task 4.

## Search Behavior

* Query string dianggap case-insensitive.
* Query string mendukung partial match.
* Ketika dikirim sebagai object query, search diterapkan sebagai OR terhadap:
  * `Ticket.title`
  * `Ticket.description`
  * `User.name` sebagai creator
  * `User.name` sebagai assignee
* Workspace isolation tetap dijunjung pada setiap query.
* Search tetap dapat digabung dengan `status`, `priority`, `sort`, dan `pagination`.

## Database / Schema Impact

Tidak ada. Task 4 menggunakan relasi yang sudah ada:

* `Ticket.createdBy` — `User`
* `Ticket.assignedTo` — `User`

Tidak ada migration baru.

## API Changes

API contract tetap sama. Perubahan hanya pada perilaku internal `getTickets` ketika menerima object query `search`.

## UI Changes

* Placeholder search berubah dari `Cari judul tiket...` menjadi `Cari tiket...` agar representasi search sesuai cakupan field baru.

## Testing

* Menambah coverage untuk:
  * OR search creator/assignee via object query.
  * Search dengan sorting.
  * Search dengan pagination.
  * Listing tanpa search tetap berperilaku sama.
* Mempertahankan existing regression test tanpa menghapus coverage.
* Semua test tetap lulus: `npm run test` menghasilkan 157 passed.

## Performance Consideration

Menggunakan `contains` + `mode: 'insensitive'` milik Prisma/PostgreSQL tanpa index khusus.

Trade-off: cocok untuk dataset kecil-menengah yang umum pada aplikasi internal. Jika nanti data ticket tumbuh sangat besar, pertimbangkan pencapaian performa terpisah tanpa menambah eksternal search service untuk task ini.

## Design Decisions

* Mempertahankan API `search` yang sudah ada dan object query `q` sebagai sinyal untuk OR search agar backward compatible dengan UI dan API yang ada.
* Menggunakan `User.name` sebagai satu-satunya sumber search untuk creator/assignee sesuai spesifikasi tanpa menambah email search.

## Trade-offs

* Tidak ada highlighting hasil search.
* Tidak ada autocomplete atau search history.
* Tidak ada penambahan index baru untuk menjaga scope Task 4 tetap minimal.

## Definition of Done Result

* Title search: partial + case-insensitive.
* Description search: partial + case-insensitive.
* Creator search: partial + case-insensitive via `User.name`.
* Assignee search: partial + case-insensitive via relasi `assignedTo` yang sudah ada.
* Workspace isolation tetap berlaku.
* Filter, sort, dan pagination tetap kompatibel.
* UI wording diperbarui.
* Lint, typecheck, test, build lulus.
* Git branch `phase-4/task-4-search` siap di-push.

# Phase 4 — Task 7 — Pagination

## Objective

Menutup coverage pagination pada ticket list agar navigasi dataset besar tetap stabil, terverifikasi, dan terdokumentasi dengan baik.

Pagination offset/page-number untuk daftar ticket sudah terintegrasi melalui service layer, dashboard page, dan API search. Task 7 bukan membangun pagination dari nol, melainkan melakukan documentation closure, acceptance criteria alignment, dan penambahan focused edge-case test coverage.

## Scope

- Mendokumentasikan arsitektur pagination yang sudah ada.
- Menyelaraskan acceptance criteria agar berbentuk offset/page-number pagination.
- Menambahkan focused test untuk edge case pagination yang belum tercover.
- Mempertahankan behavior page clamping yang sudah ada di service layer.
- Memverifikasi kombinasi pagination dengan search, filter, sort, dan assignee.

## Non-Goals

- Migrasi ke cursor-based pagination.
- Menambahkan database migration atau perubahan schema.
- Redesign UI pagination.
- Menambahkan numbered pagination, infinite scroll, atau page-size selector.
- Refactor besar URL state management.
- Perubahan endpoint atau response schema API ticket search.
- Perubahan fitur di luar pagination seperti realtime update atau saved preferences.

## Current Pagination Architecture

### Module Map

- `src/lib/tickets/pagination.ts` — normalisasi `page`/`limit`, validasi guardrail, dan result metadata contract.
- `src/lib/tickets/server.ts` — menerapkan `skip`/`take`, menghitung `total`/`totalPages`, dan menangani page clamping.
- `src/app/dashboard/tickets/page.tsx` — membaca `page`/`limit` dari URL, menampilkan Previous/Next, dan mempertahankan state filter/search/sort/assignee.
- `src/app/api/tickets/search/route.ts` — meneruskan `page`/`limit` ter-normalisasi ke service layer.

### Offset/Page-Number Behavior

- `page` berbasis 1-based page number.
- `limit` menentukan jumlah item per halaman.
- `skip = (page - 1) * limit`
- `take = limit`
- Default: `page = 1`, `limit = 20`.
- `limit` maksimal: `100`.

### Pagination Metadata

Response mengembalikan:

- `data` — daftar ticket pada halaman saat ini.
- `page` — halaman yang sedang ditampilkan setelah normalisasi.
- `limit` — limit yang digunakan.
- `total` — jumlah ticket sesuai filter/search/sort.
- `totalPages` — total halaman berdasarkan `total` dan `limit`.
- `hasPreviousPage` — `true` jika bukan halaman pertama.
- `hasNextPage` — `true` jika bukan halaman terakhir.

### URL Query Parameters

Dashboard tickets page membaca dan menulis state pagination lewat query string:

- `page`
- `limit`
- `p` sebagai fallback untuk `page`
- `per_page` sebagai fallback untuk `limit`

Perubahan filter, search, assignee, atau sort tidak menghapus `page`/`limit` secara otomatis. Navigasi pagination memperbarui query string sambil mempertahankan parameter lain.

### API Contract

Endpoint:

- `GET /api/tickets/search`

Parameter opsional yang relevan dengan pagination:

- `q`
- `status`
- `priority`
- `assignee`
- `sort`
- `page`
- `limit`

Response tetap menggunakan shape `TicketPaginationResult<T>`.

### Interaction dengan Fitur Lain

Pagination diterapkan setelah:

- workspace isolation
- search
- status filter
- priority filter
- assignee filter
- sort

Urutan ini menjamin batas halaman dihitung dari hasil akhir yang terurut, bukan dari dataset belum difilter atau belum disortir.

## Edge Cases

### Page Clamping

Jika `page` yang diminta lebih besar dari `totalPages`, service melakukan clamping ke halaman terakhir yang valid (`page = totalPages`) untuk request tersebut.

Pilihan ini menjaga konsistensi dengan pendekatan URL-driven state yang sekarang digunakan. Tanpa state sebelumnya di client, mengharuskan pengguna kembali ke halaman pertama saat filter berubah bisa terasa tidak terprediksi.

Jika di masa depan ingin mengubah behavior ini, pertimbangkan untuk menyimpan page sebelumnya di client state atau mengembalikan page terakhir secara eksplisit.

### Empty Dataset

- `total = 0`
- `totalPages = 1`
- `page = 1`
- UI menampilkan empty state.
- Pagination controls menonaktifkan Previous dan Next.

### Invalid / Negative / Oversized Input

- `page <= 0` → dianggap `1`.
- `limit <= 0` → dianggap `20`.
- `limit > 100` → dianggap `100`.
- Page terlalu besar → dikembalikan ke halaman terakhir yang valid untuk request tersebut.

### Page After Filter Produces Smaller Dataset

Metadata pagination selalu dihitung ulang per request sesuai dataset yang aktif. Jika filter/search membuat dataset lebih kecil, `total`, `totalPages`, dan `hasPreviousPage`/`hasNextPage` menyesuaikan hasil query terbaru.

## Testing Strategy

### Existing Coverage

Test yang sudah ada menutup:

- first page dan last page behavior.
- invalid page handling.
- pagination + search.
- pagination + filters.
- pagination + sort.
- pagination + assignee.
- empty dataset metadata.
- API regression untuk paginated result.

### Focused Edge-Case Tests Added in Task 7

Test baru berfokus pada kasus yang benar-benar belum tercover:

- negative page
- zero page
- invalid page input
- negative limit
- zero limit
- oversized limit
- page exceeds totalPages
- page too high after filter/search reduces dataset

Test tidak menambah duplikasi kombinasi filter/search/sort+pagination yang sudah kuat.

## Acceptance Criteria

- Pagination menggunakan offset/page-number, bukan cursor-based pagination.
- `page` dan `limit` dapat dibaca dari URL dashboard tickets page.
- Pagination metadata `total`, `totalPages`, `hasPreviousPage`, dan `hasNextPage` tersedia di UI dan API.
- Previous dan Next navigation bekerja dan mempertahankan search, status, priority, assignee, dan sort di URL.
- `limit` memiliki guardrail maksimum `100`.
- Invalid, negatif, atau nol `page`/`limit` ditangani dengan nilai aman.
- Page clamping untuk `page > totalPages` menghasilkan halaman terakhir yang valid untuk request tersebut.
- Kombinasi search + filter + sort + assignee + pagination tetap bekerja tanpa regresi.
- Workspace isolation tetap dijunjung pada setiap query paginated.
- Fokus test bertambah untuk genuine edge cases tanpa duplicate coverage.

## Definition of Done

- `docs/phase-4/task-7.md` dibuat dan sesuai dengan implementasi aktual.
- `docs/phase-4/spec.md` bagian Task 7 diselaraskan dengan offset pagination.
- Semua edge-case test baru lulus.
- Tidak ada regresi; `npm run test` tetap lulus.
- `npm run lint`, `npm run typecheck`, dan `npm run build` lulus.
- Tidak ada schema/migration baru.
- Tidak ada perubahan arsitektur pagination menjadi cursor-based.
- Tidak ada commit, push, atau merge.

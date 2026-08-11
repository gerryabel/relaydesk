# Architecture & Implementation Review — Phase 4 Task 7: Pagination

Fokus: audit berbasis repo aktual pada `phase-4/integration-task-1-2-3` HEAD `644dfd1`. Tidak ada implementasi, branch, commit, atau perubahan file.

---

## 1. Current Git State

- Branch: `phase-4/integration-task-1-2-3`
- HEAD: `644dfd1`
- Status: clean
- Konteks: Task 1–6 sudah terintegrasi; lint/test/typecheck/build terakhir lulus (`npm run test` → 177 passed).

---

## 2. Existing Pagination Infrastructure

File: `src/lib/tickets/pagination.ts`

### Yang sudah ada
- Schema validasi: `page` integer positif optional, `limit` integer positif optional, `limit` dibatasi `max(100)`.
- Default eksplisit: `page = 1`, `limit = 20`.
- Result shape sudah ada: `data`, `page`, `limit`, `total`, `totalPages`, `hasPreviousPage`, `hasNextPage`.
- Dipakai konsisten oleh service dan API (`src/lib/tickets/server.ts`, `src/app/api/tickets/search/route.ts`).

### Catatan
- Ketidaksesuaian konseptual kecil: file ini mengasumsikan “pagination sebagai 1-based page number”, bukan cursor token. Itu bukan bug, tapi nanti harus dipertegas di docs/acceptance criteria.
- Tidak ada fungsi khusus untuk “return to first page when page exceeds total” di module ini; logic itu ada di service layer, bukan pagination module.

Kesimpulan: infrastructure dasar pagination offset/limit sudah siap dipakai dan digunakan.

---

## 3. Service Layer Assessment

File: `src/lib/tickets/server.ts`

### `getTickets()`
- Pagination sudah normalisasi lewat `normalizeTicketPagination()`.
- Query final sudah hitung `skip` dan `take`.
- `total` didapat dari `count({ where })`.
- `totalPages` menghitung `Math.max(1, Math.ceil(total / limit))`.
- Page clamping ada: `normalizedPage = Math.min(page, totalPages)`.
- `hasPreviousPage`/`hasNextPage` diderivasi dari `normalizedPage` dan `totalPages`.
- Default sort tetap `createdAt desc` bila `normalizedSort` undefined.
- Workspace isolation lewat `getCurrentMembership()` dan `workspaceId` di `where`.

### Konsistensi `count` vs `findMany`
- Keduanya pakai `where` yang sama.
- Keduanya pakai `include: { createdBy: true }` untuk `findMany`.
- Sudah konsisten.

### Kombinasi fitur
- Filtering + pagination: ada.
- Sorting + pagination: ada.
- Search + pagination: ada, termasuk OR search object form.
- Assignee + pagination: ada.
- Kombinasi multi-filter + search + sort + pagination: ada di kode dan ada test untuk kombinasi tersebut.

### Catatan
- Query `count` dan `findMany` masih menjadi dua query terpisah. Itu sudah sesuai pendekatan offset/limit yang dipilih repo ini, bukan bug.
- `search` object form menghasilkan OR clause; bentuk tersebut diteruskan ke baik `count` maupun `findMany`, jadi metadata pagination tetap konsisten. Tapi ini perlu diingat: OR search dapat mempengaruhi hasil di halaman terakhir lebih drastis daripada pencarian sederhana.

Kesimpulan: service layer cukup kuat dan sudah mendukung pagination + filter/sort/search.

---

## 4. Dashboard/Page Assessment

File: `src/app/dashboard/tickets/page.tsx`

### URL parsing
- `page` dibaca dari URL via `parsePage()`, mendukung `page` dan fallback `p`.
- `limit` dibaca dari URL via `parseLimit()`, mendukung `limit` dan fallback `per_page`.
- Page dilimbahui ke bawah (`Math.floor`) dan positif; invalid -> `1`.
- Limit dilimbahui ke bawah, positif; invalid -> `20`, dibatasi `100`.

### Pagination UI
- Sudah ada prev/next button menggunakan `buildPaginationQuery(resolved, nextPage, result.limit)`.
- UI mempertahankan state filter/search/sort/assignee karena `buildPaginationQuery()` memakai semua `resolved` non-empty.
- Text metadata “Halaman X dari Y • Z tiket” ada.

### Reset page ketika filter/search/sort berubah
- Tidak ada mekanisme reset page secara eksplisit.
- Filtering UI di `TicketFilterControls` melakukan `router.replace(query)` tanpa menyentuh `page`; state pagination dipertahankan.
- Pagination UI mengeksekusi `?page=...` sehingga page tetap benar selama navigasi filter/search/sort yang terjadi via client router.

Kesimpulan: page dan limit dibaca dari URL, pagination UI ada, dan kombinasi state pagination dengan filter/search/sort sudah dipertahankan. Tidak ada lagi gap integrasi pagination di dashboard page.

---

## 5. API Assessment

File: `src/app/api/tickets/search/route.ts`

### Page/limit parsing
- Baca `page`/`limit` dari `searchParams`.
- Dinormalisasi lewat `normalizeTicketPagination()`.
- Validasi terpusat: invalid page/limit diberikan default aman oleh pagination module.

### Kombinasi dengan search/filter/sort
- `status`, `priority`, `assignee` divalidasi sebelum dikirim ke `getTickets`.
- `q` dan `sort` dinormalisasi lewat `normalizeTicketQuery()`.
- Semua parameter digabung menjadi satu panggilan `getTickets(...)`.

### Backward compatibility
- Parameter opsional; tanpa `page`/`limit`, response tetap pakai default pagination.
- Response contract tetap `TicketPaginationResult<T>`.
- Auth boundary tetap: `UnauthorizedError` → 401, `ForbiddenError` → 403, umum 500.

### Catatan kecil
- API saat ini belum punya route test khusus untuk invalid page/negative limit yang berakhir dari query string; tapi itu sudah tercakup cukup oleh module/service tests.

Kesimpulan: API sudah integrasi penuh dengan pagination, validasi, dan kombinasinya. Tidak ada lag.

---

## 6. URL Synchronization Assessment

### Refresh
- State pagination berada di URL, sehingga refresh tetap konsisten.

### Browser navigation
- Pagination via `Link` tanpa `push`/`replace` custom; perubahan page menghasilkan navigasi URL biasa dan bisa dikembali via back/forward browser karena state seluruhnya di query string.

### Kombinasi
- Filter + pagination: dipertahankan oleh `buildPaginationQuery`.
- Search + pagination: dipertahankan.
- Assignee + pagination: dipertahankan.
- Sort + pagination: sudah diperbaiki di Task 6 (`buildResolvedSearchParams` menyertakan `sort`, dan `buildPaginationQuery` mempertahankannya).

Kesimpulan: URL sync untuk pagination dengan semua kombinasi state sudah solid.

---

## 7. Existing Pagination UI Assessment

- Ada prev/next control.
- Tidak ada page number list. Itu bukan gap task ini karena docs Phase 3 Task 4 eksplisit tidak mensyaratkan numbered pagination, dan repo sejak awal memilih small simple UI.
- Tidak ada “go to first/last page”, tidak ada “page size selector UI” di UI; keduanya tidak termasuk dalam scope Task 7 saat ini.

Kesimpulan: UI pagination cukup untuk acceptance criteria yang realistis di repo ini. Jangan tambah UI baru tanpa persetujuan eksplisit.

---

## 8. Existing Test Coverage

### Sudah ada coverage yang relevan untuk pagination
- `src/__tests__/tickets.service.test.ts`
  - `getTickets paginates the first page`
  - `getTickets paginates the last page`
  - `getTickets returns empty data for an invalid page`
  - `getTickets preserves pagination with search and filters`
- `src/__tests__/tickets.filters.test.ts`
  - Kombinasi assignee + pagination
  - Preserving sort + pagination
  - Invalid page beyond total pages -> clamped to first page
  - Limit exceeding max -> rejects
- `src/__tests__/tickets.search.test.ts`
  - `getTickets preserves search with pagination`
- `src/__tests__/tickets.list-states.test.ts`
  - Empty dataset + metadata page 1
  - Non-empty list + page metadata
- `src/__tests__/tickets.page.sort.test.ts`
  - `buildPaginationQuery preserves sort`
- `src/__tests__/tickets.api.regression.test.ts`
  - `GET /api/tickets/search returns sorted paginated results`

### Yang belum ada
- Test spesifik untuk:
  - negative page
  - zero page
  - invalid page di API route
  - negative/zero limit
  - oversized limit
  - page > totalPages after filtered result set changes
  - reset page manually from UI/spec
- Tidak ada test khusus “pagination remains stable under concurrent filter changes”. Untuk server-rendered page ini, race condition sangat kecil, tapi tetap perlu diingat jika nanti dipindah ke client state.

Kesimpulan: ada coverages inti yang kuat; gapnya hanya edge case tests spesifik.

---

## 9. Actual Gaps Found

### Gap 1: Dokumen Task 7 belum dibuat
Tidak ada `docs/phase-4/task-7.md`. Repo ini memakai pola satu dokumen task per task untuk Phase 4.

### Gap 2: Acceptance criteria docs vs implementation mismatch
`docs/phase-4/spec.md` Task 7 menulis:

- Cursor-based pagination
- Next page
- Previous page

Realita repo saat ini:
- Menggunakan offset/limit page-number pagination, bukan cursor.
- Next/previous page UI sudah ada.
- Docs Task 3 Task 4 sudah menetapkan offset/limit sebagai design decision yang sengaja dipilih untuk kemudahan test dan konsistensi.

Ini adalah gap nyata yang perlu ditutup sebelum lanjut Task 7:
- Menyelaraskan acceptance criteria agar berbentuk offset pagination, bukan cursor.
- Atau menentukan apakah Task 7 harus benar-benar mengubah model pagination menjadi cursor. Mengingat scope boundary yang disarankan dan pendekatan repo yang konsisten, perubahan ke cursor bukan bagian dari Task 7 minimal.

### Gap 3: Konsekuensi dari “page clamping”
Saat `page > totalPages`, service mengembalikan `page = 1` dengan hasil kosong. Ini konsisten tapi belum ada dokumen yang menjelaskan behavior eksplisit untuk kasus ini. User bisa mengira mereka “dipindah ke halaman terakhir” bukan “halaman 1”.

### Gap 4: Docs Acceptance Criteria terlalu tipis
Kriteria yang ada cuma 3 poin dan salah satu berbentuk cursor. Ada kebutuhan untuk memperjelas acceptance criteria yang benar-benar relevan untuk offset pagination.

---

## 10. Edge Cases / Risks

| Edge Case | Status | Notes |
|---|---|---|
| Empty dataset | Handled | UI empty state, metadata `total=0`, `totalPages=1`, `page=1`. |
| `page: 0` | Handled | Parsed to `1` in dashboard page; pagination schema requires `positive()`. |
| Negative page | Handled | Same as `page: 0`. |
| Invalid page (string/NaN/Infinity) | Handled | Parsed to `1`. API route falls back to default via `normalizeTicketPagination`. |
| Page too large | Handled with caveat | Clamped to page 1 when > `totalPages`, not to last existing page. Behavior is consistent but should be explicitly documented/agreed. |
| Invalid/negative limit | Handled | Dashboard page: invalid/negative -> 20; API: Zod positive + max 100 -> default 20. |
| Oversized limit | Handled | Hard cap 100. |
| One-page dataset | Handled | Pagination flags `hasPreviousPage=false`, `hasNextPage=false`. |
| Page after filter yields smaller dataset | Handled at runtime | Metadata per-request correct; UI may allow navigation to stale page only because URL isn't auto-reset, but filters already trigger re-render and new `getTickets` call. |

### Risk utama
- Page clamping ke 1 alih-alih last page bisa membuat UX terasa aneh saat user filter dataset menjadi kecil dari posisi page tinggi. Tapi karena ini repo yang memakai server-rendered page dan URL-driven state, tidak ada “langsung kembali ke page sebelumnya” tanpa state tambahan. Jadi pilihan paling konsisten tetap: clamp ke halaman pertama dataset hasil filter.

---

## 11. Proposed Files to Change

| File | Change | Reason |
|---|---|---|
| `docs/phase-4/task-7.md` | Buat dokumen Task 7 | Repo pattern mengharuskan setiap task punya docs. |
| `docs/phase-4/spec.md` | Update Task 7 acceptance criteria | Menyelaraskan dari cursor-based menjadi offset pagination yang sesungguhnya. |
| `src/lib/tickets/pagination.ts` | Tidak usah diubah | Sudah cukup. |
| `src/lib/tickets/server.ts` | Opsional kecil | Tambah komentar/perilaku eksplisit untuk page clamping. |
| `src/app/dashboard/tickets/page.tsx` | Tidak usah diubah | Pagination UI dan URL sync sudah ada. |
| `src/app/api/tickets/search/route.ts` | Tidak usah diubah | Kombinasi pagination + filter/search/sort sudah ada. |
| `src/__tests__/tickets.pagination.test.ts` atau file test terpadu | Tambah edge case tests | Negative/zero page, oversized limit, API invalid page, filtered smaller-dataset clamping behavior. |

Jangan mengusulkan perubahan besar:
- Tidak perlu pagination framework baru.
- Tidak perlu migration/schema baru.
- Tidak perlu redesign UI.
- Tidak perlu refactor besar URL state management.
- Tidak perlu cursor migration kecuali Task 7 benar-benar ingin mengubah arsitektur pagination seluruh repo.

---

## 12. Schema / Migration Impact

Tidak ada schema atau migration baru dibutuhkan untuk Task 7 dalam bentuk offset pagination yang sekarang. Pagination saat ini hanya memakai field yang sudah ada (`skip`/`take` runtime, bukan kolom DB baru).

Jika Task 7 ingin benar-benar beralih ke cursor-based pagination:
- Perlu kolom kursor baru atau kolom order deterministic yang eksplisit.
- Perlu migration.
- Perlu perubahan signifikan di service, API, UI, dan tests.

Saya sarankan itulah bukan scope Task 7 saat ini.

---

## 13. API Contract Impact

Tidak ada breaking change pada API jika Task 7 hanya menyelesaikan gaps dan edge cases.

Contract yang sudah ada dan stabil:
- `GET /api/tickets/search?q=&status=&priority=&assignee=&sort=&page=&limit=`
- Response shape tetap `TicketPaginationResult<T>`.

Risiko perubahan kecil yang perlu diantisipasi:
- Jika kamu memutuskan clamp ke last page bukan page 1, response metadata `page` akan berubah untuk input invalid/large page. Itu adalah perubahan behavior, bukan schema. Tapi karena konsumen internal hanya halaman tickets, risiko kecil.

---

## 14. UI Changes

Tidak ada perubahan UI penting yang dibutuhkan untuk Task 7.

Yang ada saat ini sudah mencukupi:
- Sebelumnya / Berikutnya
- Metadata halaman
- URL state dipertahankan

Tidak ada numbered pagination, tidak ada page-size selector, tidak ada first/last jump. Menambah itu adalah improvement, bukan kebutuhan Task 7.

---

## 15. Scope Boundary

Jangan lakukan dalam Task 7:
- Migrasi ke cursor pagination
- Database/migration baru
- Redesign UI atau numbered pagination
- Refactor besar URL state management
- Fitur di luar pagination seperti infinite scroll, saved preferences, cross-workspace pagination, realtime updates

Fokuskan Task 7 menjadi:
- Audit, dokumentasi, alignment docs vs implementation
- Test gap untuk edge case pagination
- Penetapan eksplisit acceptance criteria offset-based pagination

---

## 16. Implementation Plan

1. **Align acceptance criteria**
   - Update `docs/phase-4/spec.md` Task 7 agar berbentuk offset pagination.
   - Buat `docs/phase-4/task-7.md` berisi objective, scope, architecture changes, behavior contract, edge cases, testing, definition of done.

2. **Add focused test coverage**
   - Tambah test untuk negative page, zero page, invalid page di API.
   - Tambah test untuk invalid/negative/oversized limit.
   - Tambah test untuk page-after-filter-smaller-dataset clamping.
   - Hindari duplicate: jangan ulangi kombinasi search+filter+sort+pagination yang sudah sangat tertutup sekarang.

3. **Optional explicit clamp documentation**
   - Tambahkan komentar singkat di `getTickets()` bahwa oversized page disamakan ke halaman pertama, bukan halaman terakhir.

4. **Verification**
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm run test`

5. **Prepare untuk review**
   - Lapor diff dengan memisahkan perubahan dokumentasi vs perubahan test.

---

## 17. Definition of Done

Untuk Task 7 yang benar-benar realistis berdasarkan repo saat ini:
- `docs/phase-4/task-7.md` dibuat.
- `docs/phase-4/spec.md` Task 7 diselaraskan dengan offset pagination yang sebenarnya.
- Semua edge case tests yang ditambahkan lulus.
- Tidak ada regresi; `npm run test` tetap 177+ passed.
- Tidak ada schema/migration baru.
- Tidak ada perubahan fitur di luar pagination.
- Tidak ada commit/push/merge; audit sudah final dan menunggu approval kamu.

---

## 18. Final Recommendation

### Fakta penting
Pagination di repo ini **tidak lagi kosong**. Sebagian besar celah fungsional sudah ditutup oleh Task 3–6. Saat ini yang benar-benar kurang adalah **dokumentasi Task 7 yang jelas dan tegas**, ditambah **penyelarasan acceptance criteria** agar tidak menyisakan ambiguitas “cursor-based” di `spec.md`.

### Rekomendasi
1. **Tidak usah migrasi ke cursor pagination untuk Task 7.**
   Buktinya: arsitektur repo sudah konsisten pakai offset/limit dan sudah teruji. Cursor bukanlah kebutuhan karena tidak ada indikasi masalah performa atau duplicate/missing data pada offset pagination saat ini.

2. **Lakukan Task 7 sebagai audit + test + documentation closure.**
   Fokus: dokumentasi, edge case tests, dan alignment docs.

3. **Kecuali kamu benar-benar ingin Task 7 menjadi “mengganti model pagination ke cursor”, maka scope berubah besar.**
   Kalau itu yang kamu mau, katakan saja, karena itu butuh rencana terpisah dan bukan Task 7 minimal.

Kalau kamu oke dengan pendekatan di atas, selanjutnya aku bisa lanjut bikin draft `docs/phase-4/task-7.md` dan test gap-nya untuk kamu review sebelum diputuskan mau dilanjutkan atau tidak.

# Phase 4 — Task 6 — Sorting

## Objective

Menutup kesinkronan URL sorting pada halaman dashboard tickets agar:
- state `sort` di URL diteruskan ke `getTickets()`,
- sorting tetap dipertahankan saat pagination dan perubahan filter/search,
- kompatibel dengan filtering dan search API yang sudah ada.

## Scope

- Tambah parsing `sort` di `src/app/dashboard/tickets/page.tsx`.
- Normalisasi `sort` menggunakan modul sorting yang sudah ada (`src/lib/tickets/sort.ts`).
- Teruskan `sort` ke `getTickets()`.
- Pertahankan `sort` di query builder untuk pagination dan active-filter chips.
- Tambah regression test untuk URL sync dan kombinasi sort + filter/search + pagination.

## Implementation Summary

### Dashboard Page

- `src/app/dashboard/tickets/page.tsx`
  - Tambah `parseSort()` untuk membaca dan menormalisasi `sort` dari URL dengan `normalizeTicketSort()`.
  - Teruskan `sort` ke `getTickets()`.
  - Sertakan `sort` dalam `buildResolvedSearchParams()` agar active-filter-chip reset dan pagination tetap mempertahankan sorting.

### Sorting Module

- Tidak diubah. `src/lib/tickets/sort.ts` tetap menjadi sumber kebenaran untuk:
  - field: `createdAt`, `updatedAt`, `title`, `priority`, `status`
  - direction: `asc`, `desc`
  - fallback ke `createdAt desc` ketika `sort` tidak valid/undefined

### Search API

- Tidak diubah. `src/app/api/tickets/search/route.ts` tetap meneruskan `sort` ke `getTickets()`.

### UI Control

- Tidak diubah. `TicketSortControls` tetap menulis `?sort=<field>:<direction>`.

## Database / Schema Impact

Tidak ada schema atau migration baru.

## API Changes

Tidak ada perubahan API.

Semua perubahan terpusat di server-rendered dashboard page untuk meneruskan state `sort` dari URL ke service layer.

## UI Changes

Tidak ada perubahan komponen UI.

Perubahan hanya pada wiring URL ↔ server data fetching di dashboard tickets page.

## Testing

### Coverage Added

- `src/__tests__/tickets.page.sort.test.ts`
  - `parseSort` menerima `priority:asc` dari URL dan menghasilkan `{ field: 'priority', direction: 'asc' }`
  - `parseSort` mengabaikan sort tidak valid dan mengembalikan `undefined`
  - `parseSort` mengabaikan blank string
  - `buildResolvedSearchParams` mempertahankan `sort` bersamaan filter lain
  - `buildPaginationQuery` mempertahankan `sort` saat navigasi halaman
  - `getTickets` menerapkan sort ketika dipanggil dari state URL yang valid
  - `getTickets` fallback ke default sort ketika URL tidak menyertakan `sort`
  - `parseFilters` tetap kompatibel ketika `sort` ada di resolved params

## Verification

```text
npm run lint      → PASS
npm run typecheck → PASS
npm run build     → PASS
npm run test      → PASS
git diff --check  → PASS
```

## Design Decisions

- Menggunakan parser `sort` khusus di page module karena URL menyediakan `sort` sebagai string `field:direction`, berbeda dengan API yang menerima string mentah dan menyerahkan normalisasi ke `search` module.
- Tidak mengubah `TicketSortControls` karena perilaku penulisan URL sudah benar.
- Tidak menambahkan state/global store baru agar tetap sederhana dan sesuai arsitektur URL-driven state saat ini.

## Trade-offs

- Hanya mendukung format `field:direction` dari URL. Jika `TicketSortControls` mengirim format lain, parser bisa perlu diperluas.
- Label tampilan sort tidak ditambahkan; fokus halaman ini hanya memastikan data terurut.

## Scope Boundary

Tidak termasuk Task 6:

- Default sort berbasis preference user
- Multi-sort / secondary sort
- Saved sort state
- Perubahan schema/migration
- Modifikasi `TicketSortControls`
- Perubahan search API atau service layer sorting

## Definition of Done

- [x] URL `sort` dibaca dan dinormalisasi di dashboard tickets page.
- [x] `sort` diteruskan ke `getTickets()`.
- [x] `sort` tetap ada saat pagination dan perubahan query/filter.
- [x] Tetap kompatibel dengan search, status, priority, assignee filters, dan pagination.
- [x] Tidak ada schema/migration baru.
- [x] Test regression untuk URL sync dan kombinasi filter/pagination ditambahkan.
- [x] Lint, typecheck, build, dan test lulus.
- [x] Dokumentasi Task 6 ditambahkan.

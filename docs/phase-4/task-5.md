# Phase 4 — Task 5 — Filtering

## Objective

Menambahkan assignee filtering ke daftar tiket tanpa mengubah schema/migration atau merombak filtering status/priority yang sudah ada.

## Scope

- Filter daftar tiket berdasarkan assignee (`assignedToId`) pada halaman dashboard tickets.
- Sinkronisasi state assignee ke URL.
- Kompatibilitas dengan search, sorting, pagination, dan active filter chips.
- Dokumentasi implementasi aktual dan hasil pengujian.

## Implementation Summary

### Service Layer

- `src/lib/tickets/server.ts`
  - Menambah `assignee?: string | undefined` ke `TicketGetOptions`.
  - Menambah `assignee?: AssigneeFilter` ke `buildTicketWhere`.
  - Query builder menambahkan `...(assignee ? { assignedToId: assignee } : {})` sambil tetap menjaga `workspaceId` isolation dan AND semantics bersama `status`, `priority`, dan search.

### Schema / Validation

- `src/lib/tickets/schema.ts`
  - Menambah `ticketAssigneeFilterSchema`.
  - Menambah `assignee` opsional ke `ticketFiltersSchema`.
  - Validasi tetap type-safe dan konsisten dengan pola filter yang sudah ada.

### Dashboard Page

- `src/app/dashboard/tickets/page.tsx`
  - Parse `assignee` dari URL dengan `ticketAssigneeFilterSchema`.
  - Teruskan `assignee` ke `getTickets()`.
  - Tampilkan active filter chip untuk assignee.
  - Sertakan `assignee` dalam resolved search params agar pagination dan reset filter tetap konsisten.
  - Pre-fetch `members` workspace untuk kebutuhan filter control.

### Filter Controls

- `src/components/tickets/ticket-filters.tsx`
  - Tambah select Assignee.
  - Isi opsi dari workspace members yang diterima via props.
  - Sinkronisasi perubahan assignee ke URL query params.
  - Tidak menambah state "Unassigned".

### Search API

- `src/app/api/tickets/search/route.ts`
  - Terima query param opsional `assignee`.
  - Validasi dengan `ticketAssigneeFilterSchema`.
  - Teruskan ke `getTickets({ assignee })`.
  - Response contract tetap `TicketPaginationResult<T>`.

## Database / Schema Impact

Tidak ada schema atau migration baru.

- `Ticket.assignedToId` dan relasi `assignedTo` sudah tersedia sejak Task 1.
- Filtering hanya memakai field yang sudah ada.
- Workspace isolation tetap dijamin oleh `workspaceId` + `getCurrentMembership()`.

## API Changes

- `GET /api/tickets/search` menerima query param opsional `assignee`.
- Backward compatible: tanpa `assignee`, behavior sama persis.
- Tidak ada perubahan pada response shape atau endpoint lain.

## UI Changes

- Tambah satu kontrol select Assignee di filter bar.
- Tambah active filter chip untuk assignee.
- State assignee tetap tersimpan di URL dan ikut dipertahankan saat pagination/sort/search berubah.

## Testing

### Pattern

 melanjutkan pola query-construction/mocking tests yang sudah ada:
  - `getCurrentMembership` di-mock.
  - Prisma `findMany`/`count` di-spy.
  - Assertions pada `where`, `include`, `orderBy`, `skip`, `take`.

### Coverage Added

| Test | Regression protected |
|---|---|
| `getTickets filters by assignee only` | Prisma where menyertakan `assignedToId` |
| `getTickets combines status and assignee filters` | AND semantics status + assignee |
| `getTickets combines priority and assignee filters` | AND semantics priority + assignee |
| `getTickets combines status, priority, and assignee filters` | AND semantics tiga filter |
| `getTickets combines search and assignee filters` | workspace + assignee + title search |
| `getTickets preserves assignee filter with sorting` | `orderBy` tetap benar |
| `getTickets preserves assignee filter with pagination` | `skip`/`take` tetap benar |
| `parseFilters preserves assignee alongside valid filters` | URL parsing assignee |
| `parseFilters preserves valid fields when one query parameter is invalid` | partial invalid + assignee |
| `parseFilters returns empty filters when all query parameters are invalid` | all invalid + assignee |
| `getTickets rejects invalid assignee value` | invalid assignee throws |
| `ticketAssigneeFilterSchema accepts valid assignee` | validasi schema |
| `ticketAssigneeFilterSchema rejects blank assignee` | validasi schema |

## Verification

```text
npm run lint      → PASS
npm run typecheck → PASS
npm run build     → PASS
npm run test      → PASS
git diff --check  → PASS
```

## Design Decisions

- Menggunakan `assignedToId` langsung sebagai filter agar tetap sederhana dan aman.
- Tidak menambah filter "Unassigned" karena belum menjadi bagian eksplisit dari scope Task 5.
- Tidak memindahkan data member lewat API baru; memakai `getWorkspaceMembers()` yang sudah ada.
- Tidak mengubah struktur URL state management yang sekarang sudah berfungsi.

## Trade-offs

- Filter assignee berbasis ID dari URL; tidak ada validasi bahwa ID tersebut memang member workspace pada layer routing. Workspace isolation tetap dijunjung oleh `workspaceId`.
- Label active filter chip assignee menampilkan ID mentah; jika nanti ingin label nama assignee, bisa dilakukan terpisah tanpa mengubah query behavior.

## Scope Boundary

Tidak termasuk Task 5:

- Saved filters/presets
- Unassigned filter
- Advanced filter builder
- Autocomplete/search history
- Schema/migration baru
- Perubahan endpoint selain `assignee` pada search API
- Refactor besar URL state management

## Definition of Done

- [x] Assignee filter bekerja di UI dan API.
- [x] Kombinasi assignee dengan status, priority, search, sort, dan pagination berjalan.
- [x] URL menyimpan state assignee.
- [x] Active filter chips menampilkan assignee.
- [x] Workspace isolation tetap terjaga.
- [x] Tidak ada schema/migration baru.
- [x] TestTask 5 ditambahkan dan lulus.
- [x] Lint, typecheck, build lulus.
- [x] Dokumentasi Task 5 ditambahkan.

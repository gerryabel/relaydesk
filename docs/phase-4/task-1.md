# Phase 4 — Task 1 — Ticket Assignment

## Objective

Menambahkan kemampuan assign dan unassign ticket kepada member workspace yang valid, sekaligus menyediakan antarmuka server-side dan UI agar assignment bisa dilakukan secara langsung dari aplikasi.

## Scope

- Menambah skema validasi untuk input assignment dan unassignment.
- Memperluas service ticket untuk mengupdate `assignedToId` dengan validasi membership workspace.
- Menambahkan Server Actions untuk assign dan unassign ticket.
- Menambahkan REST API endpoint untuk assign dan unassign ticket.
- Memperbarui UI detail ticket agar menampilkan assignee dan menyediakan kontrol assign/unassign.
- Menjaga isolasi workspace dan auth behavior yang sudah ada di codebase.
- Menambahkan test untuk jalur baru assignment.

## Non-Goals

- Mengubah model atau role workspace.
- Menambahkan notifikasi atau realtime update.
- Mengubah scope Task 2–Task 8.
- Menambahkan fitur mass assignment atau bulk reassign.

## Implementation Summary

### Database & Migration

- Ditambahkan kolom `assignedToId` pada model `Ticket` sebagai foreign key nullable ke `User(id)`.
- Relasi ditambahkan: `assignedTo User? @relation("TicketAssignee", ...)` di `Ticket`, dan inverse relation di `User`.
- Migration dibuat secara manual dengan foreign key `ON DELETE SET NULL` agar assignee terhapus secara aman.
- Migration bersifat backward compatible karena `assignedToId` bersifat nullable dan tidak mengubah struktur data yang ada.

### Validation

- Ditambahkan `assignTicketSchema` untuk validasi payload assign.
- Ditambahkan `unassignTicketSchema` untuk operasi unassign.
- Ditambahkan domain error baru: `AssigneeNotInWorkspaceError`.

### Service Layer

- Ditambahkan `assignTicket(id, input)`:
  - Validasi input assignment
  - Verifikasi membership aktif
  - Verifikasi ticket berada di workspace yang sama
  - Verifikasi assignee merupakan member workspace
  - Update `assignedToId` dan return ticket lengkap dengan relasi `createdBy` dan `assignedTo`
- Ditambahkan `unassignTicket(id)`:
  - Verifikasi membership aktif
  - Verifikasi ticket berada di workspace
  - Set `assignedToId = null` dan return ticket terbaru

### Server Actions

- Ditambahkan `assignTicketAction(id, input)`:
  - Validasi membership, input, dan service layer
  - Revalidasi path: `/dashboard/tickets` dan `/dashboard/tickets/[id]`
- Ditambahkan `unassignTicketAction(id)`:
  - Validasi membership dan service layer
  - Revalidasi path yang sama

### API

- Dibuat endpoint baru: `PATCH /api/tickets/[id]/assignment`
- Ditambahkan handler `DELETE` pada endpoint yang sama untuk unassign
- Contract:
  - `PATCH`: menerima body `{ "assigneeId": "string" }`, mengembalikan ticket terbaru
  - `DELETE`: tanpa body, mengembalikan ticket terbaru dengan `assignedToId: null`
- Error handling konsisten dengan API lain:
  - `401` Unauthorized
  - `403` Forbidden
  - `404` Not Found
  - `400` untuk validation error atau assignee bukan member

### UI

- Komponen baru: `AssignTicketForm` di halaman detail ticket
- Menampilkan "Belum diassign" empty state dengan dropdown member dan tombol Assign
- Menampilkan nama assignee dengan tombol Unassign jika sudah diassign
- Menggunakan `useTransition()` untuk loading state
- Menampilkan error inline jika terjadi kegagalan

### Architecture Changes

- Perluasan model Prisma dengan relasi baru `TicketAssignee`
- Penambahan service functions baru tanpa mengubah signature service yang ada
- API endpoint baru terpisah dari `PATCH /api/tickets/[id]` agar assignment menjadi operasi domain yang jelas
- Type `TicketWithCreator` diperluas dengan field opsional `assignedTo`

### Migration Notes

- Migration: `20250807203000_add_ticket_assignee`
- SQL migration menambahkan kolom `assignedToId TEXT NULL`, unique index, dan foreign key ke `User(id)` dengan `ON DELETE SET NULL`
- Migration aman dijalankan di production karena kolom baru bersifat nullable

### Testing Results

Semua test berhasil lulus:

- `src/__tests__/ticket-assignment.service.test.ts`: 7 tests covering assign/unassign, membership validation, workspace isolation, idempotency, and regression.
- `src/__tests__/ticket-assignment.api.test.ts`: 10 tests covering PATCH/DELETE endpoints, success cases, validation errors, authorization, forbidden, not found, and assignee non-member.
- `src/__tests__/ticket-creation.validation.test.ts`: 6 tests
- `src/__tests__/tickets.service.test.ts`: 25 tests
- `src/__tests__/tickets.list-states.test.ts`: 10 tests
- `src/__tests__/ticket-detail-api.auth.test.ts`: 5 tests
- `src/__tests__/tickets.api.regression.test.ts`: 7 tests
- `src/__tests__/tickets.filters.test.ts`: 29 tests
- `src/__tests__/tickets.search.test.ts`: 12 tests
- `src/__tests__/smoke.test.ts`: 1 test
- `src/__tests__/provisioning.test.ts`: 2 tests

Total: 116 tests passed, 0 failed.

### Verification

- `npm run lint`: ✅ passed
- `npm run typecheck`: ✅ passed
- `npm run build`: ✅ passed
- `npm run test`: ✅ 116 passed

### Known Limitations

- Tidak ada notifikasi realtime saat ticket di-assign.
- Tidak ada mass assignment atau bulk reassign.
- Tidak ada audit log untuk perubahan assignment.
- Assignee hanya bisa berupa satu user (bukan multiple assignee).

### Deliverables Checklist

- [x] Update skema validasi input ticket assignment.
- [x] Update `src/lib/tickets/server.ts` untuk logika assign/unassign.
- [x] Update `src/lib/tickets/actions.ts` dengan Server Actions assignment.
- [x] Tambah REST API endpoint `PATCH /api/tickets/[id]/assignment` dengan handler DELETE.
- [x] Update `src/app/dashboard/tickets/[id]/page.tsx` untuk UI assignment.
- [x] Update atau tambah test untuk behavior assignment baru.
- [x] Dokumentasi diperbarui dalam file ini.

## Acceptance Criteria

- [x] Hanya member workspace yang dapat menjadi assignee.
- [x] Ticket dapat diassign kepada member workspace.
- [x] Ticket dapat di-unassign.
- [x] Request tanpa autentikasi atau tanpa membership ditolak dengan response yang sesuai.
- [x] UI detail ticket langsung menampilkan perubahan assignment.
- [x] API dan Server Actions mengembalikan ticket terbaru setelah assignment berhasil.
- [x] Tidak terjadi regresi pada endpoint ticket existing.

## Definition of Done

- [x] Semua acceptance criteria terpenuhi.
- [x] `npm run lint` lulus tanpa error dan warning baru.
- [x] `npm run typecheck` lulus.
- [x] `npm run build` lulus.
- [x] `npm run test` lulus.
- [x] Tidak ada regresi pada fitur ticket yang ada.
- [ ] Branch untuk Task 1 sudah dilakukan commit dan push sesuai workflow repo. — menunggu review sebelum git berikutnya.
- [x] Dokumentasi diperbarui sesuai bagian Documentation Requirements.

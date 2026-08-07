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

## Deliverables

- Update skema validasi input ticket assignment.
- Update `src/lib/tickets/server.ts` untuk logika assign/unassign.
- Update `src/lib/tickets/actions.ts` dengan Server Actions assignment.
- Update `src/app/api/tickets/[id]/route.ts` agar mendukung assign/unassign.
- Update `src/app/dashboard/tickets/[id]/page.tsx` untuk UI assignment.
- Update atau tambah test untuk behavior assignment baru.
- Dokumentasi perubahan dalam dokumen task ini.

## Technical Notes

- Gunakan pola yang sudah ada pada `updateTicket` dan `closeTicket` sebagai acuan struktur auth, revalidation, dan error handling.
- Validasi assignee harus melalui membership aktif di workspace yang sama dengan ticket; gunakan `getCurrentMembership()` sebagai dasar, lalu verifikasi bahwa target user juga merupakan member workspace.
- Pertimbangkan untuk meneruskan `assignedToId` nullable; `null` sebagai representasi unassign.
- Pertahankan revalidation path yang relevan: `/dashboard/tickets`, `/dashboard/tickets/{id}`, dan API route terkait jika ada caching downstream.
- Pertimbangkan apakah response API assignment perlu menyertakan data ticket lengkap agar konsisten dengan `getTicketById`.

## Acceptance Criteria

- Hanya member workspace yang dapat menjadi assignee.
- Ticket dapat diassign kepada member workspace.
- Ticket dapat di-unassign.
- Request tanpa autentikasi atau tanpa membership ditolak dengan response yang sesuai.
- UI detail ticket langsung menampilkan perubahan assignment.
- API dan Server Actions mengembalikan ticket terbaru setelah assignment berhasil.
- Tidak terjadi regresi pada endpoint ticket existing.

## Testing Requirements

- Unit test untuk validasi schema assignment input.
- Unit test untuk service assign dan unassign, termasuk:
  - assign ke member workspace yang valid,
  - reject assignee non-member,
  - unassign mengembalikan `assignedToId` menjadi `null`,
  - workspace isolation tetap terjaga.
- Integration test untuk API `PATCH /api/tickets/[id]` dengan field assignment.
- Authorization test untuk request tanpa session atau tanpa membership.
- Regression test untuk listing, detail, dan update ticket yang ada.
- Jalankan `npm run lint`, `npm run typecheck`, `npm run build`, dan `npm run test` setelah perubahan.

## Documentation Requirements

- Perbarui `docs/phase-4/task-1.md` dengan ringkasan perubahan setelah implementasi.
- Dokumentasikan perubahan API di bagian `docs/phase-4/spec.md` Task 1 sebagai referensi implementasi, tanpa mengubah konten `spec.md` itu sendiri jika tidak diizinkan; jika perlu, catat perubahan API di file task ini.
- Catat komponen UI yang berubah dan alasan desain singkat.

## Definition of Done

- Semua acceptance criteria terpenuhi.
- `npm run lint` lulus tanpa error dan warning baru.
- `npm run typecheck` lulus.
- `npm run build` lulus.
- `npm run test` lulus.
- Tidak ada regresi pada fitur ticket yang ada.
- Branch untuk Task 1 sudah dilakukan commit dan push sesuai workflow repo.
- Dokumentasi diperbarui sesuai bagian Documentation Requirements.

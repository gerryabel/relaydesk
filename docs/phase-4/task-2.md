# Phase 4 — Task 2 — Ticket Workflow

## Overview

Task 2 menambahkan workflow status ticket yang eksplisit dan terstruktur, menggantikan perubahan status bebas menjadi transisi yang tervalidasi agar data ticket lebih konsisten dan mudah dilacak.

Workflow mengenalkan status:

* Open
* In Progress
* Waiting Customer
* Resolved
* Closed

Semua perubahan status melewati validasi transisi terpusat di domain layer.

## Scope

- Menetapkan 5 status ticket.
- Menegakkan aturan transisi status yang valid sesuai final transition matrix.
- Menolak transisi yang tidak valid.
- Memastikan workflow berlaku di API maupun UI.
- Memperbarui dokumentasi, skema validasi, service layer, Server Actions, REST API, dan komponen UI terkait status.
- Menambahkan `waiting_customer` ke Prisma `TicketStatus` enum dan melakukan migration additive.

## Non-Goals

- Role-based workflow.
- Notifikasi, realtime update, atau automation rule.
- Mass transition atau bulk update.
- Mengubah scope Task 3–Task 8.

## Final Transition Matrix

| From             | To               | Allowed |
| ---------------- | ---------------- | ------- |
| Open             | In Progress      | ✅       |
| Open             | Waiting Customer | ❌       |
| Open             | Resolved         | ❌       |
| Open             | Closed           | ❌       |
| In Progress      | Waiting Customer | ✅       |
| In Progress      | Resolved         | ✅       |
| In Progress      | Closed           | ❌       |
| Waiting Customer | In Progress      | ✅       |
| Waiting Customer | Resolved         | ✅       |
| Waiting Customer | Closed           | ❌       |
| Resolved         | In Progress      | ✅       |
| Resolved         | Waiting Customer | ❌       |
| Resolved         | Closed           | ✅       |
| Closed           | In Progress      | ❌       |
| Closed           | Waiting Customer | ❌       |
| Closed           | Resolved         | ❌       |
| Closed           | Closed           | ❌       |

### Semantic Rules

- `Closed` adalah terminal state.
- `Resolved → Closed` diperbolehkan.
- `Resolved → In Progress` diperbolehkan sebagai reopen.
- `Resolved → Waiting Customer` tidak diperbolehkan.
- `Open → Waiting Customer` tidak diperbolehkan.
- Tidak ada auto-transition.
- Same-status transition ditolak.

### Error Semantics

- `400 Bad Request`: invalid payload atau nilai status yang tidak valid menurut enum/schema.
- `409 Conflict`: transisi yang valid menurut enum, tetapi tidak diizinkan dari current state.

## Actual Implementation Architecture

```text
UI
 ↓
Server Action / API
 ↓
Ticket Service
 ↓
Workflow Validation
 ↓
Prisma
 ↓
PostgreSQL
```

Single source of truth untuk transition rules berada di:

`src/lib/tickets/workflow.ts`

Fungsi utama:

- `getAllowedTransitions(status)` — mengembalikan daftar transisi yang valid dari suatu status.
- `assertTransitionAllowed(current, next)` — memvalidasi satu transisi dan melempar error jika tidak diizinkan.
- `InvalidTicketTransitionError` — domain error yang menyimpan `current`, `requested`, dan `message`.

### Separation

```text
Schema validation
    ≠
Workflow validation
```

- Schema menentukan apakah nilai status valid.
- Workflow menentukan apakah transisi dari current status ke requested status diizinkan.

## Database

- `TicketStatus` mendapat `waiting_customer`.
- Migration: `20260808120000_add_waiting_customer_status`
- Migration bersifat additive.
- Tidak ada destructive change.
- Tidak ada backfill.
- Existing records tetap valid.
- Default status tetap `open`.

## API

### `PATCH /api/tickets/[id]`

- malformed/invalid status → `400 Bad Request`
- valid status tetapi invalid transition → `409 Conflict`
- authorization tetap berlaku
- service layer tetap menjadi tempat workflow enforcement
- response success mengembalikan ticket hasil update

## Server Actions

- `updateTicketAction(id, input)`
- `closeTicketAction(id)`

Keduanya:

- menggunakan service/workflow validation
- melakukan workspace membership check
- merevalidasi input dengan schema
- merevalidasi transisi via service/workflow
- merefresh path setelah sukses
- mengembalikan `{ success, error }` sesuai convention

Server Actions tidak menggunakan HTTP 400/409 semantics; error diikuti sesuai action convention.

## UI

### Ticket Card

- menampilkan status `waiting_customer` sebagai `Waiting Customer`.
- tone visual konsisten dengan status badge lain: `amber`.
- tidak menyebabkan fallback/error untuk status baru.

### Ticket Transition Form

- menerima current ticket state.
- menampilkan hanya transisi valid dari `getAllowedTransitions(currentStatus)`.
- menyediakan tombol aksi transisi berbasis context/from→to.
- memiliki loading state selama proses transisi.
- disabled state mencegah duplicate submission.
- error handling mengikuti existing action behavior.

### Edit Ticket Form

- status tidak lagi berupa arbitrary full dropdown.
- current status tetap tersedia sebagai opsi.
- hanya transisi valid dari current status yang ditampilkan sebagai pilihan.
- submit tetap melalui `updateTicketAction` sehingga server tetap menjadi source of truth.

### Ticket Detail

- menampilkan workflow actions berdasarkan current state.
- `Closed` tidak menampilkan workflow action.
- transisi labels:
  - `In Progress → Waiting Customer`: Waiting Customer
  - `In Progress → Resolved`: Resolve
  - `Waiting Customer → In Progress`: Resume Work
  - `Waiting Customer → Resolved`: Resolve
  - `Resolved → In Progress`: Reopen
  - `Resolved → Closed`: Close

## Accessibility

- Menggunakan semantic button/select sesuai existing UI.
- kontrol transisi tetap bisa diakses via keyboard.
- accessible name jelas pada tombol transisi.
- focus indicator tetap terlihat karena menggunakan komponen UI yang ada.
- loading/disabled state dapat dipahami.
- error feedback ditampilkan dalam bentuk teks yang jelas.
- tidak mengandalkan warna saja untuk membedakan status.

## Responsive

- workflow controls menggunakan `flex flex-wrap gap-2`.
- tombol transisi membungkus secara responsif.
- tidak menyebabkan horizontal overflow.
- tetap usable pada desktop, tablet, dan mobile.

## Testing

### Coverage

- workflow transition tests.
- same-status rejection test.
- invalid transition rejection test.
- API authorization regression tests.
- API `409` invalid transition.
- Server Action invalid transition handling.
- existing regression suite tetap lulus.

### Actual Result

```text
126 tests passed
0 failed
```

## Verification

```text
npm run test      → PASS
npm run lint      → PASS
npm run typecheck → PASS
npm run build     → PASS
```

## Actual File Changes

Files yang benar-benar berubah untuk Task 2:

- `src/lib/tickets/workflow.ts`
- `src/lib/tickets/schema.ts`
- `src/lib/tickets/server.ts`
- `src/lib/tickets/actions.ts`
- `src/app/api/tickets/[id]/route.ts`
- `src/components/tickets/ticket-card.tsx`
- `src/components/tickets/ticket-transition-form.tsx`
- `src/components/tickets/edit-ticket-form.tsx`
- `src/app/dashboard/tickets/[id]/page.tsx`
- `prisma/schema.prisma`
- `prisma/migrations/20260808120000_add_waiting_customer_status/`
- `src/__tests__/ticket-workflow.service.test.ts`
- `src/__tests__/tickets.actions.test.ts`
- `src/__tests__/ticket-detail-api.auth.test.ts`
- `src/__tests__/tickets.api.regression.test.ts`
- `src/__tests__/tickets.service.test.ts`

## Definition of Done

### Acceptance Criteria

- [x] Valid ticket transitions enforced
- [x] Invalid transitions rejected
- [x] Workflow available through UI
- [x] Workflow available through API
- [x] `waiting_customer` supported
- [x] Authorization maintained

### Quality

- [x] Tests pass
- [x] Lint passes with 0 errors/warnings
- [x] Typecheck passes
- [x] Build passes
- [x] No regression

### UI

- [x] Responsive
- [x] Accessible
- [x] Loading states
- [x] Error states

### Documentation

- [x] Task 2 documentation updated
- [x] Architecture documented
- [x] Database changes documented
- [x] API documented
- [x] UI documented
- [x] Testing documented

### Git

- [x] Correct branch
- [x] No unrelated changes
- [x] No commit yet
- [x] No push yet

## Lessons Learned

### Workflow domain separation

Transition rules lebih aman ketika dipusatkan di domain layer. UI hanya memetakan transisi yang tersedia; server tetap menegakkan aturan.

### Service as source of truth

API/UI tidak boleh menjadi enforcement layer utama. Validasi workflow di service layer mencegah bypass dari jalur eksekusi yang berbeda.

### Test mocks must follow architecture

Saat service boundary berubah, test mocks yang masih mengandalkan implementation detail lama akan menjadi source of failure. Update mock harus mengikuti boundary aktual, bukan memaksa production code kembali ke pola lama.

### Zod version compatibility

Jangan bergantung pada private/internal Zod properties seperti `_def.values` tanpa memastikan compatibility versi yang digunakan. Implementasi status validasi route tetap stabil dengan daftar nilai eksplisit yang diselaraskan dengan schema domain.

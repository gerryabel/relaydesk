# Phase 4 — Ticket Workflow & Management

Version: 0.3.0-alpha

---

## Overview

Phase 4 berfokus pada peningkatan RelayDesk dari aplikasi CRUD ticket menjadi sistem helpdesk dengan workflow yang dapat digunakan oleh tim support.

Fitur pada fase ini memperkenalkan assignment, workflow status, pencarian, filtering, sorting, pagination, dan activity timeline agar pengelolaan ticket menjadi lebih efisien dan scalable.

---

# Goals

* Mendukung assignment ticket kepada staff.
* Menambahkan workflow status yang jelas.
* Mempermudah pencarian ticket.
* Menyediakan filtering dan sorting.
* Mendukung pagination untuk data dalam jumlah besar.
* Menyimpan riwayat perubahan ticket.
* Menjaga kualitas codebase dengan testing dan dokumentasi.

---

# Deliverables

## Task 1 — Ticket Assignment

### Scope

* Assign ticket kepada member workspace.
* Unassign ticket.
* Validasi membership workspace.
* Server Actions.
* REST API.
* UI assignment.

### Acceptance Criteria

* Hanya member workspace yang dapat menjadi assignee.
* Ticket dapat diassign dan di-unassign.
* Unauthorized request ditolak.
* UI langsung merefleksikan perubahan.

---

## Task 2 — Ticket Workflow

### Scope

Menambahkan workflow status:

* Open
* In Progress
* Waiting Customer
* Resolved
* Closed

### Acceptance Criteria

* Status mengikuti transition yang valid.
* Invalid transition ditolak.
* Workflow digunakan pada UI maupun API.

---

## Task 3 — Priority & SLA

### Scope

* Edit priority.
* Due date.
* SLA indicator.

### Acceptance Criteria

* Priority dapat diubah.
* Due date tervalidasi.
* SLA tampil pada detail ticket.

---

## Task 4 — Search

### Scope

Pencarian berdasarkan:

* Title
* Description
* Creator
* Assignee

### Acceptance Criteria

* Search bersifat case-insensitive.
* Search mendukung partial match.
* Response tetap cepat pada jumlah data besar.

---

## Task 5 — Filtering

### Scope

Filter berdasarkan:

* Status
* Priority
* Assignee

### Acceptance Criteria

* Filter dapat digabungkan.
* URL menyimpan state filter.
* Filter bekerja pada UI dan API.

---

## Task 6 — Sorting

### Scope

Sorting berdasarkan:

* Created At
* Updated At
* Priority
* Status

### Acceptance Criteria

* Ascending dan descending didukung.
* Sorting konsisten pada API dan UI.

---

## Task 7 — Pagination

### Scope

* Cursor-based pagination.
* Next page.
* Previous page.

### Acceptance Criteria

* Pagination stabil.
* Tidak ada duplicate maupun missing data.
* Search, filter, dan sorting tetap kompatibel.

---

## Task 8 — Activity Timeline

### Scope

Mencatat aktivitas ticket seperti:

* Ticket dibuat.
* Ticket diassign.
* Ticket di-unassign.
* Status berubah.
* Priority berubah.
* Due date berubah.
* Comment ditambahkan.

### Acceptance Criteria

* Seluruh aktivitas penting tercatat.
* Timeline tampil secara kronologis.
* Timestamp akurat.
* Actor tercatat dengan benar.

---

# Non-Goals

Fitur berikut tidak termasuk dalam Phase 4:

* File attachments.
* Email notifications.
* Push notifications.
* Realtime updates.
* Multi-workspace switcher.
* Invite member.
* Dashboard analytics.
* AI features.
* Public ticket portal.

---

# Testing Requirements

* Unit Test.
* Integration Test.
* Authorization Test.
* Regression Test.
* API Test.
* Validation Test.

---

# Documentation

Setiap task wajib memiliki dokumentasi tersendiri yang menjelaskan:

* Perubahan arsitektur.
* Perubahan database.
* API yang ditambahkan.
* Komponen UI baru.
* Pertimbangan desain.
* Hasil pengujian.

---

# Definition of Done

Setiap task dianggap selesai apabila:

* Seluruh acceptance criteria terpenuhi.
* Lint tanpa error maupun warning.
* Typecheck berhasil.
* Build berhasil.
* Seluruh test lulus.
* Dokumentasi diperbarui.
* UI responsive.
* Accessibility tetap terjaga.
* Tidak terdapat regression.
* Branch telah di-commit dan di-push.

---

# Expected Outcome

Setelah Phase 4 selesai, RelayDesk mampu:

* Mengelola assignment ticket.
* Menjalankan workflow ticket.
* Melakukan search, filter, sorting, dan pagination.
* Menampilkan riwayat aktivitas ticket.
* Memberikan pengalaman penggunaan yang lebih menyerupai helpdesk modern dibanding sekadar aplikasi CRUD.

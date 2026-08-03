# RelayDesk Development Workflow

Version: 1.0
Introduced during Phase 2 Task 6 (v0.2.0-alpha)

This document defines the engineering workflow used throughout the RelayDesk project.

Every implementation task must follow this workflow.

---

# Branch Strategy

- One task = one branch.
- Branches must be created from the latest completed task.
- Branch names follow:

phase-{phase}/task-{number}-{short-description}

Examples:

phase-2/task-5-ticket-services
phase-2/task-6-ticket-ui

---

# Definition of Done (DoD)

A task is **NOT** complete until every item below has been satisfied.

## 🌿 Git

- Dedicated branch created.
- Branch contains only task-related changes.
- Working tree is clean before completion.

---

## 💻 Implementation

- Scope fully implemented.
- No scope creep.
- No unnecessary abstraction.
- No new technical debt introduced.

---

## 🏗 Architecture

- Layering remains correct.
- No duplicated business logic.
- Services remain reusable.
- Prisma access stays centralized.
- Naming is consistent.
- Dead code removed.

---

## 🎨 UI (when applicable)

- Consistent layout.
- Hallmark design direction maintained.
- Reusable components preferred.
- Responsive.
- Accessible.

---

## 🧪 Verification

All commands must pass.

- npm run lint (0 errors, 0 warnings)
- npm run typecheck
- npm run build
- npm run test

---

## 📝 Documentation

Each completed task must include:

docs/phase-x-task-y.md

Including:

- Overview
- Objectives
- Features
- Architecture Decisions
- Verification
- Lessons Learned
- Next Task

---

## 🔍 Review

Before completion:

- Architecture Review
- UI Review (if applicable)
- Accessibility Review
- Performance Review (when relevant)
- Security Review (when relevant)

---

## 📦 Git Completion

Before a task is considered complete:

- Commit
- Push
- Completion report

---

## 🏷 Milestones

Major milestones should be tagged.

Example:

v0.2.0-alpha

---

# No Scope Creep Rule

Only implement the requested task.

Do not add unrelated features.

Future work belongs to future tasks.

---

# Exit Criteria

Every task must end with:

Implementation      ✅
Architecture        ✅
Review              ✅
Documentation       ✅
Verification        ✅
Commit              ✅
Push                ✅

Definition of Done: PASSED
# RelayDesk Task Workflow

This document defines the standard workflow for implementing every RelayDesk task.

All development tasks must follow this workflow unless explicitly instructed otherwise.

---

# Phase 1 — Repository Check

Before making any changes:

1. Verify the current git branch.
2. Verify the working tree is clean.
3. Review the task requirements.
4. Read the following documents:

* docs/project-overview.md
* docs/development-workflow.md
* docs/phase-*-spec.md (relevant phase)
* this document

Understand the existing implementation before making changes.

Do not modify code until the project context is understood.

---

# Phase 2 — Branch Management

Every task must be implemented on its own feature branch.

Never continue development on the previous task branch.

Branch naming convention:

```
phase-{phase}/task-{task}-{short-description}
```

Example:

```
phase-2/task-7-ticket-creation
```

Before implementation:

* Verify current branch
* Verify working tree is clean
* Create new branch
* Switch to new branch
* Confirm active branch

---

# Phase 3 — Planning

Before writing code:

* inspect the existing implementation
* identify reusable components
* identify reusable utilities
* identify reusable server actions
* identify reusable validation schemas
* identify reusable tests
* identify existing project conventions
* Identify potential risks

Then produce a concise implementation plan describing:

* files likely to change
* components to reuse
* overall implementation approach

Wait for user approval before making any code changes.

---

# Phase 4 — Implementation Principles

Always prefer:

* reuse over duplication
* small focused changes
* existing project architecture
* existing naming conventions
* existing utilities
* incremental implementation

Avoid:

* unnecessary abstraction
* duplicate helpers
* duplicate components
* large unrelated refactors
* changing unrelated files

Implement only what the current task requires.

---

# Phase 5 — Testing

Whenever applicable:

* add tests
* update existing tests
* keep previous tests passing

New functionality should include meaningful automated test coverage.

---

# Phase 6 — Verification

Before considering the task complete, all of the following commands must succeed:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

If any command fails:

* identify the cause
* fix the issue
* rerun verification

Do not mark the task complete until every command succeeds.

---

# Phase 7 — Documentation

If the task introduces new functionality:

* update existing documentation

or create:

```
docs/phase-x-task-y.md
```

Documentation should reflect the final implementation.

---

# Phase 8 — Git

Before finishing:

Verify:

```bash
git status
git branch --show-current
```

Working tree should only contain expected changes.

Create a meaningful commit message.

Example:

```
feat(ticket): implement ticket creation
```

Do not push unless explicitly requested.

---

# Phase 9 — Stop Conditions

Stop implementation immediately and ask for user approval if any of the following occurs:

* destructive database migration
* breaking API or database changes
* project requirements are ambiguous
* implementation requires major architectural changes
* implementation affects more than 10 files unexpectedly
* secrets or environment variables are missing
* existing project structure conflicts with the requested implementation
* third-party dependency must be added
* security implications are discovered
* implementation requires assumptions that could affect future tasks

Never continue by guessing.

Always ask for clarification.

---

# Phase 10 — Quality Checklist

Before committing, verify every item below:

* [ ] No duplicated logic introduced
* [ ] Existing components reused where appropriate
* [ ] Existing utilities reused where appropriate
* [ ] Existing architecture respected
* [ ] No unnecessary dependencies added
* [ ] No unrelated files modified
* [ ] TypeScript passes
* [ ] ESLint passes
* [ ] Tests pass
* [ ] Build passes
* [ ] Documentation updated
* [ ] Validation implemented where required
* [ ] Error handling is user-friendly
* [ ] No internal errors exposed to users
* [ ] Code is readable and consistent
* [ ] Working tree is clean after commit
* [ ] No unnecessary database queries

If any checklist item cannot be satisfied, explain why.

---

# Phase 11 — Final Report

The final response must include:

## Summary

Brief explanation of what was implemented.

## Files Created

List every new file.

## Files Modified

List every modified file.

## Verification Results

Include the results of:

* npm run lint
* npm run typecheck
* npm run test
* npm run build

## Git

Include:

* current branch
* commit hash
* git status

## Assumptions

Mention any assumptions made during implementation.

## Notes

Mention any known limitations or follow-up recommendations.

## Next Steps

Suggest the logical next task.

---

# General Rules

Always:

* keep code readable
* prefer consistency over cleverness
* reuse existing code whenever possible
* avoid unnecessary dependencies
* avoid unrelated changes
* keep commits focused on a single task
* leave the repository in a clean state
* follow the project's coding standards

Never:

* skip verification
* ignore failing tests
* expose internal implementation details to users
* make unrelated refactors without approval
* push changes without explicit user permission

A task is considered complete only after:

* implementation is finished
* all verification steps pass
* quality checklist is satisfied
* documentation is updated
* commit is created
* final report is provided

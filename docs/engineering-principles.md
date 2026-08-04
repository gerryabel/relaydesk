# RelayDesk Engineering Principles

This document defines the engineering principles used throughout the RelayDesk project.

These principles guide architectural decisions, implementation quality, and long-term maintainability.

When in doubt, prefer consistency with these principles over introducing new patterns.

---

# 1. Simplicity First

Prefer the simplest solution that correctly solves the problem.

Avoid unnecessary abstractions.

Do not optimize for hypothetical future requirements.

---

# 2. Readability Over Cleverness

Code is written for humans first.

Prefer clear, explicit code over clever one-liners.

Future contributors should understand the code with minimal effort.

---

# 3. Reuse Before Creating

Before creating:

* a new component
* a new helper
* a new hook
* a new utility
* a new service

Search the existing project for reusable implementations.

Avoid duplicated logic.

---

# 4. Single Responsibility

Every file should have a clear purpose.

Components should focus on rendering.

Business logic belongs in services or server actions.

Validation belongs in schemas.

Database access belongs in data or service layers.

---

# 5. Consistent Architecture

Follow the existing project structure.

Do not introduce new architectural patterns unless approved.

Consistency is more valuable than personal preference.

---

# 6. Incremental Changes

Prefer small, focused improvements.

Avoid large refactors unless explicitly requested.

Every commit should solve one problem.

---

# 7. Minimize Dependencies

Do not introduce new libraries unless they provide significant value.

Prefer built-in platform features whenever practical.

Every dependency increases maintenance cost.

---

# 8. Type Safety

Prefer strong TypeScript typing.

Avoid:

* any
* unnecessary type assertions
* ignored compiler errors

Let TypeScript prevent bugs.

---

# 9. Validation at Boundaries

Validate all external input.

Use Zod schemas where appropriate.

Never trust client input.

---

# 10. Error Handling

Errors should:

* be predictable
* be user-friendly
* never expose internal implementation details

Log technical details internally when appropriate.

---

# 11. Security by Default

Always assume user input is untrusted.

Verify:

* authentication
* authorization
* workspace ownership
* permissions

Never rely solely on the client.

---

# 12. Database Integrity

Keep database operations:

* atomic
* predictable
* consistent

Avoid unnecessary queries.

Reuse existing data access patterns.

---

# 13. UI Consistency

Reuse existing UI components whenever possible.

Maintain consistent:

* spacing
* typography
* colors
* interaction patterns

Avoid introducing new visual styles without reason.

---

# 14. Testing Philosophy

Test behavior, not implementation details.

Prefer meaningful tests over excessive tests.

Existing tests must continue to pass.

---

# 15. Documentation Matters

Code should be self-explanatory whenever possible.

When introducing significant functionality:

* update documentation
* document assumptions
* explain non-obvious decisions

---

# 16. Performance

Optimize only after correctness.

Avoid premature optimization.

Focus first on:

* correctness
* readability
* maintainability

---

# 17. Git Discipline

One task.

One branch.

One focused commit.

Keep history clean and easy to understand.

---

# 18. Decision Making

When multiple valid solutions exist:

Prefer, in order:

1. Existing project conventions
2. Simpler implementation
3. Better readability
4. Better maintainability
5. Better performance

---

# 19. Leave the Code Better

When modifying existing code:

* improve naming where appropriate
* remove obvious duplication
* improve readability

Avoid unrelated refactors.

Leave the surrounding code slightly better than you found it.

---

# 20. Engineering Mindset

The goal is not simply to make the code work.

The goal is to build software that is:

* reliable
* maintainable
* understandable
* testable
* consistent

Every change should improve the long-term quality of the project.

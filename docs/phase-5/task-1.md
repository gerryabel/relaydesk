# Phase 5 — Task 1: Customer / Contact Foundation

## Status

Complete

## Objective

Build the Customer/Contact foundation as a proper domain entity for RelayDesk Phase 5.  
This task provides the underlying customer record and API surface needed for later Phase 5 work such as customer context and ticket history.

## Implemented Scope

- Prisma `Customer` model scoped to a workspace.
- Ticket relationship via nullable `Ticket.customerId`.
- Customer service layer with create, read, and update operations.
- REST API under `/api/customers` and `/api/customers/[id]`.
- Zod validation for required fields, formats, update input, and optional-field normalization.
- Workspace-scoped authorization enforced in service and API layers.
- Tests covering domain behavior, API behavior, invalid input, and workspace isolation.
- Email format validation correction included.

## Database Changes

### Customer Model

```prisma
model Customer {
  id          String    @id @default(cuid())
  workspaceId String
  name        String
  email       String?
  phone       String?
  notes       String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  tickets     Ticket[]

  @@index([workspaceId])
  @@index([workspaceId, email])
  @@unique([workspaceId, email])
}
```

### Workspace Relationship

`Workspace` now includes a reverse relation:

```prisma
model Workspace {
  // ...
  customers Customer[]
}
```

### Ticket Relationship

`Ticket` gained a nullable customer link:

```prisma
model Ticket {
  // ...
  customerId  String?
  customer    Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
}
```

### Indexes and Constraints

- `Customer.workspaceId` indexed.
- Composite index on `Customer(workspaceId, email)`.
- Unique constraint on `Customer(workspaceId, email)`.
- `Ticket.customerId` indexed.

### Migration

Migration file: `prisma/migrations/20260813000000_add_customer_model/migration.sql`

Deletion behavior from the applied schema:
- Deleting a `Workspace` cascades to its `Customer` records.
- Deleting a `Customer` sets `Ticket.customerId` to `NULL`.

## Domain / Service

Service module: `src/lib/customers/server.ts`

Implemented operations:
- `createCustomer(input)` — creates a customer in the current workspace and returns ticket count.
- `getCustomers()` — lists customers in the current workspace ordered by `createdAt desc`.
- `getCustomerById(id)` — returns a customer by id within the current workspace or throws `CustomerNotFoundError`.
- `updateCustomer(id, input)` — updates customer fields within the current workspace or throws `CustomerNotFoundError`.

All service functions resolve the current membership before accessing customer data.

## API

Base path: `/api/customers`

### List and Create Customers

`GET /api/customers`
- Returns workspace-scoped customers.
- `401` when authentication/membership resolution fails.
- `403` when workspace membership is missing.

`POST /api/customers`
- Creates a customer in the current workspace.
- Validates request body with `createCustomerSchema`.
- `201` with created customer on success.
- `400` for invalid payload.
- `401`/`403` for auth/membership failures.

### Single Customer

`GET /api/customers/[id]`
- Returns a single customer by id within the current workspace.
- `404` when the customer does not exist or is outside the workspace.
- `401`/`403` for auth/membership failures.

`PATCH /api/customers/[id]`
- Updates a customer in the current workspace.
- Validates request body with `updateCustomerSchema`.
- `200` with updated customer on success.
- `400` for invalid payload.
- `404` when the customer does not exist or is outside the workspace.
- `401`/`403` for auth/membership failures.

## Validation

Validation module: `src/lib/customers/schema.ts`

### Name
- Required.
- Trimmed.
- Min 1 character.
- Max 120 characters.

### Email
- Optional.
- Trimmed.
- Max 320 characters.
- Blank/whitespace values are normalized to `null`.
- Format validated with regex requiring an `@` and a `.` outside whitespace.
- Invalid format returns `Format email tidak valid`.

### Phone
- Optional.
- Trimmed.
- Max 50 characters.
- Blank/whitespace values are normalized to `null`.

### Notes
- Optional.
- Trimmed.
- Max 2000 characters.
- Blank/whitespace values are normalized to `null`.

### Update Input
- All fields optional.
- Validation applies only to provided fields.

## Authorization / Workspace Isolation

Customer access is bound to the current workspace membership via `getCurrentMembership()`.

Confirmed behaviors from implementation and tests:
- Customers can only be read or modified within the caller's workspace.
- Cross-workspace customer access is rejected as `404 Customer not found`.
- Unauthenticated requests return `401 Unauthorized`.
- Missing workspace membership returns `403 Forbidden`.

## Tests

Final test result after implementation and correction:
- `npm run test` — **221 tests passed**

Relevant test files:
- `src/__tests__/customers.api.auth.test.ts`
- `src/__tests__/customers.service.test.ts`
- `src/__tests__/customer.validation.test.ts`

Covered behavior:
- Create, read, and update customer domain operations.
- Invalid input handling.
- Workspace isolation for service and API layers.
- Unauthorized, forbidden, not-found, and successful CRUD API responses.
- Email format validation after correction commit `3c127d6`.

## Verification

- `npm run lint` — **0 errors**
- `npm run typecheck` — **passed**
- `npm run test` — **221 tests passed**
- `npm run build` — **passed**

## Git

Branch: `phase-5/task-1-customer-foundation`

Implementation commit:
- `c45c81b` — `feat(customers): add customer foundation for phase 5`

Correction commit:
- `3c127d6` — `fix(customers): validate customer email format`

Push status:
- pushed to `origin/phase-5/task-1-customer-foundation`

## Follow-up / Task 2 Boundary

Task 2 will introduce customer context and ticket history, including explicit Customer ↔ Ticket linking behavior.

Known dependency for Task 2:
- When linking tickets to customers, workspace consistency between `Ticket.workspaceId` and `Customer.workspaceId` must continue to be enforced and explicitly tested.

This was not implemented in Task 1 and remains a follow-up consideration.

## Definition of Done

- [x] Customer foundation implemented
- [x] Workspace isolation
- [x] Validation
- [x] API
- [x] Tests
- [x] Lint
- [x] Typecheck
- [x] Tests passed
- [x] Build passed
- [x] Commit
- [x] Push
- [x] Independent verification passed

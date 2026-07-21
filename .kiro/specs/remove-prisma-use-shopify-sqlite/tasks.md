# Implementation Plan: Remove Prisma, Use Backend API Session Storage

## Overview

Step-by-step migration from Prisma + `PrismaSessionStorage` to a custom `BackendSessionStorage` that delegates session operations to a backend HTTP API. Each task builds on the previous one; nothing is left unconnected.

## Tasks

- [x] 1. Create the backend configuration helper
  - Create `app/config/backend.server.ts`
  - Export `getBackendUrl(path, params?)` that builds an absolute URL from `process.env.BACKEND_URL` plus path and optional query params
  - Export `BACKEND_HEADERS` constant with `Content-Type: application/json` and, when `process.env.BACKEND_API_KEY` is set, an `Authorization` header
  - _Requirements: 2.1, 2.2_

- [x] 2. Implement BackendSessionStorage
  - [x] 2.1 Create `app/session.server.ts` with the `BackendSessionStorage` class
    - Implement `storeSession`, `loadSession`, `deleteSession`, `deleteSessions`, and `findSessionsByShop`
    - Import `getBackendUrl` and `BACKEND_HEADERS` from `./config/backend.server`
    - Wrap every `fetch` call in `try/catch`; log errors and return safe fallbacks (`false`, `undefined`, `[]`)
    - Reconstruct `Session` objects in `loadSession` and `findSessionsByShop` including `onlineAccessInfo` when user fields are present
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.3_

  - [ ]* 2.2 Write property test: session round trip
    - Use `fast-check` with a mock HTTP backend; generate random session objects; store then load; assert field equivalence
    - Minimum 100 iterations
    - **Property 1: Session store round trip**
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 2.3 Write property test: network error returns safe fallback
    - Simulate `fetch` throwing for each method; assert no exception escapes and correct fallback is returned
    - Minimum 100 iterations
    - **Property 4: Network error returns safe fallback**
    - **Validates: Requirements 1.7**

- [x] 3. Update session storage configuration in shopify.server.js
  - Replace `PrismaSessionStorage` + `db.server` imports with `BackendSessionStorage` from `./session.server`
  - Instantiate `new BackendSessionStorage()` and pass it as `sessionStorage` to `shopifyApp()`
  - Export the `sessionStorage` instance so webhook handlers can import it
  - Remove all imports of `PrismaSessionStorage` and `prisma` / `./db.server`
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Remove Prisma artefacts and update package.json
  - Delete `app/db.server.js`
  - Delete `prisma/schema.prisma` and the `prisma/migrations/` directory
  - Remove `@prisma/client`, `prisma`, and `@shopify/shopify-app-session-storage-prisma` from `dependencies` in `package.json`
  - Remove the `"prisma"` script entry from `package.json`
  - Update the `"setup"` script to remove `prisma generate && prisma migrate deploy`; replace with a no-op (`"echo 'No setup required'"`) or remove if unused
  - _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2, 7.3_

- [ ] 5. Checkpoint — ensure the app compiles without Prisma references
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update the app-uninstalled webhook handler
  - [x] 6.1 Rewrite `app/routes/webhooks.app.uninstalled.jsx`
    - Remove the `db` import from `../db.server`
    - Import `sessionStorage` from `../shopify.server`
    - Replace the Prisma delete call with `findSessionsByShop(shop)` then `deleteSessions(ids)` guarded by `sessions.length > 0`
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 6.2 Write property test: deleting sessions for a shop clears all sessions
    - Generate a random shop with 0..N stored sessions; after deletion assert `findSessionsByShop` returns `[]`
    - Include the zero-session edge case (handler must not error)
    - Minimum 100 iterations
    - **Property 2: Delete sessions clears all shop sessions**
    - **Validates: Requirements 1.5, 1.6, 5.1, 5.3**

- [x] 7. Update the scopes-update webhook handler
  - [x] 7.1 Rewrite `app/routes/webhooks.app.scopes_update.jsx`
    - Remove the `db` import from `../db.server`
    - Import `sessionStorage` from `../shopify.server`
    - Replace the Prisma update call with `loadSession(session.id)`, mutate `scope`, then `storeSession(storedSession)`, guarded by `if (storedSession)`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 7.2 Write property test: scope update is persisted and missing sessions are handled
    - Generate a session with a random scope; store it; update scope to a different random string via the handler logic; load; assert updated scope matches
    - Include the edge case where `loadSession` returns `undefined` (handler must return 200 without throwing)
    - Minimum 100 iterations
    - **Property 3: Scope update is persisted**
    - **Validates: Requirements 1.2, 1.3, 6.1**

- [x] 8. Update the UI tech-stack reference
  - In `app/routes/app._index.jsx`, remove the Prisma link (`https://www.prisma.io/`) and its surrounding block, or replace it with a reference to the backend API session storage
  - _Requirements: 8.1, 8.2_

- [ ] 9. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster migration
- `BACKEND_URL` must be set in the environment; without it, all session operations will fail at the `fetch` level and return safe fallbacks
- `BACKEND_API_KEY` is optional but recommended for production; it is included as the `Authorization` header when set
- All property tests use `fast-check` with a minimum of 100 iterations

# Requirements Document

## Introduction

This feature migrates the Shopify app's session storage layer from Prisma ORM + `@shopify/shopify-app-session-storage-prisma` to a custom `BackendSessionStorage` class that delegates all session operations to a backend API over HTTP. The goal is to eliminate the Prisma dependency entirely while routing session persistence through a centralized backend service. Two supporting files are introduced: `app/session.server.ts` (the storage class) and `app/config/backend.server.ts` (URL and header helpers). Webhook routes that currently call Prisma directly must be updated to use the `sessionStorage` API.

## Glossary

- **BackendSessionStorage**: The custom TypeScript class in `app/session.server.ts` that implements the `SessionStorage` interface by making HTTP calls to a backend API.
- **Backend_API**: The remote HTTP service that owns and persists session data, reachable via `BACKEND_URL` environment variable.
- **Shopify_App**: The application configured via `shopifyApp()` in `app/shopify.server.js`.
- **Webhook_Handler**: Any React Router action function under `app/routes/webhooks.*` that processes Shopify webhook payloads.
- **Session**: A Shopify OAuth session object identified by `id` and associated with a `shop` domain.
- **Backend_Config**: The `app/config/backend.server.ts` module that exports `getBackendUrl` and `BACKEND_HEADERS`.

---

## Requirements

### Requirement 1: Implement BackendSessionStorage

**User Story:** As a developer, I want a `BackendSessionStorage` class that delegates session operations to a backend HTTP API, so that session data is managed by a centralized service instead of a local database.

#### Acceptance Criteria

1. THE `BackendSessionStorage` SHALL implement `storeSession(session)`, `loadSession(id)`, `deleteSession(id)`, `deleteSessions(ids)`, and `findSessionsByShop(shop)` methods.
2. WHEN `storeSession` is called, THE `BackendSessionStorage` SHALL send a `POST` request to `/api/sessions` with the session fields serialised as JSON and return `true` if the response is successful.
3. WHEN `loadSession` is called, THE `BackendSessionStorage` SHALL send a `GET` request to `/api/sessions/{id}` and reconstruct a `Session` object from the JSON response, returning `undefined` if the response is not successful.
4. WHEN `deleteSession` is called, THE `BackendSessionStorage` SHALL send a `DELETE` request to `/api/sessions/{id}` and return `true` if the response is successful.
5. WHEN `deleteSessions` is called with an array of IDs, THE `BackendSessionStorage` SHALL send a `POST` request to `/api/sessions/bulk-delete` with the IDs serialised as JSON and return `true` if the response is successful.
6. WHEN `findSessionsByShop` is called, THE `BackendSessionStorage` SHALL send a `GET` request to `/api/sessions/by-shop` with `shop` as a query parameter and return a `Session[]` reconstructed from the JSON response, returning `[]` if the response is not successful.
7. IF any HTTP call throws a network error, THEN THE `BackendSessionStorage` SHALL log the error and return `false` or an empty/undefined value appropriate to the method's return type.

---

### Requirement 2: Implement the backend configuration helper

**User Story:** As a developer, I want a shared configuration module that builds backend URLs and headers, so that all HTTP calls use a consistent base URL and authentication credentials.

#### Acceptance Criteria

1. THE `Backend_Config` module SHALL export a `getBackendUrl(path, params?)` function that constructs an absolute URL from `process.env.BACKEND_URL` and the given path, appending optional query parameters.
2. THE `Backend_Config` module SHALL export a `BACKEND_HEADERS` constant that includes `Content-Type: application/json` and, WHERE `process.env.BACKEND_API_KEY` is set, an `Authorization` header containing that value.
3. THE `app/session.server.ts` file SHALL import `getBackendUrl` and `BACKEND_HEADERS` exclusively from `./config/backend.server`.

---

### Requirement 3: Replace Prisma session storage with BackendSessionStorage

**User Story:** As a developer, I want to replace `PrismaSessionStorage` with `BackendSessionStorage` in `app/shopify.server.js`, so that the app no longer depends on Prisma for session persistence.

#### Acceptance Criteria

1. THE `Shopify_App` SHALL be configured with a `BackendSessionStorage` instance instead of `PrismaSessionStorage`.
2. THE `app/shopify.server.js` file SHALL NOT import from `@shopify/shopify-app-session-storage-prisma`.
3. THE `app/shopify.server.js` file SHALL NOT import from `./db.server`.
4. THE `sessionStorage` instance SHALL be exported from `app/shopify.server.js` so that webhook handlers can import it directly.

---

### Requirement 4: Remove the Prisma client module

**User Story:** As a developer, I want to remove `app/db.server.js` and all Prisma dependencies, so that the codebase contains no residual ORM code.

#### Acceptance Criteria

1. THE codebase SHALL NOT contain a file at `app/db.server.js` after the migration.
2. THE `package.json` SHALL NOT list `@prisma/client`, `prisma`, or `@shopify/shopify-app-session-storage-prisma` as dependencies.
3. THE `prisma/` directory (including `schema.prisma` and any `migrations/`) SHALL be removed from the repository.

---

### Requirement 5: Update the app-uninstalled webhook handler

**User Story:** As a developer, I want the app-uninstalled webhook to delete sessions using the `sessionStorage` API, so that it no longer depends on a direct Prisma query.

#### Acceptance Criteria

1. WHEN Shopify sends an `APP_UNINSTALLED` webhook, THE `Webhook_Handler` SHALL delete all sessions associated with the uninstalled shop by calling `sessionStorage.deleteSessions()` with the session IDs returned by `sessionStorage.findSessionsByShop(shop)`.
2. THE `webhooks.app.uninstalled.jsx` route SHALL NOT import `db` from `../db.server`.
3. WHEN no sessions exist for the shop at the time the webhook fires, THE `Webhook_Handler` SHALL complete without error.

---

### Requirement 6: Update the scopes-update webhook handler

**User Story:** As a developer, I want the scopes-update webhook to update the session scope using the `sessionStorage` API, so that it no longer depends on a direct Prisma query.

#### Acceptance Criteria

1. WHEN Shopify sends an `APP_SCOPES_UPDATED` webhook, THE `Webhook_Handler` SHALL load the current session via `sessionStorage.loadSession()`, update its `scope` property, and persist the change via `sessionStorage.storeSession()`.
2. THE `webhooks.app.scopes_update.jsx` route SHALL NOT import `db` from `../db.server`.
3. IF no session is found for the given session ID, THEN THE `Webhook_Handler` SHALL return a successful response without attempting to update a non-existent record.

---

### Requirement 7: Update project setup scripts and remove Prisma artefacts

**User Story:** As a developer, I want the project setup and Docker scripts to work without Prisma CLI commands, so that new contributors can onboard without installing Prisma.

#### Acceptance Criteria

1. THE `package.json` `"setup"` script SHALL NOT invoke `prisma generate` or `prisma migrate deploy`.
2. WHERE the `"setup"` script is still needed, THE `package.json` SHALL retain a no-op or replacement script that does not reference Prisma.
3. THE `package.json` SHALL NOT contain a `"prisma"` script entry.

---

### Requirement 8: Update the UI reference to Prisma

**User Story:** As a developer, I want the app index page to no longer mention Prisma as the database layer, so that the displayed tech stack reflects the actual implementation.

#### Acceptance Criteria

1. THE `app/routes/app._index.jsx` file SHALL NOT contain a link or reference to `https://www.prisma.io/`.
2. WHEN the index page is rendered, THE page SHALL remove the Prisma database entry or replace it with a reference to the backend API session storage.

# Design Document: Remove Prisma, Use Shopify SQLite Session Storage

## Overview

This migration replaces the Prisma ORM layer with `@shopify/shopify-app-session-storage-sqlite`, a lightweight adapter maintained by Shopify that manages session persistence directly against a SQLite file. The change touches five areas: the session storage configuration, the Prisma client module, two webhook handlers, the setup scripts, and a UI text reference.

The `@shopify/shopify-app-session-storage-sqlite` package internally creates and manages a `shopify_sessions` table, so no manual schema management or migration tooling is needed.

---

## Architecture

**Before:**

```
shopify.server.js
  └─ PrismaSessionStorage(prisma)
       └─ db.server.js → PrismaClient → dev.sqlite (via Prisma schema)

webhooks.app.uninstalled.jsx  → db.session.deleteMany(...)
webhooks.app.scopes_update.jsx → db.session.update(...)
```

**After:**

```
shopify.server.js
  └─ SQLiteSessionStorage("sessions.sqlite")
       └─ shopify-app-session-storage-sqlite → sessions.sqlite

webhooks.app.uninstalled.jsx  → sessionStorage.findSessionsByShop() + deleteSessions()
webhooks.app.scopes_update.jsx → loadSession() + storeSession()
```

No additional infrastructure changes are required. The SQLite file path can be configured via an environment variable for flexibility across dev/prod environments.

---

## Components and Interfaces

### `app/shopify.server.js` (modified)

Replace:

```js
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
// ...
sessionStorage: new PrismaSessionStorage(prisma),
```

With:

```js
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
// ...
const sessionStorage = new SQLiteSessionStorage(
  process.env.SESSION_DB_PATH ?? "sessions.sqlite"
);
// ...
sessionStorage,
```

The `sessionStorage` instance is exported so webhook handlers can import it directly.

### `app/db.server.js` (deleted)

File is removed entirely. No other module imports it after the migration.

### `app/routes/webhooks.app.uninstalled.jsx` (modified)

The handler needs the list of session IDs for a shop before it can delete them. `SQLiteSessionStorage` exposes `findSessionsByShop(shop)` → `Session[]` and `deleteSessions(ids)`.

```js
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (sessions.length > 0) {
    await sessionStorage.deleteSessions(sessions.map((s) => s.id));
  }

  return new Response();
};
```

### `app/routes/webhooks.app.scopes_update.jsx` (modified)

Load the session, mutate `scope`, then store it back.

```js
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    const current = payload.current;
    const storedSession = await sessionStorage.loadSession(session.id);
    if (storedSession) {
      storedSession.scope = current.toString();
      await sessionStorage.storeSession(storedSession);
    }
  }

  return new Response();
};
```

### `app/routes/app._index.jsx` (modified)

Remove or replace the Prisma link in the "Database" row of the tech-stack section.

### `package.json` (modified)

- Remove: `@prisma/client`, `prisma`, `@shopify/shopify-app-session-storage-prisma`
- Add: `@shopify/shopify-app-session-storage-sqlite`
- Update `"setup"` script: remove `prisma generate && prisma migrate deploy`
- Remove `"prisma"` script entry

### `prisma/` directory (deleted)

`prisma/schema.prisma` and `prisma/migrations/` are removed from the repository.

---

## Data Models

The `@shopify/shopify-app-session-storage-sqlite` adapter manages its own `shopify_sessions` table. The schema it creates is compatible with all fields stored by `@shopify/shopify-api`. No custom schema definition is required.

The SQLite file path defaults to `sessions.sqlite` at the project root, overridable via `SESSION_DB_PATH` environment variable.

---

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

Property 1: Session store round trip
_For any_ valid Shopify `Session` object, storing it via `sessionStorage.storeSession(session)` and then loading it via `sessionStorage.loadSession(session.id)` should return an equivalent session object.
**Validates: Requirements 1.1, 1.2**

Property 2: Delete sessions clears all shop sessions
_For any_ shop domain, after calling `sessionStorage.deleteSessions()` with all session IDs for that shop, calling `sessionStorage.findSessionsByShop(shop)` should return an empty array.
**Validates: Requirements 3.1, 3.3**

Property 3: Scope update is persisted
_For any_ existing session, updating `scope` and calling `sessionStorage.storeSession()` should cause a subsequent `sessionStorage.loadSession()` to return the updated scope value.
**Validates: Requirements 4.1**

Property 4: Missing session is handled gracefully
_For any_ session ID that does not exist in the store, `sessionStorage.loadSession(id)` should return `undefined` or `null` without throwing.
**Validates: Requirements 4.3**

---

## Error Handling

- `SQLiteSessionStorage` constructor: if the SQLite file path is invalid or the directory is not writable, the adapter will throw at construction time. This surfaces at app startup, which is the correct failure mode.
- `webhooks.app.uninstalled.jsx`: if `findSessionsByShop` returns an empty array (shop already uninstalled / webhook fired twice), the handler skips `deleteSessions` and returns `200 OK`. This satisfies requirement 3.3.
- `webhooks.app.scopes_update.jsx`: if `loadSession` returns `null`/`undefined`, the handler returns `200 OK` without mutating state. This satisfies requirement 4.3.
- No changes to Shopify authentication error handling — that remains managed by `@shopify/shopify-app-react-router`.

---

## Testing Strategy

### Unit Tests

Focus on the two modified webhook handlers using mocked `sessionStorage`:

- `webhooks.app.uninstalled`: verify that `deleteSessions` is called with the correct IDs when sessions exist, and is not called when the session list is empty.
- `webhooks.app.scopes_update`: verify that `storeSession` is called with the updated scope, and is not called when no session is found.

### Property-Based Tests

Use a property-based testing library (e.g., `fast-check` for JavaScript) with a minimum of 100 iterations per property.

- **Property 1 — Session round trip**: Generate random `Session`-shaped objects, store then load, assert deep equality.
  Tag: `Feature: remove-prisma-use-shopify-sqlite, Property 1: Session store round trip`

- **Property 2 — Delete clears shop sessions**: Generate a random shop with N sessions, store all, delete all by shop, assert `findSessionsByShop` returns `[]`.
  Tag: `Feature: remove-prisma-use-shopify-sqlite, Property 2: Delete sessions clears all shop sessions`

- **Property 3 — Scope update persisted**: Generate a session with a random scope string, store, update scope to a different random string, store again, load, assert updated scope is present.
  Tag: `Feature: remove-prisma-use-shopify-sqlite, Property 3: Scope update is persisted`

- **Property 4 — Missing session handled gracefully**: Generate random non-existent IDs, call `loadSession`, assert no exception thrown and result is nullish.
  Tag: `Feature: remove-prisma-use-shopify-sqlite, Property 4: Missing session is handled gracefully`

Both unit tests and property tests are complementary. Unit tests cover specific integration points and edge cases. Property tests validate universal correctness across arbitrary inputs.

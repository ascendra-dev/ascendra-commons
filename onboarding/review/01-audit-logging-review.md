# Review sheet — Steps 0 and 1

For the reviewer. Each question names where the answer lives, so you can check it without guessing.

## Step 0 review (about 30 minutes)

**Check the hand-in**

- [ ] `notes/00-orientation/` has setup, repo-map, sandbox, testbed and distribution notes.
- [ ] The repo-map diagram shows the right direction of flow (commons → sandbox → testbed → packages → vertical).
- [ ] Definitions are in their own words, not pasted.

**Ask** (answer source in brackets)

1. Why copy-based distribution and not an npm package? (commons README, "Distribution")
2. What does `ascendra-commons.js add` deliberately not do? (no `npm install`, no `forRoot` wiring, no DB)
3. Why does `update` refuse when a vendored file was edited? (sha256 in `VENDORED.json`)
4. `.core` vs `.core.postgres-drizzle` vs `.api` — which one may import which? (MODULE-STANDARD §1b; `npm run check`)
5. What must a host app provide before any module works? (commons README, "Integrating", step 4)
6. Why does `forRoot` take `imports`? (GUIDE §3.2 — `useExisting` sees only the module's own scope)
7. Two global guards: which runs first, and what breaks if they're swapped? (GUIDE §3.4)

**Pass when:** 6 of 7 answered correctly without notes.

## Step 1 review (45–60 minutes)

### 1. Check the hand-in (before the session)

- [ ] `api-calls.md`: every endpoint × persona row has expected and actual results; mismatches are explained.
- [ ] `flow.md`: pick 3 random `file:line` references and open them — they point at what's described.
- [ ] Lab API: clone it fresh, follow its README, run `demo.sh`. It works.
- [ ] `node ascendra-commons.js status` in the lab is clean (no edited vendored files).
- [ ] Each seam exercise has its own branch, with evidence in `seams.md`.
- [ ] Lab web shows the lab's own records, including a diff.
- [ ] `findings.md` entries are specific (location + evidence), not vague.

### 2. Walkthrough (15 minutes)

Ask for a walkthrough of `flow.md` without notes: startup → write → read. Interrupt at any step with "show me the
line".

### 3. Questions (answer source in brackets)

1. Why does commons ship the listener instead of each app writing its own? (README — fixed `AUDIT_EVENT_NAME`)
2. Why `@OnCriticalEvent` and not `@OnEvent`? (GUIDE §3.6 — `suppressErrors`)
3. A change rolls back after its audit write. Is the audit row still there? It depends on what? (README; GUIDE §5,
   failure semantics)
4. Why are the write port and the read port separate? (README — a custom write repo isn't forced to do reads)
5. Where does the correlation id come from in an HTTP request? In a background job? (GUIDE §5 step 3)
6. Why `AsyncLocalStorage` and not a request-scoped provider? (no request in a job)
7. A tenant admin sends `?tenantId=<another tenant>`. What happens, and where in the code? (`scoped()` in
   `audit-events-api.service.ts`)
8. Another tenant's record id → which status, and why not 403? (GUIDE §8 — existence leaks)
9. What is `application` for, and what's still missing to use it across products? (README `applicationId`)
10. Why a keyset cursor and not page numbers? Why `limit + 1`? (GUIDE §6 step 12)
11. What stops a CSV cell from running as a formula? (`audit-events-csv.ts`)
12. What happens if the app forgets to register `AuthorizationGuard` globally? (GUIDE §8 —
    `AuthorizationEnforcedGuard`, 500 naming the fix)
13. Why no Model 1 / Model 2 here, while authorization has both? (README; MODULE-STANDARD §2 dimension 6)
14. What would a project on another database replace, and what would it keep? (GUIDE §2 — ports and adapters)
15. Of the AUDIT-REPORT gaps, which matter most for Ascendra Pay and why? (open; judge the reasoning)

**Pass when:** 12 of 15 answered correctly, including 2, 3, 7 and 13.

### 4. Live debugging (15 minutes)

Break one thing in the lab **app's own code** (never the vendored files), then ask the trainee to find it. Pick one
or two:

| Break | What they should see | What they should find |
|---|---|---|
| Remove `CorrelationIdMiddleware` | Records still written; a request's records don't share one id (trace shows only one) | Missing middleware in `CommonsModule.configure` |
| Swap the two `APP_GUARD` entries | 401 on every audited route, even with a valid actor | Guard order: authorization runs before `request.actor` is set |
| Drop `imports: [DatabaseModule]` from the persistence `forRoot` | App fails at startup with a Nest "can't resolve dependencies" error | `useExisting` can't see the DB token |
| Remove `DomainEventsModule.forRoot` | App fails at startup, or `emitCritical` has no emitter | The listener is reached through domain events |
| `emitCritical` → `emit` in the pay endpoint, with a failing repository | Pay succeeds, no audit row, no error | The swallowed failure (seam exercise) |
| Remove `audit.view` from the tenant admin persona | Tenant admin gets 403 on `/audit/*` | Persona map in the static-map config |

**Pass when:** they find the cause within about 10 minutes, starting from the symptom rather than guessing.

## Sign-off

| Item | Result | Notes |
|---|---|---|
| Step 0 | Pass / Redo | |
| Step 1 hand-in | Pass / Redo | |
| Walkthrough | Pass / Redo | |
| Questions | __ / 15 | |
| Live debugging | Pass / Redo | |
| Time taken (from `summary.md`) | | |
| Adjustments for step 2 | | |

Use "Adjustments for step 2" to plan the next module: what to repeat, what to skip, and what pace to expect.

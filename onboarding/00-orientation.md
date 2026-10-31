# Step 0 — Orientation and setup

**Goal:** know what each repo is for, have the sandbox and the UI testbed running, and understand the rules every
commons module follows.

**Deliverables** go in `commons-lab/notes/00-orientation/`.

---

## 0.1 Tools and access

- [ ] Node 20.6 or later, Docker, Git, VS Code and Claude Code installed.
- [ ] You can clone `ascendra-commons`, `ascendra-commons-sandbox`, `ascendra-commons-ui` and `ascendra-ui`.
- [ ] `commons-lab` repo created, with the folder layout from the [README](README.md#where-your-work-goes).

**Done when:** `node -v`, `docker -v` and `git -C ../ascendra-commons log -1 --oneline` all print without errors.
Paste the output into `notes/00-orientation/setup.md`.

## 0.2 The map — read

Read these in order. Skim for now; you'll come back to them.

- [ ] `ascendra-commons/README.md` — what commons is, how it's distributed, how a project integrates it.
- [ ] `ascendra-commons/MODULE-STANDARD.md` — §1b (package roles) and §2 dimensions 1, 2, 3, 6 and 7.
- [ ] `ascendra-commons-sandbox/README.md` — the host app, dev sign-in, endpoint table.
- [ ] `ascendra-commons-ui/README.md` and `ascendra-commons-ui/packages/README.md` — how a module's UI is built and
      copied into an app.
- [ ] `ascendra-commons/ROADMAP.md` — §1 only (why commons exists, what "ready" means).

**Done when:** you have written `notes/00-orientation/repo-map.md` with:

- [ ] One line per repo: what it is and who uses it (commons, sandbox, commons-ui, ascendra-ui, a vertical like
      pay-api / pay-web).
- [ ] A diagram (Mermaid or a photo of paper) showing how code flows: commons → vendored into the sandbox →
      served to the commons-ui testbed → `packages/` → copied into a vertical.
- [ ] Your own definition of these words, one sentence each: **vendoring**, **package** (`.core`, `.core.<adapter>`,
      `.api`), **port**, **adapter**, **Model 1 / Model 2**, **`forRoot`**, **application**, **tenant**, **persona**.

## 0.3 Run the sandbox (backend)

In `ascendra-commons-sandbox`, follow its README Quickstart.

- [ ] `npm run db:up`, `npm run db:reset`, `npm run start:dev`.
- [ ] `curl localhost:3010/health` answers OK.
- [ ] `curl localhost:3010/dev/personas` lists the dev users.
- [ ] Get a token for `platform.admin@ascendra.test` and call `GET /me`.

**Done when:** `notes/00-orientation/sandbox.md` has the commands you ran and the `/me` response.

## 0.4 Run the testbed (frontend)

In `ascendra-commons-ui/testbed`, follow the README "Local development" section.

- [ ] The testbed runs on http://localhost:3002.
- [ ] Sign in from the avatar menu as **platform admin**, a **tenant admin** and a **member**.
- [ ] Open `/observability`, `/access`, `/notifications` and `/files`.

**Done when:** `notes/00-orientation/testbed.md` has one screenshot per persona of `/observability`, and one
sentence on what each persona can and cannot see.

## 0.5 How a module reaches a project

- [ ] Read `ascendra-commons/README.md` "Distribution" and "Integrating into a project" again, carefully.
- [ ] Open `ascendra-commons-sandbox/ascendra-commons.json` and `src/ascendra-commons/VENDORED.json`.
- [ ] In the sandbox, run `node ascendra-commons.js status`.
- [ ] Open `ascendra-commons-sandbox/src/modules/commons/` and `commons.module.ts`: one file per module, one module
      importing them all.
- [ ] In `ascendra-commons`, run `npm install`, `npm test` and `npm run check`.

**Done when:** `notes/00-orientation/distribution.md` answers, in your own words:

- [ ] What do `add`, `update`, `status` and `remove` each do? What does `add` **not** do?
- [ ] Why does `update` refuse to run if a vendored file was edited?
- [ ] How does a module's migration reach the project's database?
- [ ] What are the 5 things a host app must provide (README, "Integrating into a project", step 4)?
- [ ] What does `npm run check` enforce, and why?

## 0.6 NestJS ideas commons depends on

You know NestJS already. Make sure these specific ideas are solid. `audit-logging/GUIDE.md` §3 shows each one with
real code.

- [ ] Dynamic modules: `forRoot(config)` returning a `DynamicModule`.
- [ ] Symbol tokens, and `useExisting` vs `useValue` vs `useClass`.
- [ ] Why a module's `forRoot` takes `imports` (what `useExisting` can and can't see).
- [ ] Global guards (`APP_GUARD`) and why their registration order matters.
- [ ] Custom decorators: `SetMetadata` and `createParamDecorator`.
- [ ] Middleware vs guard vs interceptor: what runs first.
- [ ] `@OnEvent` and its `suppressErrors` option.
- [ ] `Test.createTestingModule`, and why commons insists every module has at least one test that boots it.
- [ ] `AsyncLocalStorage` (Node) — what it is for.

**Done when:** you can explain each item at a whiteboard in about 2 minutes without notes (checked in review).

---

## Hand-in

- [ ] Everything in `notes/00-orientation/` committed and pushed.
- [ ] `notes/00-orientation/findings.md` — anything confusing, wrong or missing in the docs you read (may be empty).
- [ ] Ask for the step 0 review.

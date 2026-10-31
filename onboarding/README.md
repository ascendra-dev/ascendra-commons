# Onboarding — Ascendra Commons

Ramp-up for a developer joining Ascendra Pay (PAY-003). The goal: know every commons module well enough to wire it
into a real project, follow each call end to end, and choose between its implementations (Model 1 / Model 2).

## How this works

- One step at a time. Finish a step, hand in its deliverables, get it reviewed, then start the next.
- No fixed timeline. Work at a steady pace. The first module takes longest; later ones go faster.
- Each step is a checklist. Every item says what to do and how to show it's done.
- After each module, the reviewer looks at the results and writes the plan for the next one.

| Step | File | Status |
|---|---|---|
| 0 — Orientation and setup | [00-orientation.md](00-orientation.md) | Ready |
| 1 — audit-logging | [01-audit-logging.md](01-audit-logging.md) | Ready |
| 2+ — next modules | planned after step 1 is reviewed | — |

Reviewer notes (questions, break-it exercises, sign-off) are in [review/](review/).

## Rules

- **Report, don't change.** Never edit `ascendra-commons`, `ascendra-commons-sandbox` or `ascendra-commons-ui`. If
  you find a bug, a gap or a doc mistake, write it in your findings file (below).
- **Never edit vendored code.** In your own lab, files under `src/ascendra-commons/` and
  `ascendra-commons-ui/` are copies. Don't touch them.
- **Show, don't claim.** "Done" means there is evidence: a command output, a screenshot, a passing test, a file.
- **Ask early.** If you're stuck for more than an hour, write down what you tried and ask.
- **AI is allowed — understanding is still required.** Use Claude to explain code. In review you must explain
  everything you hand in without help.

## Where your work goes

Create your own repo, `commons-lab`, as a sibling of `ascendra-commons`:

```
ascendra-public/
  ascendra-commons/          # read only
  ascendra-commons-sandbox/  # read only — run it, don't change it
  ascendra-commons-ui/       # read only — run it, don't change it
  commons-lab/               # yours
    api/                     # a tiny NestJS app — exists only to host commons modules
    web/                     # a tiny Next.js app — exists only to host commons UI packages
    notes/
      00-orientation/
      01-audit-logging/
```

The lab app is deliberately tiny: one table, three endpoints. It exists to practise wiring modules, not to build a
product. If you're spending time on lab features rather than commons, stop and ask.

Commit as you go: one commit per checklist item where it makes sense. The reviewer reads your git history.

## The findings file

Every step has a `notes/<step>/findings.md`. One row per finding:

| # | Type | Where (file:line or URL) | What I saw | Why it matters |
|---|---|---|---|---|
| 1 | Bug / Gap / Doc / Question | `audit-logging.core/…:42` | … | … |

A good finding is specific and has evidence. "This could be better" is not a finding.

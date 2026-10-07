# Playbooks

One per kind of request. Each gives the recon to do before speaking, the opening
move, the exemplar to point at, and what to let them discover rather than tell.

These are recipes, not scripts. If the situation doesn't fit, coach the situation.

---

## "I want to start a work item"

**Recon:** the note in the vault (`have-fish-vault`): its status, its `depends_on`,
and for a tech note its *Build it* steps and *Review* list. For current-app work
in an epic, the epic file in `planning/epics/` too. `git log --oneline -10` for
what just shipped. If they named something vague, find the note that matches.

**Opening move:** have them pick the smallest shippable slice. Notes are already
sized XS or S, and one note is one PR. If the thing they want has no note yet, the
house rule in `CLAUDE.md` is that design comes before code: refining the note *is*
the design conversation.

**Let them discover:** where the work starts. In the rewrite, ask "what's the pure
rule here, before any file or window?" — it starts in `core/`, with a failing test.
In the current app, ask "what has to be true in the database before the route can
exist?" — almost every change there runs schemas → migrations → service → route →
test → API client → component. Noticing either ordering once is worth more than
being handed it six times.

**Moves:** `<leader>ff` to the note or the file, `<leader>gg` to branch off `main`.
Branch naming and the PR-not-direct-push rule are in `CLAUDE.md`.

---

## "New backend route"

This is the current app; `backend/CLAUDE.md` has its rules.

**Recon:** read the closest existing route, its service and its test.
`routes/rules.ts` with `rules/rule-service.ts` and `rules/target.ts` is a rich
example (ownership checks, mutually-exclusive targets, a failure returned as an
`Outcome`); `routes/user-settings.ts` is a small one. Check whether the schema
files (`db/pg/schema.ts`, `db/sqlite/schema.ts`) already have the table.

**Opening move:** tests first — it's the stated house workflow, and here it's also
the faster path, because `app.request()` gives a full request round-trip with no
server to start. Have them open the test file first: `<C-^>` will then flip them
back and forth all session.

**Point at, don't paraphrase:**
- `backend/src/test-utils.ts` — `clearDatabase()`, `createTestUser()`, `request()`, `at()`
- the seed helpers at the top of `routes/rules.test.ts`
- `build-app.ts:72` for where `userId` comes from

**Let them discover:**
1. That the handler needs `c.get('userId')` — ask what stops user A reading user
   B's rows, and let them go find it.
2. That the query needs `isNull(deletedAt)` — the soft-delete rule.
3. That the query belongs in a service, not the route — `layers.test.ts` will
   say so if they put it in the route.
4. That the body goes through `parseBody` and a Zod schema, and a failure is a
   code with a sentence in the frontend's `copy/errors.ts` — `bodies.test.ts` and
   `errors.test.ts` hold both.
5. That a new route isn't reachable until it's mounted in `build-app.ts`, and that
   mount order can matter (the comment at `build-app.ts:81` explains a real instance).
6. That amounts are strings. If they write `10.00` as a number, let the type error
   teach them; `bun test` will say it before you do.

**If the schema changes:** both schema files, then `db:generate` → `db:migrate` →
`db:migrate:test`, and `bun run test:sqlite` as well as `bun test`. Let them forget
`db:migrate:test` once. The failure is fast, legible, and unforgettable.

---

## "New frontend component"

**Recon:** `frontend/src/lib/components/ui/` for something with a similar shape,
and `frontend/src/styles/tokens.css` for the values they'll need. Check whether
the thing they want already exists under a name they wouldn't have guessed —
`ControlBar`, `TableShell`, `MoreMenu`, `Chip` cover a lot of ground.

**Opening move:** "before you write it, is there one already?" Search first is a
habit worth building here: `<leader>ff` in the components directory, or
`<leader>sw` on a class name they saw in the UI. The design system is strict enough
that a new one-off component is usually the wrong answer.

**Point at:** `GradientButton.svelte` — it's the house pattern end to end: the
`interface Props` with doc comments explaining *why* each variant exists, `$props()`
destructuring with defaults, `class:` directives for state, and a scoped `<style>`
using only token variables.

**Let them discover:**
1. The token rule. Ask what happens when the accent colour changes — the answer
   ("everything that used the token moves; everything hard-coded doesn't") is the
   whole argument for `tokens.css`, and it lands better as a conclusion.
2. That `Button` and `Panel` were deleted on purpose — `GradientButton` and `Card`
   are the primitives. `git log` on the deletion commit has the reasoning.
3. Aqua shadows and the radius scale come from tokens too, not from taste.

**Moves:** `cit` for inner-tag edits in markup, `<leader>ss` to jump between the
script/markup/style sections of a long `.svelte` file, `bun run check` in a split
terminal.

---

## "Help me refactor this"

**Recon:** read the target, then `<leader>sw`-equivalent — grep for every caller.
Know the blast radius before they start.

**Opening move:** ask what the refactor is *for*. Naming, duplication,
testability, or a shape that's blocking the next feature — the answer decides the
technique. Then: "what's the test that will tell you you didn't break it?" If
there isn't one, that's the first piece of work.

**Sequence to coach toward:** green tests → one mechanical step → green tests →
repeat. `bun test --watch` running in `<C-/>` the whole time. Small steps are more
important in an unfamiliar codebase, not less.

**Moves:** this is the nvim-heavy playbook. `<leader>cr` for renames, `vif`/`daf`
for moving function bodies, macros for repetitive call-site updates, `.` for
everything repeatable. See the extraction sequence in `nvim-moves.md` — and be
upfront that Extract Method is manual here.

**Let them discover:** whether the abstraction is load-bearing. Ask "what's the
second caller that would use this?" If there isn't one, the refactor might be
premature — a conversation worth having before the diff, not after.

---

## "This test is failing" / "I'm stuck"

**Recon:** read the actual failure output before theorising. If you don't have it,
ask them to paste it — reading a stack trace together is itself a rep.

**Opening move:** hand them the diagnosis, not the fix. "What does the assertion
say it got, versus what it wanted?" In the current app, most failures are one of
these:

1. Forgot `db:migrate:test` — missing column or table.
2. Missing `clearDatabase()` in `beforeEach`, or a new table not added to it, so
   state leaks between tests.
3. Missing `Cookie` header → 401. `createTestUser()` returns it.
4. A number where a `numeric` string belongs.
5. Route not mounted in `build-app.ts`, or shadowed by an earlier mount → 404.
6. A guard test (`layers`, `bodies`, `errors`, `dialect`, `schemas`, `copy`) that
   names the rule broken. Its message is the lesson; read it together.

In the rewrite, the usual first failures are a type error from a strict flag, or a
`core/` import the purity check refuses. Same move: read what it says first.

Name the *category* and let them find which. If they're already two rounds deep,
drop a rung and point at the line.

**Moves:** `]d` to walk diagnostics, `<leader>xx` for the full list, `<C-^>` back
to the implementation.

---

## "What should I work on?" / "Suggest something"

**Recon:** the vault's Backlog: `ready` notes whose `depends_on` are done. Until the
triage is applied, open GitHub issues count too. `git log --oneline -15` for
what's warm. (`planning/BUGS.md` and `TASKS.md` are frozen; don't mine them.)

**Opening move:** offer two or three concrete options with the *learning* they'd
each produce, since that's the real currency here — "this one is a small vertical
slice through the whole stack, this one is frontend-only and would drill the token
system, this one is a refactor with good test coverage already in place." Let them
pick. Sizing is part of the skill; don't pick for them.

Bias toward things that are small, end-to-end, and already have tests around
them. A first change that touches schema, route, test and component teaches the
codebase's shape better than four changes that each stay in one layer. Their
stated goals are fluency, TypeScript and desktop apps, so a rewrite note usually
teaches more than a current-app fix of the same size.

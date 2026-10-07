---
name: pair
description: Pair-program with the user in have-fish, taking turns. Claude writes the scaffolding, a few basic tests and skeletons of the rest; the user fills in the tests and writes the rules and the seams, so they rebuild their fluency, learn TypeScript and desktop apps, and understand the core well enough to debug it. It is the default for rewrite work, so use it when the user picks up any rewrite story or tech note ("let's start HF-1", "let's pick up HF-9") without naming another mode, and when they say "let's pair", "pair on", "pair with me", or invoke /pair. Stay in this mode for every follow-up turn until they say to stop or switch modes. Not for "build it" or "while I'm away" (just do the work), not for current-app work they didn't ask to pair on, and not for "coach me" (use the coach skill).
---

# Pair

You and the user build one thing together, taking turns. They come away with two things: the
reps that rebuild their fluency, and an understanding of the core code — how it's organised,
where the seams are, and where to look when it breaks. They don't want to type config and
boilerplate, though, and much of this ground is new to them. So you write the parts that are
typing, and they write the parts that are thinking, including most of the tests.

## The three modes

| Mode | Who writes | Skill |
|---|---|---|
| **Build** | Claude writes everything; the user reviews the PR | none, the normal session |
| **Pair** | Turn by turn: Claude writes scaffolding, a few basic tests and skeletons; the user fills in the tests and writes the logic | this one |
| **Coach** | The user writes everything; Claude guides | `coach` |

Pair is the default for rewrite work: any story or tech note, anything in `core/` or `desktop/`.
Current-app work defaults to build. The user switches by saying so: "build X while I'm away",
"let's pair on X", "coach me through X". A switch mid-session is fine. Finish the current turn
cleanly, then change.

## Who drives each step

A tech note's *Build it* steps carry a driver. Treat it as a default, since the user can change
any of them in chat. A story's steps carry none, so apply the test below.

- **Claude:** config, scaffolding, CI, fixtures, generated code, verbatim ports, and test
  helpers. The user reads it and doesn't type it.
- **you** (the user): the rules, the seams between modules, error paths, and anything they'd
  need to debug at 11pm. Claude writes **one or two very basic tests**, the plainest happy path,
  enough to show what a test looks like here, and a **skeleton for each of the rest**. The user
  turns each skeleton into a real test, then writes the code that makes them pass.
- **Claude shows, then you:** the first of a new kind of thing (the first Zod schema, the first
  Drizzle table, the first IPC handler). Claude writes one and explains it in three or four
  lines, then the user writes the next one.

For a step with no driver, apply the same test: *would they need to understand this line to
debug the ledger?* If yes, it's theirs. If it's typing, it's yours. If it's both and new, show
it first. When in doubt, it's theirs: the reps are half the point.

### What a skeleton is

One `it.todo('…')` per case, titled the way the note's *Done when* or acceptance line reads:
`it.todo('rejects postings that do not balance per currency')`. Where the title doesn't say it
all, put a Given/When/Then comment above it. Group them in a `describe` that matches the
function. A skeleton never has a body, and is never an empty `it('…', () => {})`: that passes
green and tests nothing. vitest lists `todo` tests in its summary, so what's left stays visible.

## A turn

1. **Recon, silently.** Read the note, the code it ports, and the real files. Same rule as the
   coach skill: never point at a file you haven't opened.
2. **Your part of the step.** Write the scaffolding, the basic tests and the skeletons for the
   step, and nothing else. Keep it small. Then say, in two or three lines, what you wrote and
   the one thing about it worth knowing.
3. **Hand over.** Name the file, the function, and the skeletons to fill, plus one line of
   orientation (scope, not steps). Then hands off: **don't edit any file while it's their
   turn.** After you've edited a file they have open, tell them to reload it (`:checktime`, or
   `:e`).
4. **"Done":** run the tests and the type check, and check that no `it.todo` is left in the
   step's files. Read their tests as well as their code: would each test fail if the rule it
   names broke? Then read the diff against the note's *Review* list. Raise what you find as a
   question or a hint, not a rewrite: they fix it. When it's green and clean, commit it with a
   message that says what the step did.
5. **"Stuck":** use the coach skill's hint ladder (`.claude/skills/coach/SKILL.md`): orient,
   narrow, shape, show. Start at the rung their question shows they need. **"Just tell me" or
   "you write it"** is honoured at once, without reluctance: write it, then explain it line by
   line in a few sentences, since that explanation is where the learning goes when discovery
   didn't happen.

Pace: one step per turn. Don't run ahead to the next step's scaffolding before this one is
green.

## Keeping the understanding when Claude wrote it

- **Narrate briefly.** Every turn where you wrote code ends with what to notice, in a sentence
  or two. Not a lecture.
- **Teach-back, when it's offered or asked for.** After a step you drove that sits next to a
  seam, offer: "explain back what this does in two lines?" Then correct only what's off.
- **Tour.** When the note's last step is green, write the PR body's **Tour** section: the
  seams, what calls what, the one or two places to put a breakpoint, and which steps were the
  user's. A Build-mode PR gets the same section, and it flags the parts they'd have written as
  "worth your read".
- **Debug drills**, only when asked: on a throwaway branch, break one seam in a realistic way,
  and let them find it with the tests and the debugger. Never on a branch that might merge.

## Who you are pairing with

The coach skill's calibration holds: a senior backend engineer from the JVM and IntelliJ, now in
nvim, coming back after a long stretch of writing little code. Two things about the rewrite in
particular:

- **TypeScript is new, not just the libraries.** The first time a step leans on a type-system
  move, name it in a line and say how it differs from Java: structural rather than nominal
  typing, unions narrowed by a check, a type inferred from a Zod schema (`z.infer`),
  `satisfies`, and what the strict flags (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) are complaining about when they fire.
- **Desktop apps are new.** The same for Electron when it arrives: main is Node, the renderer
  is Chromium, the preload is the only bridge between them, and why context isolation and the
  sandbox are on.

Much of the rest is rusty rather than new. Name it plainly and move on. Don't explain what
they've shipped for years.

The coach skill's `references/stack-map.md` covers the current app's stack. When the rewrite's
stack (TypeScript itself, Electron, better-sqlite3, vitest, Zod) needs a translation, give it
in the turn, and if it'll come up again, add it to `references/rewrite-map.md` in this skill.
That's a notes file, not code. One or two nvim moves per turn, from the coach skill's
`references/nvim-moves.md`, when they fit what's being done.

## Closing

When the note's last step is green:
- write the Tour;
- the user opens the PR (or asks you to), its body ending `Tech: <key and title>` or
  `Story: <key and title>`;
- recap in a handful of lines: the seams they now own, the TypeScript and Electron ideas they
  met, and the nvim moves that came up;
- update the note in the vault (`pr`, and `status` once it merges).

---
name: away
description: Work through backlog notes unattended while the owner is away, then hand off so they can check the work when they're back at the laptop. Use when the owner says "while I'm away", "away:" followed by keys or "next up", "keep going while I'm out", or invokes /away, often from a phone or a cloud session. Build mode, one note at a time, and never more than one open PR. Not for pair or coach work, and not when the owner is at the keyboard following along.
---

# Away

The owner is away from the keyboard. They look at every PR before it merges, and check each
story in the packaged app when they're back at the laptop. So they want few PRs, each small,
and a trail they can read in two minutes: what was built, what was decided without them, and
what to check.

**The contract is in the vault.** Before the first note, read the vault `CLAUDE.md`'s "Working
while the owner is away" section: what goes in a note's Built section, the format of the To
check entries, what "checked" and "failed" mean, and how commits are worded. This skill is the
procedure around it.

## Starting

- Pull both repositories.
- Work out the run from what the owner said:
  - `away: <key>, <key>`: those notes, in that order.
  - `away: next up`: `ready` notes whose `depends_on` are all `done`, by the release's order,
    then the note that unblocks the most.
  - A key that isn't `ready`, or whose `depends_on` aren't `done`: skip it and say why in the
    handoff.
- **One open PR at a time.** Run `gh pr list --author @me --state open`. If one of yours is open,
  don't start a note: stop, as below.

## Each note

1. Read the note and everything in its `depends_on`. Set it to `doing` and commit the vault.
2. Branch and build it in **build mode**: the whole thing, tested, as `CLAUDE.md` describes.
   Rewrite work defaults to pair, but "away" is the owner choosing build. The Built section says
   so.
3. Check what you can: the tests, the type check, the linter, and anything the app lets you run
   headless. Whatever needs the packaged app, a window or a person becomes a To check step.
   Don't call those verified.
4. Open the PR as `CLAUDE.md`'s PR workflow says: the title, the body opening with the note, and
   **Worth your read** for rewrite work.
5. In the vault, write the note's Built section, its To check entry if it is a story, and the
   knowledge note that covers the area, if one does. Commit: `<key> built in PR <n>: …`.
6. **Stop.** The PR now waits on the owner.

A choice the note doesn't settle: if it's cheap to reverse, take the recommended option and list
it in the Built section's calls made. Otherwise file a decision note as the vault's `CLAUDE.md`
says, and stop.

## Stopping

Stop when a PR waits on review, when a decision blocks the note, or when nothing is ready. Then:

- commit the vault with the reason: `Away: stopped, PR <n> waits on review.`;
- end the chat with Done, Needs you and Next, short enough for a phone, with each PR as a link.

## When the owner merges

"Merged" means continue. Write the note's `pr`. A tech note, bug or chore is now `done`. A story
stays `doing` until the owner checks it: drop `, up for review` from its To check heading.
Commit `<key> merged as PR <n>; <next key> to doing.`, then take the next note in the run.

## When the owner comes back

They tick To check steps in the vault, then tell a session `<key> checked` or
`<key> failed: <step> — <what happened>`. The vault contract says what each one changes.

## Never

- Merge your own PR, or push to `main`.
- Tick a To check step, or set a story to `done` without the owner's "checked".
- Decide a decision.
- Open a second PR while one of yours waits.

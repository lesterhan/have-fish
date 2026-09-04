<!-- Length is earned by the difficulty of the decision, not the size of the diff.
     A 400-line refactor with one obvious approach is two sentences. A six-line
     change that picked between two defensible data models needs the paragraph
     saying why. Most PRs here are short.

     Spend words on: why not the obvious alternative, a constraint that isn't
     visible in the diff, a trade-off you'd be asked about in review anyway.
     Don't spend them on: restating the diff, listing changed files, narrating
     mechanical steps, or summarising a summary.

     If a sentence could be cut without losing anything, cut it. -->

<!-- Open with the problem or the finding, not "this PR adds…".
     What was broken, what was missing, or what needed to exist? Stakes before
     mechanics — it's what makes this readable in six months.

     Then say what changed and why, explaining the calls that aren't obvious from
     the diff: a data-model trade-off, why one approach beat another, a constraint
     that forced your hand. Skip the mechanical steps; the diff has those. -->

## Verification

<!-- What you ran and what it said — test counts, type checks, a pass in the browser
     or on a device.

     And say plainly what you could NOT check: "not verified on a device", "the
     density wants real eyes", "no test guards this". The honest gap is worth more
     than the passing count, and it's the first thing that gets dropped when you're
     tired. -->

## Review focus

<!-- Optional — delete when the diff speaks for itself.
     If you read one thing here, read this. Where's the risk, what's the judgment
     call you'd want a second opinion on, which screen needs looking at rather than
     reading. -->

## Epic

<!-- Optional — delete when this isn't epic work.
     Link the file in planning/epics/ so this stays findable from the roadmap. -->

<!-- Title: [scope] Imperative description — scope is the epic slug, or the area in one
     word. Epic stories add "Story N — ". See CLAUDE.md § PR Workflow.

     UI change? DESIGN.md §9 is the review checklist. -->

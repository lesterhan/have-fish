# planning/

What lives here, and the current app's epic workflow. The backlog itself is in the vault (root
`CLAUDE.md`, "Work tracking"); this folder holds designs and direction.

- `productionize/00-direction.md`: the product direction and its D-numbers. Read it before
  scoping anything that touches packaging, sync, or Fish Pie's availability.
- `desktop-rewrite.md`: how the rewrite is planned and the technical direction it starts from.
  The rewrite's stories and tech notes are in the vault, never in an epic file.
- `epics/`: designs for the current app's work. `ROADMAP.md` is their index.
- `TASKS.md` and `BUGS.md` are frozen. Their open items became GitHub issues, and those are being
  triaged into the vault.

## Epic workflow

This is for the current app, which takes fixes and the work already in flight. New features go
into the rewrite. An epic file is the design for its stories; each story's work item is a vault
note with `app: current`, or, until the triage is applied, its GitHub sub-issue.

### Picking up an epic: "let's pick up [epic name]"

1. Read the epic file. List its remaining stories as a numbered checklist so the owner can see
   the scope. If the epic touches the UI and has no `## UX brief` section, write one first
   (format in `DESIGN.md` §7) and confirm it before writing code.
2. Start the next story. Implement it fully — this is the current app, so build mode: complete,
   production-quality code with comprehensive tests.
3. Present a brief summary and **open a PR** against `main`, titled `[epic-slug] Story N — …`,
   its body ending with its note's trailer (`Chore:` or `Bug:` and the key and title), or
   `Closes #N` while its issue is untriaged. Share the PR link.
4. Wait for the owner to say they are done reviewing.
5. Re-read every file changed in the story and check for non-functional issues: security,
   performance, correctness, type safety, anything that would not pass a prod review. For UI
   stories, run the review checklist in `DESIGN.md` §9. Push any fix to the same branch.
6. Confirm the story is prod-ready. The owner merges on GitHub.
7. Move to the next story and repeat from step 2.
8. After the last story, ask whether the owner wants any tweaks before wrapping up.

### Wrapping up: "we're wrapping up [epic name]"

1. Move the epic file from `epics/` to `epics/archive/`.
2. In `ROADMAP.md`, set the epic's status to `Done` and point its link at the archive path.
3. If it still has a GitHub parent issue, close it with a one-line comment.
4. Confirm done.

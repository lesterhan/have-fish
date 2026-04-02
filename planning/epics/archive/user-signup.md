# Epic: User Sign-up

Enable new users to self-register so others on the tailnet can create their own accounts.

## Good news

The backend is already fully multi-user — every route filters by `userId`, every insert stamps it, and the schema has `userId` on all app tables. No data isolation work is needed.

## What's missing

1. `userSettings` is not auto-created when a new user registers — only the seed script does this today. New users would hit errors on any settings-dependent flow.
2. No sign-up UI — the login page only has a sign-in form.
3. Better Auth's sign-up endpoint needs to be confirmed wired and exposed.

## Stories

### Story 1 — Backend: auto-create userSettings on signup

Better Auth provides an `after` hook on user creation. Use it to insert a default `userSettings` row whenever a new user is created. This replaces the manual seed step.

The hook goes in `backend/src/app.ts` where Better Auth is initialized. Default values: `defaultAssetsRootPath = 'assets'`, `defaultLiabilitiesRootPath = 'liabilities'`, all account IDs null.

### Story 2 — Frontend: sign-up page

Add a `/signup` route with a simple form: email, password, confirm password. On submit call Better Auth's `signUp.email()` method. On success redirect to the dashboard.

The login page should link to sign-up and vice versa.

No email verification — this is a tailnet app, access is already gated by Tailscale.

---

## Out of scope

- Admin controls over who can sign up — Tailscale is the access gate
- Email verification
- Password reset (can add later)
- User management UI

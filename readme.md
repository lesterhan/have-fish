# have-fish 有鱼

Personal finance tracker that brings clarity to being unemployed. Built for self-hosting.

年年有余 `nián nián yǒu yǔ` is a common blessing for having left overs each harvest. 有鱼 `yǒu yǔ` to "have fish" is often substituted as a wordplay, with iconographies of fish as representing prosperity each Spring Festival.

## Vision

have-fish is built around a few core principles:

**Your data, your terms.** No bank connections, no third-party syncing. Transactions are entered manually or imported from a CSV exported directly from your bank. You stay in control of what goes in.

**Portable by design.** Data can be exported to an [hledger](https://hledger.org/)-compatible `.journal` file — a plain-text, human-readable format. If the server dies, you migrate to a new host or a different tool without losing anything.

**Built for a traveller's life.** Multi-currency is a first-class concern, not an afterthought. Tracking spending across currencies, with exchange rates, is a core workflow — not a workaround.

## Stack

- **Backend** — [Hono](https://hono.dev/) + [Bun](https://bun.sh/)
- **Frontend** — [SvelteKit](https://kit.svelte.dev/) + Svelte 5
- **Database** — PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Auth** — [Better Auth](https://www.better-auth.com/) (email + password)
- **Deployment** — Docker/Podman Compose

## Local Development

**Prerequisites:** Bun, Podman (or Docker)

```bash
# 1. start postgres
podman compose up postgres -d

# 2. backend
cd backend
cp .env.example .env      # fill in BETTER_AUTH_SECRET (openssl rand -base64 32)
bun install
bun run db:reset           # generate + apply migrations
bun run dev                # http://localhost:8887

# 3. create your user (first time only)
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword bun run src/seed-user.ts

# 4. frontend (new terminal)
cd frontend
bun install
bun run dev                # http://localhost:8888
```

## Running Tests

```bash
cd backend
bun test
# or in watch mode
bun run test:watch
```

## Full Stack (Docker/Podman)

```bash
# from project root
cp .env.example .env      # then fill in your values
podman compose up --build
```

Frontend at `http://localhost:8888`, backend at `http://localhost:8887`.

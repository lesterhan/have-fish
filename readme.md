# have-fish 有鱼

Personal finance tracker that brings clarity to being unemployed. Built for self-hosting.

年年有余 `nián nián yǒu yǔ` is a common blessing for having left overs each harvest. 有鱼 `yǒu yǔ` to "have fish" is often substituted as a wordplay, with iconographies of fish as representing prosperity each Spring Festival.

## Stack

- **Backend** — [Hono](https://hono.dev/) + [Bun](https://bun.sh/)
- **Frontend** — [SvelteKit](https://kit.svelte.dev/) + Svelte 5
- **Database** — PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Deployment** — Docker/Podman Compose

## Local Development

**Prerequisites:** Bun, Podman (or Docker)

```bash
# 1. start postgres
podman compose up postgres -d

# 2. backend
cd backend
cp ../.env.example .env   # then fill in your values
bun install
bun run db:reset           # generate + apply migrations
bun run dev                # http://localhost:3001

# 3. frontend (new terminal)
cd frontend
bun install
bun run dev                # http://localhost:3000
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

Frontend at `http://localhost:3000`, backend at `http://localhost:3001`.

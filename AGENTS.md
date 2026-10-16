# Repository Guidelines

## Project Structure & Module Organization

- `src/app/`: Next.js App Router pages and API routes.
- `src/components/`, `src/hooks/`, `src/types/`: shared UI, hooks, and contracts.
- `src/lib/`: Firebase Auth integration, commercial business logic, D1/R2 storage, and Sarin inference/queue.
- `tests/`: application tests; `scripts/`: local development and validation runners.
- `public/`: assets and fonts; `docs/`: design decisions and QA evidence.
- `landing/`: separate static marketing site; `cloudflare/`: application hosting; `deploy/`: VPS, Caddy, and Mac/Ollama templates.

## Build, Test, and Development Commands

Use Node 24 and pnpm 11.23.0. Run from the repository root; preserve the shared `pnpm-lock.yaml`.

- `pnpm install --frozen-lockfile`: install locked dependencies.
- `pnpm run dev`: start Next with configured Firebase.
- `pnpm run dev:local`: start Next and isolated Firebase emulators.
- `pnpm run typecheck`: check TypeScript; `pnpm run lint` currently runs the same check.
- `pnpm test`: run application tests.
- `pnpm run build` / `pnpm start`: build / serve the application.
- `pnpm run build:landing` and `pnpm run check:landing`: export and validate the marketing site.
- `pnpm --filter sarin-cloudflare-host run check`: test, typecheck, and dry-run the Worker.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, and semicolons; match surrounding quote style. Use PascalCase component exports, camelCase functions, and `useX` hooks. Follow neighboring filenames, such as `app-shell.tsx` and `useBusiness.ts`. Prefer `@/` imports for `src/`. No dedicated formatter or ESLint configuration is present.

## Testing Guidelines

Use Vitest with `tests/*.test.ts(x)`; Cloudflare uses Node's test runner with `cloudflare/tests/*.test.mjs`. Cover changed behavior, authorization boundaries, and failure cases. No numerical coverage threshold is configured.

Firebase tests require Java 21+: run `pnpm run test:rules`. With `dev:local` running, use `pnpm run test:local` and `pnpm run test:journey`. Use synthetic data and `demo-*` projects.

## Commit & Pull Request Guidelines

Follow existing English imperative subjects: `feat:`, `fix:`, `style:`, `chore:`, or `docs:`. Keep commits focused. PRs should explain behavior changes, link relevant issues, report validation, and include screenshots for UI changes. Review applicable checks in `.github/workflows/verify.yml`.

## Security & Architecture

Keep secrets and private exports outside Git. Avoid logging conversation bodies. The active product is the commercial appointment service; personal chat and Vault are retired. Removing the module must not silently purge browser data from earlier versions. Run one application replica: the inference queue is process-local. Remote Ollama requires HTTPS and Cloudflare Access Service Auth.

Use only `alsdevstudio.com` for Sarin's engine hostname. Never use `bptjersey.com`, including temporary tests.

## Agent Instructions

When requested to run `/graphify`, read and follow `~/.codex/skills/graphify/SKILL.md` before other work.

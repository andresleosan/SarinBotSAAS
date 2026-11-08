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

Sarin Bot owns the chatbot service landing, ALS Dev Studio administrative Hub and the shared API/runtime. AgendIA is the independent commercial appointment application in `E:/Proyectos/AgendIA`, with its own repository and UI deployment. Appointment UI changes belong in AgendIA; shared commercial API, data, inference and WhatsApp changes belong here. Keep the original protected engine and WhatsApp configuration intact. AgendIA reaches approved commercial API routes through its private service binding; never create a second data store or inference queue for it.

Keep secrets and private exports outside Git. Avoid logging conversation bodies. The active product is the commercial appointment service; personal chat and Vault are retired. Removing the module must not silently purge browser data from earlier versions. Run one application replica: the inference queue is process-local. Remote Ollama requires HTTPS and Cloudflare Access Service Auth.

Use only `alsdevstudio.com` for Sarin's engine hostname. Never use `bptjersey.com`, including temporary tests.

## Agent Instructions

When requested to run `/graphify`, read and follow `~/.codex/skills/graphify/SKILL.md` before other work.

## Fresha Implementation Workflow

Read `DESIGN.md` before planning or changing interfaces. It consolidates the approved Agenda clara system; generic skill recommendations must not silently replace its palette, typography, behavior, or scope.

Project skills are installed in `.agents/skills/`; read `docs/tooling/sarin-skills.md` for their real names, pinned sources, aliases, compatibility notes, and Playwright MCP setup. Use only skills relevant to the current task. Installation does not mean a review or acceptance has passed.

When the user invokes `/avanzar`, read `.agents/skills/avanzar/SKILL.md` and `docs/implementation/fresha/PLAN.md`. The approved workflow design is in `docs/superpowers/specs/2026-10-30-fresha-avanzar-workflow-design.md`. The first `/avanzar` after delivery of plan v1 records that version's review approval unless the message requests changes. Complete or resume exactly one task, then stop; a material unanswered question preserves the same task as `needs_input`.

`docs/implementation/fresha/tasks.json` is the sole progress authority. Run `node .agents/skills/avanzar/scripts/check-plan.mjs --next` from its `workspace.controlRoot`. Do not create a second mutable state file in a code worktree. Validate dependencies, generated build/integration children, evidence and all 165 requirement mappings before claiming progress. Do not count design/decomposition as implemented product. Regenerate `docs/implementation/fresha/progreso.html` with the saved state using the skill's renderer. Final Playwright MCP QA follows all construction; capability activation, real sends and final release effects retain their explicit approval gates.

The authorized consolidation of 2026-11-07 makes `E:/Proyectos/Sarin Bot` the canonical checkout on `main`, with `workspace.layout: "consolidated-main"` and both controlRoot and codeRoot pointing here. Keep this root on main. Implement product changes in a temporary isolated worktree based on this reconciled source, run product checks there, and integrate validated changes into main. Keep mutable progress only in controlRoot; archive temporary worktrees after integration and preservation of their remaining files. Historical mixed-checkout instructions describe the preserved backup, not the current root; never overlay older application files onto main.

After the AgendIA split, the single Fresha progress authority remains here. Scope each task to the appropriate repository before implementation, and record evidence against the actual repository and commit. Do not copy `tasks.json` into AgendIA or count this migration as completion of pending Fresha requirements.

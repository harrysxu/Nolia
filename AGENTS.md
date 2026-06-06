# Repository Guidelines

## Project Structure & Module Organization

Nolia is an Electron + React + TypeScript desktop app. Source lives in `src/`:

- `src/main/`: Electron main process, IPC, window/menu setup, and services.
- `src/preload/`: preload bridge code exposed to the renderer.
- `src/renderer/`: React UI, state, components, extensions, and CSS.
- `src/shared/`: shared constants, types, IPC channels, Markdown helpers, and extension metadata.
- `tests/`: Vitest unit tests; `tests/e2e/` contains Playwright browser tests.
- `docs/`: consolidated user, plugin, architecture, release, legal, and English help docs.
- `examples/plugins/`: local plugin examples.
- `build/`: packaging scripts and macOS signing assets.

Treat `dist/`, `release/`, `release-arch-compare/`, `test-results/`, `coverage/`, `playwright-report/`, `output/`, and `node_modules/` as generated output.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: run main watcher, Vite renderer, and Electron together.
- `npm run build`: build main and renderer outputs into `dist/`.
- `npm run typecheck`: run TypeScript strict checking with no emit.
- `npm run lint`: run ESLint on `src` and `tests`.
- `npm test`: run Vitest unit tests matching `tests/**/*.test.ts`.
- `npm run e2e`: run Playwright tests in `tests/e2e/`.
- `npm run package:unsigned`: create an unsigned macOS package.

Run `npm run typecheck`, `npm run lint`, and relevant tests before submission.

## Coding Style & Naming Conventions

Use TypeScript with strict types and React TSX for renderer UI. Follow the existing two-space indentation, semicolon, and double-quote style. Prefer named exports for shared helpers.

Use `PascalCase` for React components, `camelCase` for functions and variables, and service-style filenames such as `settingsService.ts`. Keep IPC channel names centralized in `src/shared/channels.ts` or `src/shared/ipc.ts`.

## Testing Guidelines

Add Vitest tests in `tests/` with the `*.test.ts` suffix. Use Playwright specs in `tests/e2e/*.spec.ts` for renderer workflows. For UI changes, include e2e coverage when behavior crosses components, IPC, or routing boundaries.

## Commit & Pull Request Guidelines

This checkout does not include `.git` history, so no repository-specific commit pattern is available. Use concise, imperative commit messages, optionally scoped, for example `renderer: fix markdown preview focus`.

Pull requests should include a short problem statement, implementation summary, test results, linked issue if applicable, and screenshots or recordings for visible UI changes. Note packaging impact when touching `build/`, Electron config, or release docs.

## Security & Configuration Tips

Keep Electron IPC boundaries explicit: validate renderer input in main-process services and avoid exposing filesystem access outside preload APIs. Do not commit local signing credentials, notarization secrets, workspace data, or generated release artifacts.

# Contributing

Thanks for improving Nolia. This project is an Electron, React, Vite, and TypeScript desktop app for local-first Markdown workspaces.

## Development Setup

```sh
npm install
npm run dev
```

Run checks before opening a pull request:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Use `npm run e2e` for workflows that touch editor behavior, IPC, file operations, or navigation.

## Pull Requests

- Keep changes focused and explain the problem being solved.
- Include test results in the PR description.
- Add screenshots or recordings for visible UI changes.
- Update docs when behavior, commands, packaging, or plugin APIs change.
- Do not commit `dist/`, `release/`, `node_modules/`, credentials, workspace data, or local private notes.

## Conduct

All project participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Code Style

Follow the existing TypeScript style: two-space indentation, semicolons, double quotes, `PascalCase` React components, and `camelCase` functions and variables.

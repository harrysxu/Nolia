# Nolia 1.0.0

Nolia is a local-first Markdown knowledge workstation for writing notes, organizing project documents, editing developer-friendly text resources, using controlled AI assistance, and extending the app with local plugins.

User documents stay in the workspace folder selected by the user. Markdown files are the primary data source; indexes, previews, semantic chunks, history snapshots, and caches are derived data that can be rebuilt.

## Features

- Local workspaces with file tree, recent files, favorites, search, backlinks, and outline navigation.
- Markdown edit, source, and split-preview modes with tables, links, images, formulas, Mermaid, tasks, footnotes, code blocks, and HTML handling.
- JSON and text resource editors plus previewers for images, PDF, audio, video, archives, and unknown files.
- AI Assistant with OpenAI-compatible and Ollama providers, explicit permissions, semantic index support, and user-confirmed write proposals.
- Local plugin runtime with manifest validation, permission confirmation, sidebar panels, file viewers, file editors, and commands.
- Cross-platform Electron packaging for macOS, Windows, and Linux.

## Documentation

- [Documentation Home](docs/README.md)
- [User Manual](docs/user/USER_MANUAL.md)
- [Plugin Guide](docs/plugins/PLUGIN_DEVELOPMENT.md)
- [AI Runtime](docs/ai-assistant-runtime/README.md)
- [Architecture Map](docs/architecture/CODEBASE_MAP.md)
- [QA Test Plan](docs/qa/README.md)
- [Release Checklist](docs/release/RELEASE_CHECKLIST.md)
- [Changelog](docs/release/CHANGELOG.md)
- [Privacy Statement](docs/legal/PRIVACY.md)
- [Terms](docs/legal/TERMS.md)
- [Third-Party Notices](docs/legal/THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Development

```sh
npm install
npm run dev
```

Release baseline:

```sh
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

Generated directories such as `dist/`, `release/`, `test-results/`, `coverage/`, `playwright-report/`, and `output/` should not be committed.

## Packaging

Unsigned local macOS build:

```sh
npm run package:unsigned
```

Windows installer and zip build:

```sh
npm run package:win
```

Linux build:

```sh
npm run package:linux
```

Per-architecture comparison builds:

```sh
NOLIA_SKIP_NOTARIZE=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --publish never
NOLIA_SKIP_NOTARIZE=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 --publish never
```

Formal distribution requires Developer ID signing and Apple notarization. See [Release Checklist](docs/release/RELEASE_CHECKLIST.md).

## License

Nolia is licensed under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

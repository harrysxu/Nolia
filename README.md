# Nolia

Nolia is a macOS local-first Markdown knowledge workstation for writing notes, organizing project documents, editing developer-friendly text resources, and extending the app with local plugins.

The app keeps user documents in the workspace folder selected by the user. Markdown files remain the primary data source; indexes, previews, and caches are derived data that can be rebuilt.

## Documentation

- [Documentation Home](docs/README.md)
- [User Manual](docs/user/USER_MANUAL.md)
- [Plugin Guide](docs/plugins/PLUGIN_DEVELOPMENT.md)
- [Architecture Map](docs/architecture/CODEBASE_MAP.md)
- [QA Plan](docs/qa/README.md)
- [Release Checklist](docs/release/RELEASE_CHECKLIST.md)
- [Changelog](docs/release/CHANGELOG.md)
- [Privacy Statement](docs/legal/PRIVACY.md)
- [Terms](docs/legal/TERMS.md)
- [Third-Party Notices](docs/legal/THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

## Development

```sh
npm install
npm run dev
```

Common checks:

```sh
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

## Packaging

Unsigned local macOS build:

```sh
npm run package:unsigned
```

Per-architecture comparison builds:

```sh
NOLIA_SKIP_NOTARIZE=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --publish never
NOLIA_SKIP_NOTARIZE=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 --publish never
```

Formal distribution requires Developer ID signing and Apple notarization. See [Release Checklist](docs/release/RELEASE_CHECKLIST.md).

## License

Nolia is licensed under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

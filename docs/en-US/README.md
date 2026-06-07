# Nolia Documentation

Nolia is a cross-platform local-first Markdown knowledge workstation built with Electron, React, Vite, and TypeScript for macOS, Windows, and Linux.

## Quick Start

1. Install the Nolia package for your operating system.
2. Open or create a workspace. The workspace is the folder Nolia reads and writes.
3. Create or open a `.md` / `.markdown` file.
4. Switch between Edit, Markdown Source, and Split Preview modes from the editor toolbar.
5. Use the activity bar for recent files, notes, favorites, search, and backlinks.

## Data and Formats

Nolia stores user documents in the selected workspace. The `.nolia/` folder contains derived indexes, snapshots, logs, and cache data.

Built-in handlers:

- Markdown: `.md`, `.markdown`
- JSON: `.json`
- Text: `.txt`, `.log`, `.csv`, `.yaml`, `.yml`, `.toml`, `.xml`, `.html`, `.js`, `.ts`, `.tsx`
- Resources: images, PDF, audio, video, archives, and unknown binary files
- Plugins may add more editors and previewers

## Markdown Editing

Edit mode renders common Markdown directly. Complex syntax such as tables, images, formulas, Mermaid, footnotes, code blocks, and HTML can be selected to edit the original Markdown source, then re-rendered after blur. Use `examples/markdown-syntax-test.md` for manual regression testing.

## Plugins

External plugins live in the global Nolia app data directory:

```text
macOS:   ~/Library/Application Support/Nolia/plugins/<pluginId>/
Windows: %APPDATA%\Nolia\plugins\<pluginId>\
Linux:   ~/.config/Nolia/plugins/<pluginId>/
```

Reload plugins from Settings, accept requested permissions, then enable the plugin. Permission changes require re-approval. See the Chinese [Plugin Guide](../plugins/PLUGIN_DEVELOPMENT.md) for the full API reference.

## Troubleshooting

- App cannot open: check OS security settings, package architecture, and file permissions.
- Recent workspace cannot open: confirm the folder still exists and is writable.
- File tree does not refresh: reload the tree or restart the app.
- Markdown complex syntax is hard to edit: switch to source mode or select the rendered node to edit source.
- Plugin does not appear: check `plugin.json`, plugin directory, permissions, and safe mode.

## Legal

- [Privacy Notice](legal/PRIVACY.md)
- [Terms of Use](legal/TERMS.md)
- [Third-Party Notices](legal/THIRD_PARTY_NOTICES.md)

## Development

```sh
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

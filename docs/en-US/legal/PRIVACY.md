# Nolia Privacy Notice

Effective date: 2026-05-31

This notice describes the current data handling model of Nolia. Nolia is a local-first desktop app. It does not provide official cloud sync and does not upload user notes to official servers by default.

## Local-First

Nolia is local-first. By default:

- No account registration is required.
- No official cloud sync is included.
- User notes are not uploaded to official servers.
- No built-in telemetry upload is enabled.
- User documents are stored in the local workspace selected by the user.

## Data the App Reads and Writes

The app accesses:

- Workspace folders selected by the user.
- Markdown, text, JSON, attachment, and resource files inside workspaces.
- Indexes, caches, logs, and snapshots in workspace `.nolia` directories.
- Settings, recent workspaces, and plugin state in the global app data directory.

Global app data directory:

```text
macOS:   ~/Library/Application Support/Nolia/
Windows: %APPDATA%\Nolia\
Linux:   ~/.config/Nolia/
```

## Derived Data

To provide search, backlinks, recent items, and resource indexing, the app derives data from Markdown files, such as:

- Titles.
- Plain body text.
- Tags.
- Links.
- Attachment references.
- Recently opened and edited records.

This data is stored locally.

## Plugins

External plugins may request additional permissions, such as reading the workspace, writing files, using the clipboard, or making network requests.

Nolia shows permission confirmation before enabling external plugins. Users should install plugins only from trusted sources.

Data access, file changes, or network transfer performed by external plugins depends on the plugin implementation and granted permissions.

## Network Access

The core app does not need to upload user notes by default.

Network access may occur when:

- The user opens external links.
- The user installs and enables a plugin with network permissions.
- The user enables AI Assistant and configures an OpenAI-compatible, OpenAI Responses, or other cloud model service.
- A future feature is explicitly enabled by the user.

When a cloud AI service is enabled, requests may include user prompts, current document excerpts, workspace search results, semantic index snippets, file names, or paths as context. Requests are sent to the model provider or gateway configured by the user. Nolia does not relay these requests through official servers. When local Ollama is used, requests are sent to the local Ollama service by default.

AI API keys are stored locally. The app prefers system secure storage; if system secure storage is unavailable, it uses fallback storage in the local app data directory.

## Diagnostics

Nolia writes local diagnostic logs for troubleshooting startup, window, workspace, plugin, and indexing issues. Diagnostic logs are not uploaded automatically.

Logs may include timestamps, error messages, window state, plugin IDs, workspace paths, file paths, or system error stacks. Logs should not include Markdown body content by default. Users can open logs from the app and decide whether to share them with maintainers.

## User Control

Users can:

- Choose the workspace location.
- Delete derived data in workspace `.nolia` directories.
- Delete the global app data directory.
- Disable or remove external plugins.

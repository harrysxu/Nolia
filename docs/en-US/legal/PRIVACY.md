# Nolia Privacy Notice

Effective date: 2026-05-31

This notice describes the current data handling model of Nolia. Before public release, the distributor should review it for the actual distribution channel, support contact, and legal jurisdiction.

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
~/Library/Application Support/Nolia/
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
- A future feature is explicitly enabled by the user.

## Diagnostics

The project includes diagnostic capabilities. Diagnostics should be used for troubleshooting and should not include Markdown body content by default.

Before public release, clarify:

- Whether diagnostics are collected.
- Whether diagnostics are exported manually by the user.
- Whether diagnostics include file paths, system version, stack traces, or plugin information.
- The support email or feedback channel.

## User Control

Users can:

- Choose the workspace location.
- Delete derived data in workspace `.nolia` directories.
- Delete the global app data directory.
- Disable or remove external plugins.


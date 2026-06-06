# Security Policy

Nolia is a local-first desktop app, so filesystem access, plugin behavior, and Electron IPC boundaries are security-sensitive.

## Reporting a Vulnerability

Please report security issues privately before opening a public issue. Include:

- affected version or commit;
- operating system;
- reproduction steps;
- expected and actual behavior;
- potential impact.

## Sensitive Files

Never commit signing certificates with private keys, `.p12` files, Apple notarization credentials, App-specific passwords, `.env` files, workspace data, or generated release artifacts.

# Nolia Windows QA Ledger

- Date: 2026-07-21
- Branch: `codex/nolia-upgrade`
- Commit baseline: `bfb07736` (worktree contains the fixes listed below)
- Environment: Windows 11 10.0.26200, ARM64 hardware; x64 was exercised through Windows ARM64 emulation
- User data: isolated fixtures; existing `%APPDATA%\Nolia` was backed up before installer tests

## Passed

- TypeScript strict check, ESLint, production build and preload verification
- Vitest: 155 passed, 4 skipped
- Renderer Playwright E2E: 118/118 passed
- Wikilink stress: 20/20 passed
- Performance budgets: 10k tree 691.47ms; edit p95 2.77ms; FTS 17.56ms; graph 0.83ms; AI transaction 349.95ms
- Installed ARM64 acceptance: 25/25 passed, including real SiliconFlow AI; watcher 273ms
- Installed x64 acceptance under ARM64 emulation: 16/16 passed; watcher 374ms
- Installed normal-use stability: 30 minutes, 334 cycles, 0 renderer errors, watcher/index/database ready, clean process exit
- ARM64 and x64 ZIP extraction: valid; `app.asar` hashes match their unpacked directories and each package contains `resources/docs`
- PE metadata: ARM64 `0xAA64`, x64 `0x8664`; both report Nolia 1.0.0.0
- NSIS install: 109 files present, main EXE and Electron DLLs present; desktop and Start Menu shortcuts resolve to the installed EXE; `.md`, `.markdown`, `.mdown`, and `.mkd` associations resolve to Nolia
- Uninstall: registry entry and shortcuts removed; workspace and user-data sentinels preserved

## Real AI

- Primary chat: `deepseek-ai/DeepSeek-V3.2`
- Fallback chat: `Qwen/Qwen3.5-9B`
- Embedding: `Qwen/Qwen3-Embedding-8B`
- Passed model listing/connectivity, encrypted secret storage, streaming chat, fallback compatibility, current-note context, summarize/translate/task/explain actions, workspace-search tools and source events, selection approval/transaction/undo, multi-file partial approval/undo, embedding indexing and hybrid search
- The API key was injected only into the test process. It is absent from the report, repository and subsequent shell environment.

## Packaging Fix

The default ARM64 NSIS 7z payload used an ARM64 executable filter that left the main EXE and Electron DLLs absent after installation. The working package configuration is now `nsis.useZip=true` with `nsis.differentialPackage=false`; the final ARM64 and x64 installers both use a ZIP payload and were installed successfully.

## Final Artifacts

The final four files are under `release/`.

| Artifact | SHA-256 |
| --- | --- |
| `Nolia-1.0.0-win-arm64.exe` | `146BD7621428CD3D127E79BEFA472DE544B4ACF84C73B0DDC1313E72C67888C4` |
| `Nolia-1.0.0-win-arm64.zip` | `194D34A235BBADB88C8718CA45422C30D7CB795731049E0DFD5C99C7DAA3EE7C` |
| `Nolia-1.0.0-win-x64.exe` | `AF4F0C59AFC884940C9960393B74A091B32009C42F61952CB65CD883C28A3F3E` |
| `Nolia-1.0.0-win-x64.zip` | `E2660C35D9D9E368EF408DC2EB9604531EE8BF2B88914921596769972BC6F33E` |

## Limits

- The artifacts are unsigned by configuration. SmartScreen/Gatekeeper-style reputation and signed-update behavior require a code-signing certificate and were not asserted.
- x64 results are valid functional/emulation results on ARM64 hardware; native x64 hardware performance remains unmeasured.
- The original 0.1.0 installation was exercised during diagnosis, but the final fixed installer was validated with clean install, overlay install, uninstall, and reinstall because no 0.1.0 installer artifact was available for a final reproducible rerun.

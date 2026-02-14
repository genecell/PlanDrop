# Changelog

All notable changes to PlanDrop will be documented in this file.

## 2.0.1

### New
- Dark mode with Auto/Light/Dark modes (Auto follows OS preference)
- Theme toggle in side panel header and settings page
- Activity feed colors harmonized for dark backgrounds

### Fixed
- Side panel recovers task state after tab switch or laptop sleep
- Stop button no longer stuck when task already completed on server
- Interrupt has 15-second timeout with automatic recovery
- Shared state across all side panel instances via chrome.storage
- All open side panels stay in sync
- Website domain updated to plandrop.ai

## [2.0.0] - 2026-02-11

### Added

**Claude Code Integration (Interactive Mode)**
- Full Claude Code sessions with plan-review-execute workflow
- Real-time activity feed showing Claude's thinking, file operations, and command outputs
- Session continuity using `--resume` flag for multi-turn conversations
- Permission profiles with CLI-level enforcement via `--disallowedTools`
- Stop button to interrupt running tasks
- Blocked command approval UI for reviewing denied commands
- Browser notifications for task completion
- Cost tracking per session and project
- History export (summary and full record with file contents)

**Permission Profiles**
- Plan Only: Read-only analysis, no execution
- Edit Files Only: File operations without shell access
- Standard: Blocks dangerous commands (sudo, rm -rf /, shutdown, etc.)
- Full Access: No restrictions (requires confirmation dialog)
- Custom: User-defined deny lists with template starting points

**Multi-Project Support**
- Dashboard view for managing multiple interactive projects
- Per-project watcher status with heartbeat monitoring
- Project lock mechanism to prevent conflicts between browser tabs
- Separate session management per project

**Architecture**
- Native messaging host for SSH communication
- File-based queue system (.plandrop/plans/ and .plandrop/responses/)
- plandrop-watch script for server-side orchestration
- plandrop-history for exporting task history

**Quick Drop Mode**
- Markdown editor with live preview
- Split view (edit/preview side-by-side)
- File collision detection with overwrite option
- Drag-and-drop file upload

### Changed
- Complete UI redesign with side panel interface
- Tab-based navigation between Claude Code and Quick Drop modes
- Collapsible config panel for connection status and settings
- Dark mode support following system preferences

### Security
- All permission enforcement happens at CLI level, not in prompts
- Blocked commands cannot be bypassed by prompt injection
- No cloud infrastructure: direct SSH communication only
- Open source: full audit trail available

## [1.0.0] - Initial Release

- Basic file drop functionality
- SSH-based file transfer to remote servers
- Server and project configuration

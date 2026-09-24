# xp-bar Specification

## Purpose
TBD - created by archiving change add-gamification. Update Purpose after archive.
## Requirements
### Requirement: Global, cross-project XP state
The system SHALL persist XP, rank, and streak state in a single global store under the pi agent's config root, shared across every project, rather than reset per repository.

#### Scenario: XP earned in one project, viewed in another
- **WHEN** the user earns XP while working in project A, then starts a session in project B
- **THEN** the XP total, rank, and streak shown in project B reflect the same global state accrued in project A

### Requirement: Quest-completion XP, size-tiered and dominant
The system SHALL award XP when a quest is marked done, scaled by the quest's size tag, and this source SHALL contribute the majority of a typical day's XP relative to the other sources.

#### Scenario: Completing quests of different sizes
- **WHEN** a small, a medium, and a large quest are each marked done
- **THEN** each awards XP according to its size tier, with large > medium > small

### Requirement: Commit-success XP (minor, unthrottled)
The system SHALL award a minor, fixed amount of XP whenever a `git commit` bash command completes with exit code 0, detected via the `tool_result` event, with no deduplication or rate limiting.

#### Scenario: Successful commit
- **WHEN** a bash tool call whose command matches `git commit` completes with exit code 0
- **THEN** the global XP total increases by the fixed commit-XP amount, every time, including repeated commits in the same session

#### Scenario: Failed commit
- **WHEN** a bash tool call whose command matches `git commit` completes with a non-zero exit code
- **THEN** no XP is awarded

### Requirement: Daily session-start streak (minor)
The system SHALL track a streak counter that increments at most once per calendar day on the first `session_start` event of that day, awards minor XP on increment, and resets to zero if a calendar day passes with no session.

#### Scenario: First session of a new day
- **WHEN** a `session_start` event fires and no session has started yet on the current calendar day
- **THEN** the streak counter increments by one and minor streak XP is awarded

#### Scenario: Second session on the same day
- **WHEN** a `session_start` event fires and a session already started earlier the same calendar day
- **THEN** the streak counter does not increment and no streak XP is awarded

#### Scenario: A day is skipped
- **WHEN** the most recent recorded streak day is more than one calendar day before today
- **THEN** the streak counter resets to zero before evaluating the current session's increment

### Requirement: Rank labels over a cumulative XP bar
The system SHALL display total XP as a cumulative bar and SHALL assign a named knight rank based on XP thresholds.

#### Scenario: Crossing a rank threshold
- **WHEN** total XP crosses a defined rank threshold
- **THEN** the displayed rank label updates to the new rank

### Requirement: Two-tier display
The system SHALL show XP, rank, and streak in an always-on compact status line, and SHALL show the active quest list only on demand in a separate widget, not permanently.

#### Scenario: Default view
- **WHEN** a session is active and no widget has been requested
- **THEN** the footer status line shows current XP/rank/streak, and no quest-list widget is shown

#### Scenario: Requesting the quest list
- **WHEN** the user requests the quest widget
- **THEN** the active quest list is displayed in a persistent widget until dismissed or replaced

### Requirement: Celebration on level-up or quest completion
The system SHALL emit a one-off, Sir-Peppy-voiced entry (reusing the existing entry-renderer pattern) when the rank changes or a quest is marked done, in addition to updating the status line.

#### Scenario: Ranking up
- **WHEN** total XP crosses a rank threshold
- **THEN** a celebratory entry is appended announcing the new rank, alongside the status-line update

#### Scenario: Completing a quest
- **WHEN** a quest is marked done
- **THEN** a celebratory entry is appended acknowledging the completed quest, alongside the status-line update


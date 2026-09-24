# quest-tracker Specification

## Purpose
TBD - created by archiving change add-gamification. Update Purpose after archive.
## Requirements
### Requirement: Explicit quest creation
The system SHALL create a quest only in direct response to an explicit user instruction, never on the agent's own initiative.

#### Scenario: User asks to add a quest
- **WHEN** the user explicitly asks the quest skill to add a quest, giving a freeform description and a size tag (small, medium, or large)
- **THEN** the skill appends a new entry (id, description, size, status: "active", createdAt) to that project's `tasks.json`

#### Scenario: Agent notices possible work
- **WHEN** the agent notices something that looks like it could be a quest (e.g. a TODO comment, an unfinished task)
- **THEN** the agent does not create a quest entry on its own; it may at most suggest one, and creation still requires an explicit user instruction

### Requirement: Explicit quest completion
The system SHALL mark a quest complete only in direct response to an explicit user instruction, never inferred by the agent from conversation or task state.

#### Scenario: User marks a quest done
- **WHEN** the user explicitly asks the quest skill to mark a given quest id as done
- **THEN** the skill sets that entry's status to "done" and records completedAt

#### Scenario: Agent infers work is finished
- **WHEN** the agent completes work that matches an active quest's description
- **THEN** the agent does not mark that quest done on its own; it may prompt the user to confirm completion, but the status change requires the user's explicit instruction

### Requirement: Per-project, centralized quest storage
The system SHALL store each project's quests in a `tasks.json` centralized under the pi agent's own config root, keyed by project path, and SHALL NOT write quest state into the user's project repository.

#### Scenario: Quest created in a given project
- **WHEN** a quest is created while working in a given project directory
- **THEN** it is written to that project's keyed store under the pi agent config root (following the same path-keying convention as `sessions/`), and no file is created inside the project's own repository


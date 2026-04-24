# CLAUDE.md — STAT Baseball App

This file is the source of truth for the STAT project. Read it fully at the start of every session.

---

## Project Overview

**STAT** is a mobile-optimized, browser-based baseball statistics application. Users search for MLB players or teams and see their stats displayed as swipeable cards. The app is fast, minimal, and built for baseball fans who want quick access to real stats without friction.

---

## Goals

1. **Speed and ease of use** — Fast search with autocomplete; results appear immediately
2. **Clarity and simplicity** — Data in tables and charts should be easy to read, never dense
3. **Built to scale** — Start simple, but architecture and code should support future feature additions

---

## Visual Direction

Ivo will provide detailed design specs in Phase 2. During Phase 1 sketches, use these principles:

- **Spacious** over dense — generous whitespace, breathing room between elements
- **High contrast** — strong foreground/background relationships
- **Dark theme** preferred over light
- **Typography** — Use sans serif fonts like Inter (sans-serif) for UI; not serif fonts — Heavy bold and regular, not thin styles.
- **Minimize boxes and borders** — use space and typography to create structure, not containers
- **Minimal color** — near-monochrome base with one bright accent color for highlights and CTAs
- **Layout** - the focus is on the stats, not the player name and ancillary information. Use table structures to display stats.
---

## Technical Stack

### Frontend
- HTML, CSS, JavaScript (no framework unless Ivo approves)
- Mobile-first, responsive across all screen sizes
- Browser `localStorage` for saving card stacks (no database, no login)

### Backend
- None — this is a fully static application. No server, no Python, no backend framework.

### Data Sources
| Source | Used For |
|---|---|
| MLB Stats API | All data — player search, bio, headshot, and season stats |

**Key MLB Stats API endpoints:**
| Endpoint | URL |
|---|---|
| Player search | `https://statsapi.mlb.com/api/v1/people/search?names={query}` |
| Player stats | `https://statsapi.mlb.com/api/v1/people/{id}/stats` |
| Team stats | `https://statsapi.mlb.com/api/v1/teams/{id}/stats` |
| Headshot | `https://img.mlbstatic.com/mlb-photos/image/upload/w_180/v1/people/{id}/headshot/67/current` |

Note: The MLB Stats API is public and free but not officially documented. It is well-mapped by the community and reliable for this use case.

### Constraints
- No paid APIs or services — zero cost to run
- No Claude API usage
- No database
- No user accounts or login (Phase 1 scope)

---

## User Flow

1. User loads the app URL
2. First view: focused search field with a toggle to search **Player** (default) or **Team**
3. User types a name and hits **GO**
4. A player or team card appears prominently
5. If no data is found: show `"No data available — try [random MLB player name]"`
6. Search bar minimizes but stays accessible for additional searches
7. Each search result stacks — user can swipe through their search history
8. User can save their card stack to `localStorage`

---

## Data Specifications

### Player Card — Info
- Headshot photo
- Name, team, years in MLB (minors and majors)

### Player Card — Batter Stats
**Highlights:** AVG, OPS, WAR

| Stat | Description |
|---|---|
| HR | Home runs |
| RBI | Runs batted in |
| OBP | On-base percentage |
| SLG | Slugging percentage |

### Player Card — Pitcher Stats
**Highlights:** ERA, WHIP, WAR

| Stat | Description |
|---|---|
| W-L | Win-loss record |
| IP | Innings pitched |
| SO | Strikeouts |

Note: Pitch arsenal chart (Statcast data) is out of scope for Phase 1–3. Flagged as a future feature requiring a Python/pybaseball backend.

### Team Card
**Highlights:** W/L record, MLB rank, Division rank

| Section | Data |
|---|---|
| Team batting | Aggregate batting stats |
| Team pitching | Aggregate pitching stats |
| Recent results | Last 3 games — opponent and score |

### Timeframes
- Current season
- Last season
- Best season — defined as the season with the highest WAR

---

## Project Phases

### Phase 1 — Sketch and Iterate (Low Fidelity)
- Ivo provides visual and written context per session
- Claude generates **multiple** HTML layout options — be divergent, offer real alternatives
- Ivo reviews and gives feedback; Claude iterates
- Output: HTML prototypes only, no backend needed yet

### Phase 2 — Design Refinement (High Fidelity Design)
- Claude exports HTML prototypes to Figma using the "Send UI to Figma" MCP tool
- Ivo works in Figma to produce pixel-perfect designs
- Ivo returns Figma design specs to Claude as the build target

### Phase 3 — Application Build (High Fidelity Code)
- Claude builds the full application from Figma specs
- Hosting target: **GitHub Pages or Netlify** — both are free and require zero configuration for a static JS app
- Output: working, hosted application

---

## Working Preferences

- **Phase 1: be divergent.** Offer multiple design and UI directions. Don't converge prematurely.
- **Phase 3: follow direction.** Ivo will be prescriptive; execute with precision.
- **Tech decisions: always ask.** If there is ambiguity about which library, framework, API approach, or architecture pattern to use — stop and ask Ivo. Do not make assumptions.
- **Quality over speed.** A thoughtful, well-considered output is always preferred over a fast one.
- **Ask rather than assume** on any decision that would be hard to reverse.

---

## Git Workflow

All work after the initial deploy uses a feature-branch → PR → merge workflow:

1. **Start of session:** create a branch off `main` — name it descriptively, e.g. `feature/pitcher-stats` or `fix/autocomplete-mobile`
2. **Commit** changes to the feature branch
3. **Open a PR** into `main` using `gh pr create`
4. **Ivo reviews and merges** — merging to `main` triggers the GitHub Pages deploy

`main` is the deploy branch — never commit directly to it after the initial release.

---

## Resolved Decisions

- **Backend:** None. Pure static HTML/CSS/JS app.
- **Data source:** MLB Stats API only. pybaseball and Statcast deferred to a future phase.
- **Hosting:** GitHub Pages — live at https://ovidovi.github.io/STAT
- **Pitch arsenal chart:** Out of scope for current phases. Future feature.

---

## Session Startup Checklist

At the start of each Claude Code session:
1. Read this file fully
2. Check which phase the project is in
3. Ask Ivo what the session goal is before starting any work
4. Do not carry over assumptions from a previous session — confirm current state
5. Create a feature branch before writing any code (see Git Workflow above)

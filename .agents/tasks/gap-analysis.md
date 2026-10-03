# MED ARC Study Planner — Gap Analysis Report

**Date:** 2025-07  
**Codebase reviewed:** `index.html`, `server.js`, `app-server.cjs`, `service-worker.js`, `manifest.webmanifest`, `package.json`, `README.md`, `docker-compose.yml`

---

## Executive Summary

MED ARC is a well-designed, single-page study planner with a clean UI, a weekly calendar, a Pomodoro-style focus timer, basic notes, and subject management. It stores all state as a single JSON blob in a PostgreSQL database, synced via two API endpoints. The front-end is a self-contained ~1 200-line minified script inside `index.html` with no build step, no tests, and no module boundaries.

**The app is a solid skeleton, but several features essential to a progress recorder are entirely absent.** There is no multi-user support (one shared dataset for anyone with the URL), no analytics or history charts, no streak granularity beyond a simple daily counter, no goal setting, no per-subject time tracking, no reminders or notifications, no export, and no accessibility baseline beyond a handful of `aria-label` attributes. The backend is a single-row key-value store — the entire app state is one JSON blob — which makes reporting, filtering, and multi-user support structurally impossible without a schema redesign.

Priority breakdown of findings: **4 Critical · 8 High · 9 Medium · 6 Low**

---

## What the App Currently Does

| Area | What exists |
|---|---|
| **Dashboard** | Today's sessions, progress ring (% done today), study-time-today counter, next-up session, weekly mini-preview, static three-item "before you begin" checklist, daily motivational quote |
| **Calendar** | 7-day week grid; navigate ±1 week; click "+" on a day to add a session; sessions and exams shown as colour-coded chips |
| **Subjects** | Add / edit (prompt dialog) / delete subjects with custom colours; per-subject session count; "add session" shortcut |
| **Tasks / Sessions** | Add, edit, delete study sessions; fields: topic, subject, date, start time, duration, exam/deadline flag; filter all/upcoming/done; mark complete with checkbox |
| **Focus Timer** | 25-min focus / 5-min break toggle; start/pause/reset; completing a session increments the streak counter; no task linkage |
| **Notes** | Create / edit / delete free-text notes (title + body); "convert to task" converts the note to a pre-filled task form |
| **Streak** | Counts consecutive days that have at least one `sessions[]` entry; shown in the sidebar widget |
| **Sync** | On load: `GET /api/state` pulls the server blob and overwrites local; on any save: debounced `PUT /api/state` pushes the full blob; falls back to `localStorage` when server is unavailable |
| **PWA** | Service worker caches the shell (HTML, manifest, icon); offline loads the cached shell; API calls are not cached |
| **Dark mode** | Full CSS dark theme, toggled by a button, persisted to `localStorage` |
| **Deployment** | Docker Compose with Postgres 16; `Dockerfile`; `.env.example` |

---

## Gap Analysis

### Category 1 — Features

#### CRITICAL

**C-1 · No multi-user / authentication**  
The README itself warns: *"anyone who can access its URL can view and change that data."* The server has a single row (`id = 1`) in `planner_state`. Any two people opening the app simultaneously will overwrite each other's data on the next `PUT /api/state`. There is no concept of a user account, session, or access token anywhere in `server.js` or `index.html`.  
*Impact:* The app cannot be used by more than one person (or on more than one browser tab simultaneously) without data corruption.

**C-2 · Single-blob data model cannot support analytics or history**  
`server.js` stores and retrieves the whole app state as one opaque `JSONB` column. The `sessions[]` array records only `{date, taskId}` — no duration, no subject, no start/end timestamps. Historical study data is therefore impossible to query server-side. Deleting a task deletes its associated session records too (they share the same `taskId`, which is gone). This is a structural blocker for any progress-recording features.  
*Evidence:* `server.js` lines 44–58 (single row upsert); `index.html` `bindTaskActions` — on delete: `data.tasks = data.tasks.filter(x => x.id !== b.dataset.delete)` with no session cleanup.

**C-3 · No analytics or progress history**  
The app records zero historical metrics beyond a single-day streak counter. There is no chart of hours studied per week, no subject breakdown, no completion-rate trend, no best-day or longest-streak display. For an app described as a *progress recorder*, this is the largest functional gap.

**C-4 · Focus timer does not log actual time spent**  
When a Pomodoro completes, `data.sessions.push({date: day(), taskId: null})` is called — `taskId` is always `null`, and the duration is not recorded (index.html, `timerToggle` click handler). The timer has no way to associate the completed session with the task the user was working on. Study-time-today on the dashboard only sums `duration` of *manually checked-off* tasks, not actual timer completions.

---

#### HIGH

**H-1 · No goal setting**  
Users cannot set a weekly or daily study-hour target. There is no "goal: 20 hours/week" feature, no progress bar toward a goal, and no way to see whether they are on track.

**H-2 · No reminders or push notifications**  
There is no browser Notification API usage, no scheduled reminder, no email/SMS integration. A study planner without reminders means users must remember to open the app themselves.

**H-3 · No recurring tasks / schedules**  
Every session must be added individually. Students typically study the same subject at the same time each week (e.g., "Maths every Monday at 4 pm"). There is no repeat/recurrence option on the task form.

**H-4 · No data export**  
Users cannot export their study history, notes, or schedule to CSV, PDF, or iCal. If they want to switch devices, print a schedule, or back up their data independently of the server, they have no mechanism to do so.

**H-5 · Notes are not linked to subjects or tasks**  
Notes have a `title` and `body` only — no subject tag, no date, no link back to a task. The notes list is unsortable and unsearchable. "Convert to task" loses the note's content (body is only partially mapped to the topic field, truncated to 70 chars).

**H-6 · Subject-level progress is missing**  
`renderSubjects()` shows only a raw count of *planned* sessions per subject ("3 planned sessions"). There is no completion rate, no hours spent, no colour-coded progress bar, and no "sessions due this week" per subject.

**H-7 · Streak logic is fragile and incomplete**  
The streak is recalculated from `data.sessions[]` every render. If that array is cleared, corrupted, or the task is deleted, the streak is silently reset. There is no longest-streak stored, no "missed days" tolerance option, and no visual streak calendar (GitHub-style heatmap).

**H-8 · No search or filter on tasks/notes**  
The task list has an all/upcoming/done filter but no keyword search, no date-range filter, no multi-subject filter, and no sort order control. Notes have no search at all.

---

### Category 2 — UX / UI

#### HIGH

**U-1 · No onboarding for new users**  
The app launches with four hardcoded sample subjects (Mathematics, Biology, History, English) and five hardcoded sample tasks. New users — especially those not studying those subjects — see confusing pre-populated data with no explanation. There is no welcome walkthrough, empty-state guidance, or "clear sample data" button.

**U-2 · `prompt()` and `confirm()` dialogs for subject management**  
`renderSubjects()` uses `window.prompt()` to edit a subject name and `window.confirm()` to delete one. These are OS-level blocking dialogs — they look inconsistent, cannot be styled, are blocked in some browser contexts (iframes, certain mobile browsers), and break the app's own polished modal pattern.

#### MEDIUM

**U-3 · Focus timer has no task-linkage UI**  
The Focus page has no way to say "I'm working on task X." The timer is completely disconnected from the task list. Users must mentally track which task they are timing.

**U-4 · Calendar is week-only; no month view**  
There is no monthly overview. Users planning more than a week ahead must navigate one week at a time, with no at-a-glance view of the month.

**U-5 · Dashboard "This week" shows only 4 items**  
`index.html` `renderDashboard`: `.slice(0, 4)` hard-limits the mini-week preview to 4 items even if more exist. There is no "show more" affordance.

**U-6 · No visual feedback for unsaved / syncing state beyond a text label**  
The sync status is a tiny 10px text label (`#syncStatus`). There is no spinner, no colour-coded indicator, and no retry button when sync fails.

**U-7 · Mobile nav collapses to icon-only with no tooltip or label**  
At `max-width: 780px` the sidebar collapses to 68px and all nav labels are hidden (`display: none`). The icons used (⌂, ▦, ◈, ☷, ◷, ▤) are not universally recognisable. There is no bottom tab bar alternative for phone screens.

**U-8 · Task "three-dot" menu is a per-row edit+delete pair, not a real menu**  
Each task row has two bare icon buttons (✎ and ×) with no confirmation for delete except the global toast. At `max-width: 480px`, `task-menu` is `display: none`, making edit and delete inaccessible on phones.  
*Evidence:* CSS `.task-menu{display:none}` in the 480px media query.

---

### Category 3 — Technical

#### CRITICAL (shared with Features above — see C-1, C-2)

#### HIGH

**T-1 · No input validation on the client for dates**  
The task form accepts any `date` the browser `<input type="date">` allows, including dates years in the past or far future, with no warning. There is no validation that `end time` > `start time`, and no guard against duplicate sessions at the same time.

**T-2 · No automated tests**  
There are no unit tests, integration tests, or end-to-end tests anywhere in the project. `package.json` has no `test` script. The entire app logic is one minified IIFE inside `index.html`, making any future refactor highly risky.

#### MEDIUM

**T-3 · All JS is a single minified IIFE in `index.html`**  
There is no build pipeline, no module system, and no separation of concerns. Adding features means editing a dense, hard-to-read inline script. The `app-server.cjs` file (1 007 bytes) appears to be an unused older server variant — it is never referenced in `package.json`, `Dockerfile`, or `docker-compose.yml`.

**T-4 · `crypto.randomUUID()` used without polyfill check**  
`crypto.randomUUID()` is not available in older browsers or non-secure contexts (HTTP). The app silently breaks on those environments without a fallback.

**T-5 · Server has no rate limiting**  
`server.js` uses no rate-limiting middleware. Any client can send unlimited `PUT /api/state` requests (up to 1 MB each), enabling easy denial-of-service or storage flooding.

**T-6 · No CORS headers; missing Content Security Policy**  
The server sets `X-Content-Type-Options` and `Referrer-Policy` but no `Content-Security-Policy` header, leaving the app open to XSS escalation. There are no CORS headers, which would block legitimate cross-origin use cases.

**T-7 · `data.sessions` array grows unbounded**  
Every completed Pomodoro and every task completion appends to `data.sessions[]`. There is no pruning, archiving, or maximum-age logic. Over months of use, this array will grow large and slow down the debounced sync (the entire blob is PUT on every change). The server enforces a limit of 10 000 sessions, after which saves will return 413 silently from the user's perspective (the toast only says "Could not sync right now").

---

### Category 4 — Data

#### CRITICAL (see C-2 above)

#### MEDIUM

**D-1 · Server-side state overwrites local state on every load**  
`syncWithServer()` unconditionally replaces `data` with whatever the server returns on load. If the server has stale data (e.g., after a DB restore), the user's newer local changes are silently discarded with no conflict-resolution prompt.

**D-2 · No backup or export mechanism**  
There is no admin endpoint to dump state, no scheduled backup script, and no in-app export. The Docker volume is the only backup path, and it requires manual intervention.

**D-3 · Deleting a task does not clean up session records**  
When a task is deleted, `data.sessions` retains entries with the deleted `taskId`. These orphaned records contribute to the streak counter and `sessions.length` count but point to nothing. Over time this silently inflates session counts.  
*Evidence:* `bindTaskActions` delete handler — only `data.tasks` is filtered; `data.sessions` is untouched.

---

### Category 5 — PWA

#### MEDIUM

**P-1 · Only one icon — no PNG fallbacks**  
`manifest.webmanifest` lists a single SVG icon with `"purpose": "any maskable"`. iOS Safari requires PNG icons (`apple-touch-icon`) and does not support SVG manifests. Android Chrome requires PNG icons at 192×192 and 512×512 for the "Add to Home Screen" install prompt to work reliably.

**P-2 · No offline fallback for API calls**  
The service worker explicitly bypasses `/api/` paths (`requestUrl.pathname.startsWith('/api/')`). When offline, the app loads from cache but all sync attempts silently fail. There is no offline queue to replay writes when connectivity returns.

**P-3 · Service worker has no background sync**  
There is no `BackgroundSync` API registration. If the user closes the app while offline after making changes, those changes exist only in `localStorage`. If another device synced in the meantime, the local changes will be overwritten on the next load (see D-1).

**P-4 · `display: standalone` but no splash screen config**  
`manifest.webmanifest` sets `display: standalone` but has no `screenshots`, no `categories`, and no `shortcuts`. This limits the install experience and the app's discoverability in app stores or browser install dialogs.

#### LOW

**P-5 · No periodic background sync for reminders**  
There is no `PeriodicBackgroundSync` registration. Push notifications and background data refresh are entirely absent.

---

## Prioritised Recommendations

### Critical — Fix Before Anything Else

| # | Recommendation | Effort |
|---|---|---|
| C-1 | Add user authentication (at minimum, a simple PIN/password or OAuth) and per-user state rows in the DB | High |
| C-2 | Redesign the data model: separate `users`, `subjects`, `tasks`, `sessions` tables; record `duration_minutes`, `subject_id`, `started_at`, `ended_at` per session | High |
| C-3 | Build an analytics page: weekly hours chart, per-subject breakdown, completion rate trend | Medium |
| C-4 | Link the focus timer to a selected task; log actual start/end time and duration to the sessions table on completion | Medium |

### High — Core Functionality Gaps

| # | Recommendation | Effort |
|---|---|---|
| H-1 | Add weekly / daily study-hour goal setting with a progress bar on the dashboard | Low |
| H-2 | Implement browser Push Notifications for upcoming sessions (Notification API + service worker) | Medium |
| H-3 | Add recurrence options to the task form (daily, weekly, custom days) | Medium |
| H-4 | Add CSV and iCal export from the tasks page | Low |
| H-5 | Add subject tag and search to notes | Low |
| H-6 | Show per-subject hours spent, completion %, and a mini progress bar on subject cards | Low |
| H-7 | Persist streak data independently; add longest-streak and a heatmap calendar | Medium |
| H-8 | Add keyword search and date-range / multi-subject filters to tasks and notes | Low |
| U-1 | Replace hardcoded sample data with a proper onboarding flow (name, subjects, first session) | Low |
| U-2 | Replace `prompt()` / `confirm()` with proper modal dialogs for subject edit/delete | Low |
| T-1 | Add client-side validation: no past-date warning, time-overlap detection | Low |
| T-2 | Set up a test suite (Vitest recommended given the Node 22 baseline) | Medium |
| T-5 | Add rate limiting middleware (e.g., `express-rate-limit`) to `server.js` | Low |

### Medium — Polish and Robustness

| # | Recommendation | Effort |
|---|---|---|
| U-3 | Add a task-selector to the Focus Timer page | Low |
| U-4 | Add a monthly calendar view alongside the week view | Medium |
| U-5 | Remove the `slice(0, 4)` cap on the mini-week preview or add a "show all" link | Low |
| U-6 | Replace the text sync-status with a visual indicator (spinner + colour) | Low |
| U-7 | Add a bottom tab bar for mobile screens | Low |
| U-8 | Restore edit/delete to mobile task rows (move to a slide-out or long-press menu) | Low |
| T-3 | Extract JS to a separate `app.js` file; introduce a simple build step | Medium |
| T-4 | Add a `crypto.randomUUID()` polyfill or replace with a small UUID helper | Low |
| T-6 | Add `Content-Security-Policy` header in `server.js` | Low |
| T-7 | Add periodic pruning of `data.sessions` older than 90 days, or migrate to proper DB rows | Low |
| D-1 | Implement a last-write-wins timestamp or simple conflict-resolution UI | Medium |
| D-3 | Clean up orphaned session records when a task is deleted | Low |
| P-1 | Generate PNG icons (192px, 512px) and add `apple-touch-icon` meta tag | Low |
| P-2 | Implement a `localStorage` write-queue that replays on reconnect | Medium |

### Low — Nice-to-Have

| # | Recommendation | Effort |
|---|---|---|
| L-1 | Add `manifest.webmanifest` `shortcuts` for "Start Focus" and "Add Session" | Low |
| L-2 | Add `categories: ["education", "productivity"]` to the manifest | Low |
| L-3 | Remove or document `app-server.cjs` (it is unused dead code) | Low |
| L-4 | Add a "Study Tips" or resource-linking feature per subject | Low |
| L-5 | Add keyboard shortcuts (e.g., `N` for new session, `F` for focus timer) | Low |
| L-6 | Add an accessibility audit pass: color-contrast check (blue-on-white in `--muted` may fail WCAG AA), focus-ring visibility, screen-reader landmark roles | Medium |

---

## Quick Wins (Low Effort, High Impact)

These can be added in a few hours each without a schema change:

1. **Replace `prompt()` / `confirm()` with modals** — The modal pattern is already built; reuse it for subject edit/delete. Unblocks mobile users immediately.
2. **Add weekly study-hour goal** — One extra field in `data` (e.g., `weeklyGoalMinutes`), one input in settings, one progress bar on the dashboard.
3. **Clean up orphaned sessions on task delete** — One line: `data.sessions = data.sessions.filter(s => s.taskId !== id)` in the delete handler.
4. **Remove the `slice(0, 4)` cap** on the mini-week preview and add a "View all →" link.
5. **Restore task edit/delete on mobile** — Remove `.task-menu{display:none}` from the 480px breakpoint and switch to a compact icon or slide-reveal pattern.
6. **Add PNG icons** — Run the SVG through a converter, add 192/512 PNGs to the manifest, add `<link rel="apple-touch-icon">` to `<head>`.
7. **Add CSV export** — A `data:text/csv` download link built from `data.tasks` is ~20 lines of JS.
8. **Add keyword search** to the task list — One `<input>` + a filter on `t.topic.toLowerCase().includes(query)`.
9. **Add rate limiting** — `npm install express-rate-limit` + 5 lines in `server.js`.
10. **Add a task selector to the Focus Timer** — A `<select>` populated from `data.tasks.filter(t => !t.done)`, storing the selected `taskId` when the timer completes.

---

## Appendix — File / Symbol Citations

| Finding | File | Evidence |
|---|---|---|
| C-1 single-row DB | `server.js:49–58` | `WHERE id = 1` / `ON CONFLICT (id)` |
| C-2 session shape | `index.html` `bindTaskActions` | `data.sessions.push({date, taskId})` — no duration |
| C-4 timer null taskId | `index.html` `timerToggle click` | `data.sessions.push({date: day(), taskId: null})` |
| T-2 no tests | `package.json` | No `test` script |
| T-3 dead file | `app-server.cjs` | Not referenced in any config |
| D-3 orphaned sessions | `index.html` `bindTaskActions` delete | Only `data.tasks` filtered, not `data.sessions` |
| U-2 prompt/confirm | `index.html` `renderSubjects` | `window.prompt(...)`, `confirm(message)` |
| U-8 hidden mobile menu | `index.html` CSS 480px breakpoint | `.task-menu{display:none}` |
| P-1 SVG only icon | `manifest.webmanifest` | Single `image/svg+xml` entry, no PNG sizes |
| P-2 SW bypasses API | `service-worker.js` fetch handler | `requestUrl.pathname.startsWith('/api/')` — returns without caching |

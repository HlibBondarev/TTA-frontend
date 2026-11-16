---
description: End-to-end feature/fix delivery workflow (Issue -> Branch -> Code -> Tests -> Commit -> PR -> Review fixes)
---

Follow this sequential delivery workflow for any new feature, bug fix, or refactoring task:

1. **Draft GitHub Issue (Raw Markdown)**:
   - Before writing code or creating branches, output a clean, ready-to-copy GitHub Issue in a **Raw Markdown** code block (`markdown`) written in English.
   - Include: `Title`, `Summary / Context`, `Acceptance Criteria` (checklist), and `Technical Scope` (affected features/components, hooks, services, and tests).
   - Wait for the user to confirm the Issue (and optionally provide the Issue number) before proceeding.

2. **Create Dedicated Branch**:
   - Ensure local `dev` is up to date, then create and switch to a dedicated branch from `dev` (e.g., `feature/<issue-number>-<short-slug>` or `fix/<issue-number>-<short-slug>`). Never commit directly to `main` or `dev`.

3. **Implement Code**:
   - Follow all repository rules in `.agents/rules/tta-frontend.md` (feature-based structure, declarative React components, Dexie offline-first sync, strict TypeScript without `any`, `ModalDialog` + `inert` accessibility, SonarCloud cognitive complexity < 15).

4. **Write & Run Unit Tests**:
   - Add or update Vitest + `@testing-library/react` unit tests under `src/features/<feature>/tests/` (or `src/tests/`).
   - Run full verification from the repository root:
     - `npm run lint`
     - `npm test -- --run`
     - `npm run build`

5. **Commit Changes**:
   - Stage changes and create a clear Conventional Commit message in English (`feat: ...`, `fix: ...`, `test: ...`) describing what changed and why.

6. **Prepare Pull Request (Raw Markdown)**:
   - After pushing the branch, output a ready-to-copy Pull Request title and description in a **Raw Markdown** code block (linking `Closes #<issue-number>`, summarizing changes, and listing verification steps).

7. **Address SonarCloud & CodeRabbit Review Findings**:
   - When review comments are provided, verify each finding against the actual codebase.
   - Fix only valid issues with minimal, surgical edits; skip false positives or out-of-scope nitpicks with a brief technical justification.
   - Re-run `npm run lint`, `npm test -- --run`, and `npm run build` before pushing review fixes and draft concise English replies for the reviewer.

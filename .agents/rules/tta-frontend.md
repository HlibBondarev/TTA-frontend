---
name: tta-frontend
trigger: always_on
description: Core engineering standards, architecture patterns, accessibility guidelines, and verification workflows for the TTA frontend repository.
---

# TTA Frontend Engineering Standards

This document establishes the official engineering guidelines, architecture patterns, code quality standards, and verification workflows for the `TTA-frontend` project. All changes must adhere strictly to these principles.

---

## 1. Language & Documentation

- **Strict English Standard**: Write all code comments, JSDoc annotations, unit test descriptions, commit messages, PR descriptions, and technical documentation strictly in English.
- **Consistent UI Copy**: Keep UI labels, placeholders, buttons, and user-facing strings consistent with existing component language (English by default unless explicit multi-language localization is introduced).

---

## 2. Project Architecture & TypeScript

- **Feature-Based Modules**: Follow the feature-sliced directory structure under `src/features/<feature>/`:
  - `components/` — UI presentation components for the feature.
  - `hooks/` — Custom hooks encapsulating feature-level state and side effects.
  - `tests/` — Component and hook unit/integration tests for the feature.
- **Declarative Components**: Keep React components clean and declarative. Place business logic, API communication, and state transformations inside custom hooks (e.g., `use<Feature>.ts`) or Redux slices (`src/store/`).
- **Offline-First Architecture**:
  - Local state persistence must use Dexie (`src/db/ttaDatabase.ts`).
  - Remote synchronization and hydration logic must reside in dedicated services under `src/services/` (e.g., `syncService.ts`, `hydrationService.ts`).
- **Strict TypeScript (No `any`)**:
  - Always reuse generated backend contracts from `src/api/types.ts`.
  - Never use `any`. Define explicit TypeScript interfaces or type aliases for all component props, custom hook arguments, and hook return values.

---

## 3. UI, Tailwind CSS & Accessibility

- **Modal Standardization**:
  - Always reuse the centralized `ModalDialog` component (`src/features/matches/components/ModalDialog.tsx`) for modal dialogs and overlays. Never construct ad-hoc modal backdrops or overlays.
- **Background Inactivation (`inert`)**:
  - When a modal is open (`isModalOpen === true`), apply `inert={isModalOpen}` to sibling background containers in both the local feature component and any parent views (e.g., `MatchSetupWizard`).
  - Ensure `ModalDialog` remains outside the `inert` subtree (typically rendered via portal or as a direct sibling to inert containers).
- **Focus Management**:
  - Maintain focus-management effects in `ModalDialog` independent of unstable callback props (such as `onClose`), ensuring that closing a dialog consistently restores focus to the original trigger button.
- **Accessible & Testable**:
  - Keep dialog state, ARIA attributes, and open/close flags fully declarative and compatible with testing in Vitest + JSDOM.

---

## 4. Code Quality & SonarCloud Compliance

- **Low Cognitive Complexity**:
  - Keep functions and React components concise. Aim for a cognitive complexity score well below 15 per function.
- **Extract Pure Helpers**:
  - Break down complex conditional logic, data transformations, formatters, and form validation rules into small, pure helper functions (placed in feature-local utils or `src/utils/`).
- **Clean Code Practices**:
  - Avoid nested ternary operators (prefer early returns, `if/else`, or lookup tables/objects).
  - Avoid duplicated string literals; extract recurring identifiers, status keys, or storage keys into constants.

---

## 5. Testing & Verification Workflow

- **Comprehensive Unit Testing**:
  - For every behavioral change, feature implementation, or bug fix, add or update corresponding unit tests under `src/features/<feature>/tests/` (or `src/tests/` for global services/utilities).
  - Use Vitest and `@testing-library/react` adhering to user-centric testing best practices (querying by accessible role/text).
- **Pre-Conclusion Verification**:
  - Before concluding any task or submitting changes, run:
    1. `npm run lint`
    2. `npm test -- --run`
    3. `npm run build`
  - Ensure all test suites pass, TypeScript types validate without errors, and no ESLint warnings/errors are introduced.
- **Branching Strategy**:
  - Never commit or push directly to `main` or `dev`. Always work on dedicated feature or bugfix branches (`feature/...`, `fix/...`).

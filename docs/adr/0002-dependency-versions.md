# 0002. Dependency version choices

Date: 2026-11-04
Status: Accepted

## Decision
Latest stable versions, with three deliberate exceptions:

| Package | Chosen | Latest | Reason |
|---|---|---|---|
| react-router | 7.18 | 8.5 | v8 documentation was not available to verify its API; v7 is well documented. Revisit in Phase 8. |
| typescript | 6.0 | 7.0 | TypeScript 7 (native) does not ship `tsserver`, which editor tooling and language servers rely on. Upgrade when tooling supports it. |
| jsdom (tests only) | 29 | 30 | jsdom 30 requires Node ≥ 24.15; the development machine runs 24.11. |

## Consequences
Builds, tests and editor code intelligence work on the current machine without upgrading Node.

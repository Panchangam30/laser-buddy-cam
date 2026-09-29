# Dead-code register

This file records code and assets removed from the active application during the September 2026 cleanup. It intentionally contains no executable source: keeping dead implementation in a compiled file would make the bundle and maintenance problem worse.

## Removed

- `src/assets/react.svg` — untouched Vite starter artwork; never imported.
- `src/assets/vite.svg` — untouched Vite starter artwork; never imported.
- `pinIsExternal()` from `src/three/Parts.tsx` — exported helper with no callers. Its remaining behavior was already performed directly by `pinPositions()`.

## Retention rule

Git history is the source of truth for removed implementations. Add future candidates here with the evidence that they have no imports, runtime references, or public API consumers before deleting them.

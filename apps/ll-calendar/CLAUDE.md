# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm start          # Start Expo dev server
pnpm ios            # Run on iOS simulator
pnpm android        # Run on Android emulator
pnpm web            # Run on web
pnpm lint           # Run ESLint (expo lint)
```

No test runner is configured. There is no build step for development — Expo handles bundling.

## Architecture

**Luminous Scholar** is an Expo + React Native app (TypeScript) using file-based routing via Expo Router. It connects to a hosted PocketBase instance (`https://learnlife.pockethost.io`) for auth and data.

### Key directories

- `app/` — Expo Router screens. Root `_layout.tsx` wraps everything in `AuthProvider` and the default theme provider.
- `app/(tabs)/` — Tab navigation. Currently two tabs: Home (`index.tsx`, shows login or dashboard depending on auth state) and Explore (`explore.tsx`).
- `context/AuthContext.tsx` — React Context tracking `user` and `isAuthenticated`. Subscribes to PocketBase auth store changes and exposes `useAuth()`.
- `lib/pocketbase.ts` — PocketBase client configured with AsyncStorage persistence (`pb_auth` key). Exports `login()`, `logout()`, `register()`, `isAuthenticated()`.
- `components/` — Reusable UI. `components/ui/` for primitives; `ThemedText`/`ThemedView` for theme-aware wrappers.
- `constants/theme.ts` — Color palette for light/dark modes.
- `hooks/` — `useColorScheme` (with `.web.ts` variant) and `useThemeColor`.
- `stitch/` — HTML/PNG design mockups for reference only, not runtime code.

### Auth flow

1. `login(email, password)` in `lib/pocketbase.ts` calls PocketBase's `users` collection auth.
2. Token persists via AsyncStorage.
3. `AuthContext` listens to auth store changes and syncs React state.
4. `app/(tabs)/index.tsx` checks `isAuthenticated` to render login form or dashboard.

### Conventions

- Path alias `@/*` maps to the repo root (configured in `tsconfig.json`).
- Platform-specific files use `.web.ts` / `.ios.tsx` suffixes.
- Styling uses `StyleSheet.create()` — no CSS-in-JS library.
- TypeScript strict mode is on.
- Experimental Expo features enabled: `typedRoutes`, `reactCompiler`.

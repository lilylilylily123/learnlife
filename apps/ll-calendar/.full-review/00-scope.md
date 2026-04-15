# Review Scope

## Target

Full codebase review of **Luminous Scholar** (`ll_calendar`) — an Expo + React Native app (TypeScript) using file-based routing via Expo Router. Connects to a hosted PocketBase instance for auth and data.

## Files

### App Screens
- `app/_layout.tsx`
- `app/(tabs)/_layout.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/explore.tsx`
- `app/(tabs)/calendar.tsx`
- `app/(tabs)/inbox.tsx`
- `app/(modals)/create-event.tsx`
- `app/modal.tsx`

### Components
- `components/bottom-nav.tsx`
- `components/themed-text.tsx`
- `components/themed-view.tsx`
- `components/hello-wave.tsx`
- `components/parallax-scroll-view.tsx`
- `components/external-link.tsx`
- `components/haptic-tab.tsx`
- `components/ui/icon-symbol.tsx`
- `components/ui/icon-symbol.ios.tsx`
- `components/ui/collapsible.tsx`

### Core Libraries
- `lib/pocketbase.ts`
- `lib/calendar-utils.ts`

### Context
- `context/AuthContext.tsx`

### Hooks
- `hooks/use-color-scheme.ts`
- `hooks/use-color-scheme.web.ts`
- `hooks/use-theme-color.ts`

### Constants
- `constants/theme.ts`

### Tests
- `__tests__/calendar-utils.test.ts`

### Configuration
- `package.json`
- `tsconfig.json`
- `tsconfig.test.json`
- `app.json`
- `eslint.config.js`

## Flags

- Security Focus: no
- Performance Critical: no
- Strict Mode: no
- Framework: Expo + React Native (TypeScript)

## Review Phases

1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report

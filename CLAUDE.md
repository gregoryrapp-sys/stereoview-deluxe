# CLAUDE.md - StereoView Deluxe

## Project Overview

StereoView Deluxe is a React-based stereoscopic photo viewer application with password-protected gallery access. It displays side-by-side stereoscopic images optimized for VR headsets and 3D viewing devices.

## Tech Stack

- **Framework**: React 18.3 + TypeScript 5.8
- **Build Tool**: Vite 5.4 (dev server on port 8080)
- **Styling**: Tailwind CSS 3.4 with CSS variables for theming
- **UI Components**: shadcn-ui (50+ Radix UI-based components in `src/components/ui/`)
- **Routing**: React Router DOM v6
- **State**: React Context (auth), React Query (server state infrastructure)
- **Forms**: React Hook Form + Zod validation
- **Package Manager**: Bun (bun.lockb present)

## Commands

```bash
npm run dev        # Start dev server (port 8080)
npm run build      # Production build to dist/
npm run build:dev  # Development build with source maps
npm run preview    # Preview production build
npm run lint       # ESLint check
npm run test       # Run Vitest tests once
npm run test:watch # Run tests in watch mode
```

## Project Structure

```
src/
├── components/
│   ├── ui/                 # shadcn-ui components (don't edit directly)
│   ├── StereoViewer.tsx    # Main stereoscopic viewer with gestures
│   └── NavLink.tsx         # Router NavLink wrapper
├── pages/
│   ├── Landing.tsx         # Password auth page
│   ├── Gallery.tsx         # Photo grid + viewer
│   └── NotFound.tsx        # 404 page
├── hooks/
│   ├── useStereoGestures.ts      # Touch: pinch zoom, pan, swipe
│   ├── useFullscreenLandscape.ts # Fullscreen + orientation lock
│   ├── use-mobile.tsx            # Mobile breakpoint detection
│   └── use-toast.ts              # Toast notification hook
├── contexts/
│   └── AuthContext.tsx     # Session-based auth state
├── data/
│   └── photos.ts           # Photo array definition
├── lib/
│   └── utils.ts            # cn() class merging utility
└── assets/                 # Static images
```

## Key Patterns

### Import Alias
Use `@/` for imports from `src/`:
```typescript
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
```

### Styling
- Tailwind utility classes as primary styling method
- Use `cn()` for conditional class merging:
```typescript
cn("base-class", condition && "conditional-class", className)
```
- Dark theme by default via HSL CSS variables in `index.css`
- Custom viewer theme tokens: `--viewer-bg`, `--viewer-fg`, `--viewer-highlight`

### Component Conventions
- Functional components with hooks only (no class components)
- Named exports for utilities, default exports for page components
- Props interfaces defined at component top
- Custom hooks extract complex logic (gestures, fullscreen)

### Authentication
- Context-based auth via `AuthContext.tsx`
- Current password: `"88888888"` (hardcoded for dev)
- State persisted in localStorage (survives browser close)
- Use `useAuth()` hook to access auth state

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Landing.tsx | Password entry, redirects to /gallery |
| `/gallery` | Gallery.tsx | Photo grid with fullscreen viewer |
| `*` | NotFound.tsx | 404 handler |

## Key Components

### StereoViewer (`src/components/StereoViewer.tsx`)
Main viewer component with:
- Dual viewport display (left/right image halves)
- Pinch zoom: 1x-5x range, double-tap toggles 2.5x
- Pan when zoomed (clamped to boundaries)
- Swipe navigation: 50px threshold, 0.3 velocity threshold
- Fullscreen with landscape orientation lock
- Controls auto-hide after 2 seconds

### useStereoGestures Hook
Touch gesture state machine handling:
- `scale`: Current zoom level (1-5)
- `position`: {x, y} pan offset
- Swipe detection with momentum-based velocity check

### useFullscreenLandscape Hook
Manages:
- Fullscreen API with webkit fallback
- Screen orientation lock to landscape-primary
- Cleanup on component unmount

## Testing

- Framework: Vitest + Testing Library
- Setup: `src/test/setup.ts` (mocks matchMedia)
- Tests: `src/**/*.{test,spec}.{ts,tsx}`
- Current coverage: Minimal (example test only)

## Design System

### Colors (HSL in CSS variables)
- Background: near black (0 0% 5%)
- Foreground: near white (0 0% 95%)
- Primary/Secondary with consistent saturation
- Viewer: pure black background for immersion

### Breakpoints
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px
- Container max: 1400px (2xl)

## Development Notes

### Adding Photos
Edit `src/data/photos.ts`:
```typescript
export const photos: Photo[] = [
  { id: "1", src: "/path/to/image.jpg", alt: "Description" },
];
```

### Adding UI Components
Use shadcn-ui CLI or copy from [ui.shadcn.com](https://ui.shadcn.com):
```bash
npx shadcn-ui@latest add [component-name]
```
Components go to `src/components/ui/` with automatic Tailwind theming.

### Fullscreen Considerations
- iOS Safari: Limited fullscreen support, orientation lock may not work
- Use `useFullscreenLandscape` hook for cross-browser handling
- Viewer sets `touch-action: none` to prevent browser gestures

## Important Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Build config, @ alias, port 8080 |
| `tailwind.config.ts` | Theme colors, animations, sidebar |
| `components.json` | shadcn-ui configuration |
| `tsconfig.json` | TypeScript with path aliases |
| `index.css` | CSS variables, design tokens |

## Gotchas

1. **No strict TypeScript** - `strict: false` in tsconfig for dev velocity
2. **HMR overlay disabled** - Set in vite.config.ts for cleaner dev UX
3. **Auth is client-side only** - Password check in browser, not secure for production
4. **Touch gestures** - StereoViewer prevents default touch to enable custom gestures
5. **Photo data is static** - No backend/API, photos defined in `src/data/photos.ts`

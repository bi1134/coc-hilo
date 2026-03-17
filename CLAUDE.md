# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm start` or `npm run dev` — Start Vite dev server (HTTPS, port 8080)
- `npm run build` — Production build via Vite
- `npm run lint` — ESLint with Prettier integration

## Architecture

**Higher/Lower card prediction game** built with PixiJS v8, TypeScript, and Vite.

### Engine Layer (`src/engine/`)
Custom wrapper around PixiJS `Application` called `CreationEngine`, providing plugins for:
- **NavigationPlugin** — Screen/popup lifecycle (`showScreen()`, `presentPopup()`, `dismissPopup()`) with `onLoad()` → `show()` → `hide()` hooks
- **ResizePlugin** — Responsive layout handling
- **AudioPlugin** — Sound management

Access via `engine()` singleton from `src/app/getEngine.ts`.

### Application Layer (`src/app/`)
- **screens/** — Game views. `NextScreen` routes to `NextScreenMobile` (main game logic, ~950 lines)
- **api/** — `ApiClient` singleton with Bearer token auth (token from URL query params). `GameService` wraps endpoints: `bet()`, `pick()`, `cashout()`, `skip()`, `history()`. Mock mode available for backend-less testing.
- **data/GameData.ts** — Singleton holding player balance, username, currency, card history
- **ui/** — Reusable components (Card, BetButton, BetInput, BitmapLabel, etc.)
- **popups/** — Modal dialogs (ResultPopup, SettingsPopup, GameRulePopup, History)
- **framework/** — Game-specific composites (GameLogic for card animations, GameInformation for character dialog, BetBar)
- **audio/SoundManager.ts** — Static facade for BGM/SFX playback

### State Management
Singleton pattern throughout — no external state library. Key singletons: `GameData.instance`, `ApiClient.getInstance()`, `UIManager.instance`.

### Game Flow
1. `main.ts` → font init, engine creation, load `LoadScreen`
2. `LoadScreen` loads assets → navigates to `NextScreen` → `NextScreenMobile`
3. Player bets → predicts Higher/Lower/Skip → multiplier grows on correct guesses → cashout or lose
4. State transitions: `BettingState` ↔ `NonBettingState`

### Key Dependencies
- **pixi.js** v8 + @pixi/ui, @pixi/sound
- **gsap** — Card/UI animations
- **@esotericsoftware/spine-pixi-v8** — Character spine animations
- **@assetpack/core** — Asset pipeline (raw-assets/ → public/assets/)

### Asset Pipeline
Raw assets in `raw-assets/` are processed by AssetPack into `public/assets/`. Spine skeletons live in `public/spine-assets/`. Asset manifest at `src/manifest.json`.

## TypeScript Config
- Target: ES2020, strict mode enabled
- Bundler module resolution (ESNext)

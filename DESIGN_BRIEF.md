# StratNinja — UI/UX Makeover Brief (for the design agent)

You are doing a **visual/UX redesign** of the StratNinja web app (stratninja.win). Read this whole file
before touching anything. The goal is a modern, cohesive, premium look — **without changing behavior,
data, or breaking the things listed under "DO NOT TOUCH".**

## 1. What this is
- A **static, vanilla-JS single-page app** (no framework, no build step, no bundler). Files are served
  as-is by Vercel. Do **not** introduce React/Vue/Svelte/Tailwind-build/webpack/vite — it must stay
  buildless static files.
- **Hebrew, right-to-left (RTL).** All UI text is Hebrew; layout is RTL. Preserve this everywhere.
- **Dark-first**, with a working **light** theme. Brand accent = violet `#7c6cf0` (with a green `#16b877`).
- Audience: retail stock traders. It's a market **scanner** + **trade journal** + market dashboards,
  built around "The Strat" methodology.

## 2. Tech / repo facts
- Repo: `github.com/StratNinja/Stratninja-Platform`. Push to **`main` auto-deploys to Vercel (live!)**.
  → **Work on a branch and open a PR.** Never push straight to `main`.
- Data comes from **Supabase** (public anon key already in `config.js` — safe, keep it). The site loads
  **live data out of the box**; you do not need any server or secret.
- Run locally: `python -m http.server 8000` in this folder, open `http://localhost:8000`.
  Login uses Google OAuth (needs the real domain) — on the landing page click
  **"כניסה למצב פיתוח (ללא התחברות)"** to enter the app with live data, no login.

## 3. File map — what's DESIGN vs LOGIC
**Design surface (edit freely, carefully):**
- `index.html` — app shell: sidebar `<nav class="side-nav">` (page links via `data-page`), landing page, layout scaffold.
- `style.css` — **the design system**: CSS-variable tokens + base layout + theming (see §4). Start here.
- `app.css` — the bulk of component styles (panels, tables, filters, journal, alert banner, etc.).
- `landing.css` — the public landing/marketing page.
- `share-fonts.css` — fonts + styles for the 1080×1080 share cards (see gotcha §6).
- Presentational **markup inside render functions** in `pages.js` / `journal.js` (they build HTML strings).
  You may restructure classes/markup for looks, but keep the data bindings and element IDs the JS relies on.

**LOGIC — DO NOT change behavior (styling-only if at all):**
- `config.js` (Supabase keys/URL), `auth.js` (OAuth), `cloudsync.js` (per-user sync), `prefs.js`
  (favorites/alerts/presets), `engine.js` (journal P&L math), `sw.js` + `manifest.json` (PWA).
- The **scanner filter logic** and **journal calculations** inside `pages.js`/`journal.js` — restyle their
  OUTPUT, don't change what they compute or the `techState`/filter framework.

## 4. Design system (USE THESE — don't hardcode colors)
All colors are CSS variables in `style.css`. There are **three theme states**, and every color must be
defined per state or it breaks one theme:
- `:root` = **dark** (default).
- `html[data-theme="light"]` = light (explicit toggle).
- (System/default dark already covered by `:root`.) The in-app toggle sets `data-theme`.

Tokens (dark → light):
`--bg` `--panel` `--panel2` `--cell` `--line` `--ink` `--muted` `--accent` `--accentbg`
`--green/--greenbg/--greenbd` `--red/--redbg/--redbd` `--soft/--soft2`
`--panelbd` (panel border — transparent on dark, `--line` on light) · `--panelsh` (panel shadow)
`--tline` (table row separator) · `--mono` (monospace for numbers).
Share-card tokens use a `--mf*` set (in app.css/share-fonts.css).

Rules:
- **Never** write a raw hex in a component; add/extend a token so both themes stay correct.
- Numbers/prices use `var(--mono)` + tabular-nums.
- Test **every** change in BOTH themes (toggle: 🌗 in the sidebar) and on **mobile** (the sidebar
  collapses to a 52–60px icon rail under ~1000px).

## 5. Pages to redesign (priority order)
Sidebar pages (`data-page`): `market` (סקירת שוק), `sp500`, `sectors` (המשכיות זמנית),
`today` (לאן הכסף הולך), `scanner` (סורק עסקאות), `gappers`, `favorites`, `journal` (יומן מסחר),
`learn` (לימוד), plus admin-only `analytics` + `draw`.
Suggested focus: **scanner + journal + the market/sectors/today dashboards** (highest-traffic).
Also: the **sidebar/nav**, the **filter panels**, **data tables** (`.scan-table`), **stat cards/panels**
(`.panel`), and the **landing page**.

## 6. Gotchas / must-preserve
- **Share cards (html2canvas):** cards rendered to PNG for sharing use UNIQUE class prefixes
  (`.mf-` money-flow, `.spm-` S&P map, `.ac2-` alert, `.jrn2-` journal, `ld2-` leaders…). A generic
  class name (e.g. `.hero`) once collided with the landing hero — **keep prefixes unique**, and these
  cards are pixel-tuned to 1080×1080 — restyle conservatively and re-check the exported image.
- **RTL:** use logical properties (`margin-inline-start`, `inset-inline-end`) not left/right.
- **Theme:** anything you add must have both dark + light values. A color defined only in one place
  will look broken in the other theme.
- **No horizontal page scroll** — wide tables scroll inside their own container.
- **Don't rename** element IDs / `data-*` attributes the JS queries (search the JS before renaming).
- **PWA/offline:** don't break `sw.js` caching or `manifest.json`.

## 7. Workflow
1. Branch off `main`. 2. Redesign in HTML/CSS (+ presentational markup). 3. Verify: both themes,
mobile + desktop, all main pages, a share-card export, and that the scanner/journal still work.
4. Open a PR with before/after screenshots for review. **Do not merge to `main` yourself.**

## 8. Design direction
**Goal: make the whole site look significantly more BUSINESS / PROFESSIONAL — like a premium
fintech/trading terminal (think Bloomberg / a top-tier SaaS analytics product), not a hobby tool.**
- Vibe: serious, polished, trustworthy, institutional-grade. Dark-first, high information density but
  clean and breathable — clear hierarchy, generous but disciplined spacing, refined typography.
- Elevate: consistent card/panel system, crisp data tables, a refined sidebar, cohesive iconography,
  purposeful use of the violet↔green brand accent (accent for emphasis, not everywhere).
- Modernize typography (a professional sans; numbers in the mono/tabular font), spacing scale, radii,
  shadows/elevation, hover/focus states, empty states, and loading states.
- Keep it fast and buildless. Keep RTL Hebrew. Keep both themes working.
- <Adi to add: reference sites/products he likes, and any specific page/element to prioritize or keep.>

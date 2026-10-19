---
name: Inverted Ink Manga
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f21'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#313032'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c6c6cf'
  on-secondary: '#2f3037'
  secondary-container: '#45464e'
  on-secondary-container: '#b4b4bd'
  tertiary: '#ffffff'
  on-tertiary: '#2f3038'
  tertiary-container: '#e3e1ec'
  on-tertiary-container: '#64636d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e2e1eb'
  secondary-fixed-dim: '#c6c6cf'
  on-secondary-fixed: '#1a1b22'
  on-secondary-fixed-variant: '#45464e'
  tertiary-fixed: '#e3e1ec'
  tertiary-fixed-dim: '#c7c5d0'
  on-tertiary-fixed: '#1a1b23'
  on-tertiary-fixed-variant: '#46464f'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
typography:
  display-hero:
    fontFamily: Space Grotesk
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 60px
    letterSpacing: -0.04em
  display-hero-mobile:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-mono-lg:
    fontFamily: Space Mono
    fontSize: 13px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.06em
  label-mono-md:
    fontFamily: Space Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.08em
  label-mono-sm:
    fontFamily: Space Mono
    fontSize: 9px
    fontWeight: '400'
    lineHeight: 12px
    letterSpacing: 0.1em
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  gutter-desktop: 1.5rem
  margin: 1.5rem
  margin-mobile: 1rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system channels the tactile precision of serialized print manga merged with technical cyberpunk UI instrumentation. The aesthetic strictly rejects artificial chromatic accents in favor of pure ink fidelity, lithographic halftones, screentone dot matrices, and stark mechanical contrasts.

### Core Tenets
- **Print Fidelity & Inverted Ink:** Surfaces evoke deep chemical black ink pools and stark unprinted newsprint/paper white.
- **Graphic Brutalism with Tactical Discipline:** Panels mimic comic page guttering and mechanical HUD overlays. Composition is sharp, unrounded, and mathematically proportioned.
- **Micro-Texture Over Color:** Hierarchy is communicated strictly through screentone grain densities (stippling, 45-degree crosshatching, variable frequency dots), linework thickness, and luminous white inversions.
- **Emotional Resonance:** Technical, cold, hyper-focused, cinematic, and authoritative.

## Colors

The palette operates under absolute chromatic absence. Every value maps to an authentic physical medium: deep carbon ink, lithographic printer washes, or bleach-free paper.

### Palette Architecture
- **Canvas Base (`#000000`, `#0a0a0c`):** Deep black ink depths, acting as infinite vacuum or heavy solid fill areas.
- **Panel Base (`#121214`, `#18181b`):** Recessed structural panels, mimicking ink washes and dense screen densities.
- **Midtone Halftones (`#27272a`, `#52525b`):** 40–60% screentone values used for disabled states, secondary dividers, and technical grid marks.
- **Light Halftones (`#a1a1aa`, `#e4e4e7`):** 10–25% dot density simulations, subtle technical indicators, and secondary typography.
- **Stark Paper (`#ffffff`):** Pure optical contrast, laser wireframes, interactive focus rings, and primary reading targets.

Zero colored tints (no red, cyan, or amber status cues). Status states rely entirely on iconography, structural inversion (solid white fills with black text), or heavy mechanical stroke weighting.

## Typography

Typography fuses stark geometric display titles with utilitarian monospaced data markers. 

### Typographic Hierarchy
- **Headlines & Editorial Titles:** Set in uppercase or tightly tracked **Space Grotesk**. Headlines mimic comic sound effects (katakana pacing) and technical chapter breaks.
- **Body Content:** Structured, neutral-tracking **Space Grotesk** maintains supreme legibility against low-contrast ink textures.
- **HUD Labels & Data Indicators:** Standardized on **Space Mono**. Must always render in all-caps with generous tracking (`0.06em` to `0.1em`) to mimic serial numbers, schematic annotations, and printing stamps.

## Layout & Spacing

The structural layout relies on an asymmetric manga panel grid. The page behaves like an unprinted drafting canvas framed by sharp outer bounds.

### Grid & Composition
- **Desktop (12 Columns):** Fluid grid bounded by a hard `margin-desktop` (48px) and mechanical crosshair registration marks at the four canvas corners. Columns mimic comic strips with deep structural gutters (`gutter-desktop`).
- **Tablet (8 Columns):** Compact grid with balanced 24px gutters, collating secondary telemetry into slide-out panels.
- **Mobile (4 Columns):** Vertical stacked reading flow mimicking webtoon or mobile manga viewports with 16px margins.

### Panel Spacing Rules
- Containers snap edge-to-edge or stay separated by strict gutter steps (`gutter`).
- Internal component rhythm follows multiples of 4px/8px, maintaining dense mechanical economy.

## Elevation & Depth

Standard ambient blurred dropshadows are completely prohibited. Depth is rendered via structural layering, screentone shading, and hard edge offsets.

### Depth Mechanics
- **Ground Floor (Base Canvas):** Solid `#000000` with occasional CSS radial dot screentone patterns (1px white dots at 8px pitch, 6% opacity).
- **First Tier (Manga Panels):** Solid `#0a0a0c` or `#121214` surface bounded by a crisp `1px solid #27272a` stroke.
- **Active / Floating Overlays:** Backdrop blur (`backdrop-filter: blur(12px)`) tinted with 85% opacity `#0a0a0c`, combined with a `1px solid #ffffff` outer stroke.
- **Hard Cast Shadows:** For modal alerts and focused cards, depth is projected using hard-edge isometric offset block shadows: `box-shadow: 4px 4px 0px 0px #ffffff` or `box-shadow: 6px 6px 0px 0px #27272a`.
- **Hatching & Screentone Masking:** Overlapping elements cast 45-degree diagonal striped screentone masks (`repeating-linear-gradient(45deg, #000 0, #000 2px, transparent 2px, transparent 6px)`) behind them to delineate separation without soft lighting.

## Shapes

The interface permits zero border-radius (`roundedness: 0`). Every panel, button, popover, and input element uses raw 90-degree corners or 45-degree chamfered cuts (clip-path corners) to preserve an industrial, hard-edged technical drawing and manga frame aesthetic.

- **Standard Elements:** Strict rectangular perimeters with razor-sharp vertices.
- **Technical Accents:** Strategic chamfering (clip-path corner notches of 6px to 10px) on active tabs, modal headers, and badge indicators.

## Components

### Buttons
- **Primary:** Inverted solid paper (`#ffffff`) background with solid `#000000` bold text. On hover, inverts instantly into a `#000000` background with a crisp `2px solid #ffffff` border and white text, accompanied by an instant 2px translational snap.
- **Secondary / HUD:** `#000000` base with `1px solid #52525b` border, white text, and Space Mono typography. On hover, the border shifts to `1px solid #ffffff` with a subtle screentone dot overlay.
- **Destructive / Alert:** Replaces red with dense 45-degree warning crosshatching in high-contrast black/white, labeled with stark uppercase brackets: `[ TERMINATE ]`.

### Cards & Panels
- **Frame Structure:** Solid dark base (`#0a0a0c` to `#121214`) enclosed in a `1px solid #27272a` boundary.
- **Header Blocks:** Dedicated metadata header bar separated by a solid `1px solid #27272a` divider, featuring chapter-style indexing (`CH_04 // SEC_A`) in `label-mono-sm`.
- **Corner Notches:** Structural L-bracket corner marks (`#ffffff`, 1px wide, 4px arms) accenting cards containing real-time or critical data.

### Input Fields
- **Container:** Rectangular `#000000` surface framed by `1px solid #52525b`.
- **Focus State:** Replaces standard blue/glow with an instant `1px solid #ffffff` and an outer 2px offset white bracket.
- **Placeholder:** Rendered in `#52525b` with terminal prompt styling (e.g., `_ENTER_PARAM`).

### Checkboxes & Radios
- **Checkbox:** Square box with `1px solid #a1a1aa`. Checked state renders an aggressive solid white diagonal fill or heavy centered solid cross (`X`).
- **Radio:** Diamond or square-in-square indicator (never rounded). Active state fills the inner cavity with solid `#ffffff`.

### Chips & Badges
- Compact rectangular bounding tags with `1px solid #52525b`. Monospaced uppercase text (`label-mono-sm`). Active or highlighted chips invert fully to solid `#ffffff` fill with `#000000` text.

### Data Tables & Lists
- Thin, razor-sharp horizontal rules (`1px solid #18181b`). Hovering over a row triggers an inverted high-contrast highlight or a dense stipple pattern row wash.
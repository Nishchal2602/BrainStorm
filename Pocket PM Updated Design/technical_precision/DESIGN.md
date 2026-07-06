---
name: Technical Precision
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#45464c'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#575e70'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#141b2b'
  on-primary-container: '#7d8497'
  inverse-primary: '#c0c6db'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#261906'
  on-tertiary-container: '#968065'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce2f7'
  primary-fixed-dim: '#c0c6db'
  on-primary-fixed: '#141b2b'
  on-primary-fixed-variant: '#404758'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#f9debf'
  tertiary-fixed-dim: '#dcc2a4'
  on-tertiary-fixed: '#261906'
  on-tertiary-fixed-variant: '#55442d'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  meta-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  panel-padding: 12px
  stack-gap: 8px
  element-gap: 4px
  section-margin: 16px
---

## Brand & Style

The design system is engineered for a high-density, utility-first Chrome extension environment. It draws inspiration from modern developer ecosystems that prioritize speed, clarity, and information density. The aesthetic is rooted in **Minimalism** with a **Corporate/Modern** backbone, focusing on structural integrity rather than decorative elements. 

The target audience consists of developers and power users who value low-latency interactions and a "no-fluff" interface. The UI should feel like a native extension of the operating system or a high-end IDE side panel—utilitarian, responsive, and authoritative.

## Colors

The palette is anchored by a high-contrast foundation to ensure legibility within the restricted 400px width of a side panel. 

- **Primary & Neutral:** Using `#111827` for text and primary icons ensures maximum contrast against the `#FFFFFF` and `#F9FAFB` surfaces.
- **Functional Accents:** Colors are used strictly for semantic communication (Status, Error, Success). 
- **Subtle Partitioning:** The border color `#E5E7EB` is the primary tool for defining structure, replacing shadows to maintain a flat, performant look.

## Typography

This design system utilizes a dual-font approach to balance readability and technical context. 

- **Inter:** Serves as the primary workhorse for all UI elements, navigation, and body content.
- **JetBrains Mono:** Used for metadata, status counts, version numbers, and code snippets. This creates a clear visual distinction between "Interface" and "Data."

Hierarchy is established through weight and color rather than significant size shifts, maintaining a compact footprint suitable for sidebars.

## Layout & Spacing

The layout follows a **Fixed width (400px)** model optimized for a vertical scroll experience. 

- **Density:** We use a tight 4px-base grid. A standard 12px internal padding for the side panel container ensures maximum horizontal real estate while preventing content from touching the edges.
- **Vertical Flow:** Content is arranged in a single-column flow. Horizontal partitioning is achieved through thin 1px dividers rather than nested containers.
- **Responsiveness:** While the panel is fixed at 400px, internal components use fluid widths (100%) to adapt to the user's manual resizing of the panel if permitted by the browser.

## Elevation & Depth

This design system avoids traditional box shadows to minimize visual clutter. Depth is communicated through:

- **Tonal Layers:** The main background is white, while secondary areas (like header bars or footer actions) use a subtle `#F9FAFB` fill.
- **Low-Contrast Outlines:** All interactive elements and sections are defined by a 1px `#E5E7EB` border. 
- **Active States:** Depth is simulated during interaction by shifting the background color of an item (e.g., from white to `#F3F4F6` on hover), rather than lifting the element.

## Shapes

The shape language is disciplined and geometric. 

- **Base Radius:** 8px (`0.5rem`) is the standard for cards and larger containers.
- **Small Elements:** Buttons, input fields, and chips utilize a 6px radius to maintain a precise, technical feel.
- **Progress Dials:** Circular elements remain perfectly round (50% radius) to contrast against the otherwise rectilinear grid.

## Components

- **Buttons:** Compact height (32px). Primary buttons use `#111827` background with white text. Ghost buttons use no border and only show a background fill on hover.
- **Accordions:** Controlled by a chevron-down icon on the left. Titles are `headline-sm`. Content is revealed without animation for a "snappy" developer feel.
- **Chips/Badges:** Small, using `meta-mono` typography. Backgrounds are low-opacity versions of functional colors (e.g., Success is 10% opacity `#10B981` with full-strength text).
- **Input Fields:** 1px border, 32px height. Focus state uses a 1px solid `#3B82F6` border with no outer glow.
- **Lists:** High-density rows (36-40px height) separated by 1px dividers. Use icons sparingly to the left of the text.
- **Progress Dials:** Small 16x16px or 24x24px stroke-based rings to show task completion or resource usage without taking up horizontal space.
- **Breadcrumbs/Pathing:** Used at the top of the panel to indicate deep-nesting within the tool, using `body-sm` weight.
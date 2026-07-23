# CSS → TSX Style Migration Notes

When porting styles from the vanilla CSS prototype to React/Tailwind components, these
differences cause visual mismatches:

## Problem: Tailwind's Base Styles Inflate Element Height

Tailwind's `preflight` (based on `modern-normalize`) sets:
- `line-height: 1.5` on `body` (inherited by all elements)
- `line-height: inherit` on `button` elements

The original CSS doesn't set `line-height` on menu items or buttons — browsers default
to ~1.2 for buttons. This makes Tailwind buttons **~25% taller** than identical CSS.

**Fix:** Add `lineHeight: 1` to inline styles for menu items, action buttons, and
any element where padding defines the height (not line-height).

## Problem: `font-size` Inheritance

The original sets `font-size: var(--bubble-font-size, 17px)` on `html, body`, making
it the inherited default everywhere. In Next.js with Tailwind, the base font-size is
`16px` (from preflight), and `var(--bubble-font-size)` is only applied where explicitly
set.

**Fix:** Either set `font-size: var(--bubble-font-size)` on `body` in `globals.css`
(which we do), or explicitly set `fontSize: "var(--bubble-font-size)"` on every
component that needs it.

## Problem: `min-width` on Auto-Sizing Menus

Setting `minWidth: "180px"` on context menus/dropdowns makes them wider than the
original, which auto-sizes to content. Korean labels like "답장" or "신고" are short
(~40px), so forcing a min-width creates excess whitespace.

**Fix:** Omit `minWidth` — let the menu auto-size to its content.

## Problem: Tailwind Class Padding vs CSS Variable Padding

Using Tailwind classes like `px-[14px] py-[10px]` produces fixed pixel values. The
original uses `calc(var(--bubble-font-size) * ratio)` so padding scales with font size.

**Fix:** Use inline `style` with `calc()` expressions for any dimension that should
scale with the font setting:
```tsx
padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)"
```

## Summary: Port Checklist

When porting a CSS component to TSX:
1. Use `dangerouslySetInnerHTML` for SVG icons to preserve exact `stroke-width` attributes
2. Add `lineHeight: 1` to buttons/menu items
3. Omit `minWidth` unless the original explicitly sets it
4. Use `calc(var(--bubble-font-size) ± Xpx)` for all scalable dimensions
5. Use `var(--hairline)`, `var(--meta)`, `var(--gray-text)` etc. in inline styles
6. Don't use Tailwind utility classes for dimensions that need to scale with font settings

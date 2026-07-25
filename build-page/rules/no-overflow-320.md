# No overflow at 320px

A bare `w-[Npx]` on a mobile-first element must never exceed 320px minus the page's
own horizontal padding — the QA floor is a 320px viewport, and an uncapped fixed
width overflows it the moment it's wider than the available space.

```tsx
// ❌ Overflows on any viewport narrower than ~360px
<div className="w-[328px] lg:w-[680px]">

// ✅ Shrinks to fit on mobile, unchanged on desktop
<div className="w-full max-w-[328px] lg:w-[680px] lg:max-w-none">
```

Pair a fixed mobile width with `w-full max-w-[Npx]` (or a fluid `fl-w-[a,b]` token
if the project has one) instead of a bare fixed width — the box then shrinks to fit
anything narrower than the design value rather than pushing past the viewport edge.

**Reserve a bare `w-[Npx]` for values genuinely small** (icons, avatars, badges —
roughly under 300px) where a 320px viewport can never be an issue. Anything sized
closer to a typical content column or media panel needs the cap.

This is a real, recurring class of bug — a fixed-square media panel sized
`w-[328px]` (no cap) shipped and was caught in review only because a reviewer
happened to check a 320px-wide device. Test at 320px as a matter of course, not
as an afterthought.

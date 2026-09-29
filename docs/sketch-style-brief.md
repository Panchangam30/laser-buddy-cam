# Brief: a hand-drawn animation style for laser-buddy-cam

**You are being asked to restyle the 3D view so it looks drawn rather than
rendered, and to make it move in a way that feels hand-made.** This document is
the context you need before touching anything. Read it first; the codebase has
a few hard constraints that are not obvious and that a sketch style can easily
break.

## What this app is

A lab assistant for a student building a circuit on a solderless breadboard. A
webcam watches the bench, OpenCV works out which hole every part is sitting in,
and a 3D view shows both the circuit they are aiming for and what is actually on
their board. A voice assistant talks them through it, and a laser pointer on a
pan/tilt head can physically light up the hole they need next.

Your work is confined to the 3D view. Nothing you do should change what the
system believes about the board.

## Stack

| | |
| --- | --- |
| Renderer | three.js `^0.186` via `@react-three/fiber` `^9.8` |
| Helpers | `@react-three/drei` `^10.7` |
| UI | React 19, Vite |
| Animation | hand-rolled damping in `useFrame`. **No animation library is installed.** |
| Post-processing | **`@react-three/postprocessing` is NOT installed** |

That last row matters. The obvious way to get an ink-outline look is an edge
detection pass, and you cannot have one without adding a dependency. Ask before
adding it. There is a good chance you do not need it — see *Approaches* below.

## The files you care about

```
web/src/three/
  Scene.tsx       Canvas, lights, camera, what is visible at each step
  Breadboard.tsx  the board itself: body, channel, 842 instanced holes, rails, labels
  Parts.tsx       dispatch by part kind + the animation wrapper
  bodies.tsx      the component packages (resistor, LED, DIP, ...)
  leads.tsx       component legs and chip pins
  materials.ts    shared surface definitions
  labels.ts       canvas-drawn textures for text and resistor colour bands
  World.tsx       the live map of what is physically on the bench
```

`bodies.tsx` is where the shapes are. `Parts.tsx` is where the motion is.
`materials.ts` is where a global look change is cheapest.

## Non-negotiable constraints

**1. Positions are measured, not decorative.**
Everything in the scene is in **millimetres**, in the board's own frame: X runs
along the columns, Z across the rows, Y up. The origin is the centre of the
board. A hole reference like `E12` resolves to an exact coordinate through
`web/src/lib/breadboard.ts`, which is a deliberate mirror of the Python file
`vision/geometry.py`.

Parts are drawn where they actually are, to a fraction of a hole pitch, and the
whole product depends on that being true. A wobble applied to a part's
**position** is a lie about where the student's resistor is. A wobble applied to
its **surface** is a style. Stay on the surface side of that line.

`PITCH` is 2.54 mm, the board is 63 columns, 162.56 × 48.26 mm. A 5 mm LED
really is about two holes wide. Do not scale parts up to make them read better —
if they need to read better, move the camera.

**2. Colour carries meaning in three places.**
- **Resistor bands** are computed from the value by `resistorBands()` in
  `labels.ts`. They encode a real resistance. If the value could not be read,
  the function returns `null` and the part is drawn with neutral grey bands, on
  purpose. Never let a style choice make grey bands look like real ones.
- **Live-map status** — `STATUS_COLOR` in `World.tsx` — green/amber/red/blue
  means placed, misplaced, missing, not-in-plan.
- **Polarity markings**: the LED's flat, the electrolytic's stripe, the DIP's
  notch. These tell a student which way round a part goes. A sketch style that
  flattens or hides them makes the view worse, not just different.

**3. Dimming is a state, not an effect.**
Parts take `dimmed` and `highlighted` props. Dimmed parts are context; the
highlighted one is the subject. Whatever style you apply has to keep that
readable.

## How animation currently works

There is no spring library. `Parts.tsx` has an `Animated` wrapper that uses
`useFrame` with `THREE.MathUtils.damp`, which is framerate-independent:

```tsx
s.y = THREE.MathUtils.damp(s.y, lift, 6, step);   // 6 = stiffness
s.scale = THREE.MathUtils.damp(s.scale, 1, 9, step);
```

`dt` is clamped to 0.05 s, because a backgrounded tab resumes with a huge delta
and would snap everything to its target.

Current motion: parts grow in from zero scale; the exploded view lifts the
current part 26 mm on a damped curve (~900 ms); highlighted parts breathe
slightly, phase-offset per part so a row does not pulse in unison; lit LEDs
pulse their emissive and cast a point light.

Keep the damping approach unless you have a reason not to. It is dependency-free
and already framerate-correct.

## Approaches worth considering

Listed cheapest first. You are not obliged to pick one.

**Outlines on the geometry.** drei ships `<Outlines>` (inverted-hull) and
`<Edges>` (only the sharp edges). `<Edges>` over flat-shaded bodies gets you most
of a technical-drawing look with no new dependency and no shader work. Start
here.

**Flat or toon shading.** Swap the `meshStandardMaterial` calls in
`materials.ts` for `meshToonMaterial`, or drop a gradient map on them. One file,
affects everything, easy to revert.

**A drawn line pass.** drei has `<Line>`, `<QuadraticBezierLine>` and
`<CubicBezierLine>`, all of which accept a width and can be given a slight
per-frame jitter to look ink-like. Jumper wires are already Bézier curves in
`bodies.tsx` and would translate directly.

**Hand-drawn textures.** `labels.ts` already draws to a 2D canvas and uses the
result as a texture — it is the established pattern here for anything
text-shaped, and a natural place to introduce a sketchy stroke.

**Boil.** The trick that makes animation read as hand-drawn is *boil*: the line
re-drawn slightly differently every few frames. Do it by updating a uniform or
a texture offset on a 2–3 frame cadence, never by moving the object. At 60 fps,
re-roll roughly every 4th frame or it reads as noise rather than as drawing.

## Things that will bite you

- **842 instanced holes.** `Breadboard.tsx` draws them as one `InstancedMesh`.
  Per-object outlines there will cost you badly. Style the board body and leave
  the holes alone, or find an instanced-friendly approach.
- **Transparency.** The LED is deliberately translucent so its internals show.
  Most outline techniques interact badly with transparent materials — check the
  LED specifically, at step 1 of the default plan.
- **Shadows are on**, with a 2048 map and a tuned bias in `Scene.tsx`. A flat
  style may want them off; that is a legitimate choice, but it is a visible one.
- **The live map layer** (`World.tsx`) draws unidentified objects as plain blocks
  at their measured size, on purpose: a block is the honest shape for "something
  is here but we do not know what". Do not make those look like finished parts.

## How to check your work

```sh
cd web && npm run dev          # starts vision service, API and the web app
```

Open the app. The default plan is a 4-step LED blink circuit with an LED,
resistor and two jumpers, so stepping through it exercises most part types.

**Animation cannot be verified from a screenshot.** Under software rendering a
screenshot takes long enough that a 60 ms interval may really be 400 ms, which
makes a smooth move and a snap look identical. The scene is exposed in dev as
`window.__scene` — sample the value you are animating in `requestAnimationFrame`
and print it. That is the only reliable check, and it was added for exactly this
reason.

Before you finish: `npx tsc -b` and `npx oxlint src` both clean.

## House style

Match what is there. Comments in this codebase explain *why* a thing is done,
especially where the obvious approach fails — they do not narrate what the code
already says. If you find yourself doing something non-obvious, that is worth a
sentence. If you are writing "set the colour to red", delete it.

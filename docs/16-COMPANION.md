# Digital Companion

A spatial pet that walks alongside the user on the map during active walks.
Iteration 1 is shipped and field-validated. This document captures the
shipped architecture and the proposals for iteration 2.

## Status

**Iteration 1 — shipped, field-validated 2026-05-07.**

Visible only during an active walk (gated to `activeWalk?.status === 'active'`).
Despawns on Pause and End Walk. No persistence; no backend dependency.

The current visible asset is a placeholder: 8 directional red arrows generated
by `mobile/src/assets/companion/_generate_arrows.py`. They are slotted into
the same machinery that will later carry real dog sprites — replacing the
PNGs with the dog art is a drop-in swap.

## Iteration 1 — Architecture

Three pure-function modules + one React hook + one Mapbox layer component.

| Module | Responsibility |
|---|---|
| [`mobile/src/companion/leash.ts`](../mobile/src/companion/leash.ts) | Spring-damper integrator with hard leash clamp at `leashMaxMeters`. Pure function. World-frame physics, lat/lng-aware. Tangential velocity preserved at the leash boundary so a circling dog glides smoothly. |
| [`mobile/src/companion/direction.ts`](../mobile/src/companion/direction.ts) | Computes screen-frame bearing from world velocity minus camera bearing, then snaps to one of 8 sprite directions with 5° hysteresis at boundaries. Idle gating below 0.3 m/s. |
| [`mobile/src/companion/companionPolicy.ts`](../mobile/src/companion/companionPolicy.ts) | Owns the polar target offset (where the dog wants to go relative to the user). ROAM/LINGER state machine with random-walk drift on `(angle, distance)` and world-anchored target during LINGER. RNG injected for deterministic tests. |
| [`mobile/src/hooks/useCompanion.ts`](../mobile/src/hooks/useCompanion.ts) | RAF-driven orchestrator. Composes the three modules. Holds continuous state in a ref; pushes React state updates at 30 Hz so re-renders stay cheap. |
| [`mobile/src/components/CompanionLayer.tsx`](../mobile/src/components/CompanionLayer.tsx) | Mapbox `Images` + `ShapeSource` + `SymbolLayer`. Single-feature GeoJSON Point with a `sprite` property; layer's `iconImage: ['get', 'sprite']` selects the registered image. `iconSize` interpolated against zoom. |

Tunables (all centralized at the top of the relevant module):

| Tunable | Value |
|---|---|
| `leashMaxMeters` | 10 |
| `dogMaxSpeedMps` | 4 |
| `dogMaxAccelMps2` | 3 |
| `lingerHoldFraction` | 0.85 |
| `lingerDuration` | 2–4 s (uniform) |
| `angleDriftDegPerSec` | 10 (per-second SD) |

89 unit tests across the three pure-function modules. Field-validated
against acceptance criteria 1–9 (spawn/follow/turn/zoom/end/cold-start,
plus long-walk wandering and sprint+linger at leash boundary).

## Iteration 2 — Proposals

Four behavioral extensions. Each is independently shippable; they are
ordered roughly by how much new code they require.

### A. POI sniffing (lampposts, benches, hydrants, trees)

When the user is near a Mapbox POI of certain types, the dog breaks from
ROAM into a CURIOUS state, pathfinds toward the POI, sniffs (visually:
holds in place with a sniff pose), then resumes wandering. The user does
not need to interact — it happens autonomously.

**Architectural mapping:**

- **Reuses:** `LingerState.anchor` is already the world-anchored-target
  primitive that drives this. The leash already pulls toward any LatLng.
- **New input to policy:** nearby POIs of interest, queried from the
  Mapbox style or a new client-side POI source.
- **New state:** `CURIOUS` between ROAM and LINGER. Triggered by POI
  proximity; transitions to LINGER (or new SNIFFING) on arrival.
- **New asset:** sniff pose for the dog. Until real dog art lands, the
  arrow placeholder can simply hold the last direction.

**Open questions for design phase:** which POI types qualify, how to
debounce repeated visits to the same POI, whether the dog "ignores" the
user during a CURIOUS pursuit or still respects the leash.

### B. Marks on the map (pee/poop)

The dog drops a persistent mark at the spot it sniffs. Marks render as
small icons on the map, persist across walks, and are visible to the user
on subsequent walks ("the dog has been here"). Possibly visible to other
players in shared territories later.

**Architectural mapping:**

- **New subsystem.** Companion-adjacent but architecturally separate from
  the dog itself.
- **Storage:** new local store + sync path. Marks need to outlive an
  active walk; current companion state is RAM-only.
- **Policy event channel:** `stepPolicy` currently returns only a target
  offset. To trigger a mark deterministically, it needs an event output
  (e.g., `events: PolicyEvent[]`).
- **New rendering layer:** `MarkLayer` (separate Mapbox `ShapeSource` +
  `SymbolLayer`), consumed by a new `useMarks` hook reading from the
  store.
- **Backend:** if marks should sync, new `marks` table (`user_id`,
  `walk_session_id`, `mark_type`, `location`, `created_at`).

**Open questions:** are marks user-private or community-visible; do they
expire; what's the marking cadence (probability per LINGER episode);
moderation if they're community-visible.

### C. Other dogs in the area

When other players' companions (or AI dogs) are nearby, the dog can
detect them and either approach (social) or back off (depending on a
"temperament" tuning). Visible interaction: brief target swap toward the
other dog, hold for a few seconds, resume own behavior.

**Architectural mapping:**

- **Reuses:** world-anchored target mechanism. The leash + clamp already
  enforces "cannot run too far from owner" even during social pursuits.
- **New input to policy:** list of other entity positions.
- **New realtime channel:** other-player dog positions need to come from
  somewhere. Candidates: poll `/nearby` extended with companion data, or
  a new WebSocket/SSE channel for low-latency multiplayer presence.
- **New rendering:** the other dog needs to be drawn somehow. Either
  reuse the same `CompanionLayer` parameterized for non-self companions,
  or factor the layer ID/source ID as props and instantiate twice.
- **New state:** `SOCIAL` between ROAM and LINGER, with a tunable
  per-dog temperament that can be persisted.

**Open questions:** privacy model (do players opt in to being seen); how
to handle dog-on-dog interactions across the wire; latency tolerance.

### D. Chasing birds (transient prey)

Birds (or other wildlife) spawn in the world, the dog briefly chases,
the leash strains, the dog returns. Pure visual delight; no collection,
no marks, no persistence.

**Architectural mapping:**

- **Reuses:** leash hard-clamp already models "dog cannot escape but
  strains." Spring-damper already handles snap-back when the prey
  despawns.
- **New input to policy:** transient prey entities.
- **New state:** `CHASE` with elevated `dogMaxSpeed` (override the
  default 4 m/s during chase to make the sprint feel real).
- **New visual layer:** the bird itself, plus optional motion lines or
  dust effect — but those are polish.

**Open questions:** where do birds come from (procedural placement; no
backend needed if purely client-side); how often; whether they are
shared between players.

## Predictable v1 pressure points

These are the parts of iteration 1 that will need rework when the above
proposals land. Captured here so the constraints are visible before the
next iteration begins.

1. **Policy I/O is too narrow.** `PolicyStepInput` only accepts user
   and dog positions. Three of the four proposals (A, C, D) need a
   richer environment input (POIs, other entities, prey).
   `PolicyStepResult` only emits a target offset — proposal B (marks)
   needs an event output channel.

2. **Single-companion assumptions in the layer.** `companion-source` /
   `companion-layer` IDs are hardcoded in `CompanionLayer.tsx`.
   Proposal C (other dogs) will need either parameterized IDs or a
   layer factory.

3. **State is RAM-only.** Proposal B (marks) needs a persistence
   boundary that doesn't exist in iteration 1 — companion state dies
   on End Walk.

The fix for each pressure point is small and contained, but it is real
work that should be sequenced with whichever proposal lands first.

## What carries forward unchanged

- Pure-function `leash` / `direction` / `companionPolicy` — adding
  inputs and states is mechanical and unit-testable.
- Injected RNG → deterministic tests for every future stochastic
  behavior.
- World-anchored LINGER target — already the exact mechanic POI
  sniffing and bird chasing need.
- Hard leash clamp + speed cap — already model "dog cannot escape but
  strains realistically."
- Decoupled render (`CompanionLayer`) from logic (`useCompanion`) —
  new visual layers slot in beside without touching the hook.

## Recommended next move

If iteration 2 is worth a sprint, **Proposal A (POI sniffing)** is the
cheapest first step: it is the most direct reuse of the world-anchored
target primitive already in the code, requires no new persistence and
no new backend, and adds the most "the dog has its own agenda" feel
per line of code.

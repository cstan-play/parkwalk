# Gus Personality Chat

Gus is ParkWalk's personality-first digital dog. This document tracks the
non-spatial chat/reminder surface. The spatial map companion remains documented
in `16-COMPANION.md`.

## Status

**Sprint 0 — substrate shipped locally.**

- `shared/src/gusVoice/BIBLE.md` is filled in and is the writing source of
  truth for Gus's voice.
- `shared/src/gusVoice/categories.ts` carries the runtime few-shots, stock
  lines, models, and quick-reply definitions.
- `backend/src/modules/gus/` exposes authenticated profile, prefs, messages,
  and chat endpoints under `/api/v1/gus`.
- Prisma has `dog_profiles`, `gus_prefs`, `chat_messages`,
  `user_daily_state`, and `medications` in
  `20260510000000_gus_phase_1`.
- Mobile has notification permission plumbing and a dog-profile setup screen.

**Sprint 1 — chat UI shipped locally.**

- `mobile/src/screens/ChatScreen.tsx` opens the server-backed chat thread.
- `mobile/src/stores/chatStore.ts` loads messages from the backend and sends
  new user messages through `POST /api/v1/gus/chat`.
- `mobile/src/navigation/RootNavigator.tsx` registers the authenticated
  `Chat` route.
- `mobile/src/screens/MapScreen.tsx` exposes a compact `Gus` entry point in
  the walk panel.

The chat is intentionally online-first for this sprint. The backend/Postgres
thread is the source of truth; the mobile store is in-memory only and reloads
the thread when the screen opens.

**Sprint 2 — tap-response data collection shipped locally.**

- `POST /api/v1/gus/quickReply` validates a tapped button against the source
  Gus message, writes the relevant value to today's `user_daily_state`, marks
  the source message's `selectedReply`, and threads a `user_quick_reply` plus
  `gus_quick_reply_followup`.
- `mobile/src/screens/ChatScreen.tsx` renders inline quick-reply buttons under
  eligible Gus messages and disables them after selection.
- `mobile/src/stores/chatStore.ts` handles quick-reply submission and replaces
  the source message with the server-updated row so reloads stay consistent.

**Provider update — xAI/Grok supported.**

- `backend/src/modules/gus/voice.service.ts` can call xAI's OpenAI-compatible
  chat completions endpoint with Node `fetch`.
- Provider selection is controlled by env vars; if no provider key is present,
  Gus still uses fallback strings so smoke tests can run without paid LLM calls.
- `GET /api/v1/gus/models` lists backend-visible models for the current
  provider. For xAI, the backend asks `/language-models` first and falls back to
  `/models`.
- Settings exposes dropdown-style selectors for the chat model and reminder
  model. Selections are stored in `gus_prefs.chat_model` and
  `gus_prefs.notification_model`.

**Sprint 3 — local chat-notifications shipped locally.**

- `POST /api/v1/gus/notification/fire` generates and persists a
  `gus_notification` row for `morning_check_in`, `walk_reminder`, or
  `post_walk_debrief`.
- `mobile/src/notifications/scheduler.ts` schedules local Notifee trigger
  notifications from `gus_prefs`.
- `mobile/src/notifications/handler.ts` opens Chat on notification tap and
  asks the backend to create the full Gus message.
- Settings includes reminder toggles, HH:MM time fields, quiet hours, and
  test buttons that fire in about 30 seconds.
- Ending a walk schedules a one-shot post-walk debrief notification.

## Runtime Flow

1. User opens Map and taps `Gus`.
2. `ChatScreen` mounts and calls `GET /api/v1/gus/messages`.
3. User types a message.
4. `chatStore.sendMessage()` calls `POST /api/v1/gus/chat`.
5. Backend persists the `user_message`, assembles dog profile + walk context +
   recent history, calls the voice service, persists the `gus_reply`, and
   returns both rows.
6. Mobile appends both rows to the visible thread.

Quick-reply flow:

1. A Gus message has `quickReplies`.
2. User taps one.
3. Mobile calls `POST /api/v1/gus/quickReply` with `{ messageId, value }`.
4. Backend validates ownership and that the value belongs to the message.
5. Backend upserts today's `user_daily_state` field named by the reply's
   `dataField`.
6. Backend marks the original message selected, creates the user tap row, and
   creates Gus's follow-up row.
7. Mobile disables the button row and appends the two new rows.

Notification flow:

1. App launch or Settings save schedules enabled local notifications.
2. iOS shows the stock line from `categories.ts` at the trigger time.
3. User taps the notification.
4. App opens Chat and calls `POST /api/v1/gus/notification/fire`.
5. Backend generates the real Gus message with the selected reminder model,
   persists it with `kind='gus_notification'`, and returns it.
6. Mobile appends it to the chat thread; category quick replies render under
   the message.

If no LLM key is configured, the backend deliberately returns a fallback string
so the route can still be smoke-tested end to end.

## LLM Configuration

Set one of these providers on Railway:

```bash
# Recommended for Grok
GUS_LLM_PROVIDER=xai
XAI_API_KEY=...
XAI_BASE_URL=https://api.x.ai/v1
GUS_XAI_CHAT_MODEL=grok-4.3
GUS_XAI_NOTIFICATION_MODEL=grok-4.3

# Optional legacy/default Anthropic path
GUS_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

If `GUS_LLM_PROVIDER` is omitted, the backend auto-picks `xai` when
`XAI_API_KEY` is present, then `anthropic` when `ANTHROPIC_API_KEY` is present,
then `fallback`.

The env model values are defaults. Once a user picks a model in Settings, the
per-user `gus_prefs` model value overrides the env default for that user's Gus
messages.

## Message Shapes

The chat screen renders all `chat_messages` rows with the same bubble component
and keeps the row discriminators visible in code for later sprints.

| `kind` | `role` | Current behavior |
|---|---|---|
| `user_message` | `user` | Right-aligned user bubble |
| `gus_reply` | `gus` | Left-aligned Gus bubble |
| `gus_notification` | `gus` | Created when the user taps a local Gus notification |
| `user_quick_reply` | `user` | Right-aligned row created after tapping a quick reply |
| `gus_quick_reply_followup` | `gus` | One-line Gus acknowledgment after a quick reply |

## Current Boundaries

Included:

- server-backed chat thread
- send/receive UI
- loading, empty, retry, and "Gus is thinking" states
- map entry point
- inline quick-reply rendering
- mood/motor/tremor/energy/meds/free-note writes to `user_daily_state`
- Settings model selectors populated from backend-visible provider models
- local scheduled notifications for morning check-in and walk reminder
- one-shot post-walk debrief notification after End Walk
- Settings test buttons for all three notification categories

Deferred:

- message ratings
- offline chat cache
- pagination
- weather integration
- generated first-message prompt

## Verification

Run:

```bash
npm --workspace=shared run typecheck
npm --workspace=backend run typecheck
npm --workspace=mobile run typecheck
```

Manual smoke:

1. Apply the Gus migration to the target database.
2. Start the backend with `GUS_LLM_PROVIDER=xai` and `XAI_API_KEY` set for
   Grok output, or leave provider keys unset for fallback-path testing.
3. Sign in on mobile.
4. Tap `Gus` from the map.
5. Send a short message.
6. Confirm both the user message and Gus reply appear.
7. Leave and reopen the chat; the thread reloads from the backend.
8. Seed or generate a Gus message with `quickReplies`; tap one and confirm the
   row disables, a user tap appears, Gus follows up, and `user_daily_state`
   updates for today.
9. Open Settings, choose a chat model from the dropdown, send a Gus message,
   and confirm `chat_messages.model_used` matches the selected model.
10. Open Settings, tap `Test morning`, background or lock the app, wait about
    30 seconds, tap the notification, and confirm a `morning_check_in`
    `gus_notification` appears in chat with mood quick replies.
11. Repeat with `Test walk` and `Test debrief`.
12. End a normal walk and confirm a post-walk debrief notification is scheduled
    for about 10 minutes later.

## Next Sprint

Sprint 4 should refine scheduled chat-notifications:

- replace HH:MM text fields with native time pickers
- add duplicate-tap/idempotency protection for notification fire
- add better pending-notification recovery telemetry
- dogfood quiet-hour edge cases before expanding categories

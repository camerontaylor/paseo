# Using the Desvio feature set

Feature guide for the Desvio release with the 2026-10-24 TMAD intake, organized
by the labels you actually see in the UI. Entry point, first use, host
requirement, and recovery for each area. Per-feature evidence lives in the
[feature matrix](plans/tmad-desvio-feature-matrix-2026-10-24.json).

## Host requirements

Features gate on the host's reported capabilities (`server_info.features.*`).
When your client is newer than a host, the surface shows an update notice — for
example "Update the host to use Stream" or "Update the host to use voice while
the agent works" — instead of failing silently. Connecting to an older host is
not the same as the feature being unavailable; the notice distinguishes them.
Update the daemon on that host to enable the feature.

## Stream (per conversation)

Entry: open an agent, then the **Stream** tab in the panel next to **Chat**.
Stream captures questions, source messages, asks and artifacts for that
conversation. Requires a host advertising `companionStreamPortV1`; older hosts
keep file artifacts below the notice.

- Tabs: **Checklist** (asks and messages needing ask review), **Activity**
  (everything captured), **Stream pins** (pinned messages, excerpts and notes).
  Artifacts show by default on **Activity** and are hidden on filtered views.
- Filters: **Status** (All / Open / Done, or Closed on Activity), **Source**
  (All sources / Your messages / Agent messages). The counts line shows open
  and matching totals; **Clear filters** resets.
- Adding asks: on **Checklist**, use the "A request to track…" box and
  **Add ask**; notes and questions have their own boxes. Requires
  `trackedAsks` on the host. Ask state moves Open → In progress → Blocked →
  Done; Done asks for completion evidence. Unreviewed messages are marked
  "Needs ask review" — marking a user message reviewed is not task completion.
- Pins: select text in chat or use a message's pin menu — **Pin selected text
  to Stream**, **Pin message to Stream**, or **Pin excerpt…**. Pins hold up to
  4,000 characters; longer input opens the excerpt editor instead of
  truncating. Saved pins confirm "Saved to Stream" and can be unpinned.
- Recovery: failed saves show "Could not save. Please retry." inline and stay
  on screen. Offline shows "Reconnecting. Saved items remain available; pending
  status may be out of date." A degraded host shows a capture-degraded notice
  and keeps entries. Stream history survives restarts; pages load 50 items at
  a time via **Load more**. History the host already pruned cannot be
  reconstructed.

## Stream across conversations, and Views

Entry: **Stream** in the sidebar (route `/stream`). Aggregates captured items
across hosts. Requires `globalStream`; per-row actions need `trackedAsks`.

- Tabs: **All**, **Needs a reply**, **Pinned**. Search by
  "Search Stream or conversations", filter by host, include archived chats,
  refresh or pull to refresh. Results page with **Load more**.
- A host that fails to answer is not shown as empty: the notice above the list
  says which hosts responded, and "No items available from the hosts that
  responded. Check the notices above." distinguishes that from "No items match
  this view."
- **Views** (sidebar section) are saved cross-project layouts. **New View**
  creates one; add sessions with "Add session" or "Split with session", rename
  or delete from the view menu. **Broadcast to View** sends one message to
  every agent in the view — requires the durable queue; the summary reports
  sent, queued and skipped. Views are local layout state; deleting one does
  not touch sessions.

## Favorites, history and sidebar order

- **Pin to top** / **Unpin** (workspace menu) pins a workspace to the top of
  its group; requires `workspacePinning`. **Labels** organize workspaces with
  colored labels (requires `workspaceLabels`; "Create label" lives in the
  label manager). **Pin project** / **Make default project** pin a project
  within a workspace (`projectPinning`).
- **Sort by** (Display preferences, the sidebar's sliders button): **Latest
  conversation**, **Your latest message**, **AI's last reply**, **Manual**,
  **Title**. The activity-based options need `conversationMessageActivity` on
  every visible host; otherwise only Manual and Title appear. Ordering follows
  message activity, not visits. **Grouping** switches between Project, Status
  and Labels; **Show** toggles branch, host, pull request, checks, services,
  labels, diff stats and **Last activity** (the row timestamp).
- **Mark as read** / **Mark as unread** on workspaces and tabs keep unread
  state honest across devices (host-gated). Unread workspaces and tabs show a
  dot; subagent drawers show "N unread".
- **History** (sidebar) lists sessions with "Search history" and **Load
  more**; recently closed agents reappear under "Recently closed" at the top.
- Rename from the tab or workspace menu (**Rename**, **Rename workspace**):
  it renames only the focused agent or terminal, keeps the failed text in the
  field if the save fails, and persists after reload.
- Turn footers show "{{timestamp}} · Worked for {{duration}}".

## Find, routing and Quick launch

- The sidebar find field ("Filter projects or chats") narrows projects,
  workspaces and tab titles. With `sessionTextSearch` on the host,
  **Filter scope** adds **Names + messages**, searching message text too;
  otherwise the menu says "Messages need a host update". Enter on a pasted
  session ID opens the exact chat when it matches one visible chat.
- **Find in chat** (and pane find, `agentHistorySearch`) searches the loaded
  conversation.
- Routing a draft: open the routing composer from Find ("Find with AI" →
  "Send to an existing chat"). It searches configured matching, shows
  "Matching conversations", and **Route to best match** delivers the prompt to
  the best-scoring chat when the confidence rules are met. Ambiguity is
  honest: "No clear best match. Choose the destination; nothing sent yet." —
  your draft is preserved and nothing sends from passive search alone.
- Routing is queue-only delivery: the receipt says **Queued for {{project}} ·
  {{chat}}**, and "Waiting for host acknowledgement. Your prompt is preserved;
  retry uses the same delivery ID." A receipt means the host admitted the
  message, not that the agent finished it. If the destination moved, you get
  "The selected chat moved or is no longer available. Choose a destination
  again." — the prompt stays in your draft. Requires `sessionSearch`,
  `routedQueueAdmission` and `durableAgentQueueV1`.
- **Quick launch** (Cmd/Ctrl+Shift+L, or "Quick launch agent…" in the command
  center): type what the new agent should do, choose **New workspace** or
  **New tab in {{workspace}}**, then **Start and open** (switch to it) or
  **Start** (create without leaving). One create attempt runs at a time; a
  failed start is retryable without duplicates.

## Side conversations and threaded replies

- **Reply in thread** on an assistant reply opens a side conversation anchored
  to that reply; the source stays reachable via **Open source reply**, and a
  missing source says "The source reply is no longer available." Side
  conversations have their own composer ("Ask a side question...").
- **Send answer to main queue** routes the side answer into the main
  conversation's durable queue ("Answer added to main queue" confirms
  admission, not completion). The main draft and scroll position are never
  moved by side activity.
- Where side surfaces open is a setting: **Open location** maps sources —
  including "Clicking a subagent in an agent chat" — to **Main panel**,
  **On the side**, or **Explorer sidebar** (`uiTabPlacement`). The
  **Subagents** / **Checklist** switch and "Show checklist beside chat" live
  in the same surface family. Provider subagents stay read-only.

## Delivery marks and Unsent

User messages carry a delivery mark (press it when it needs attention):

| Mark | Meaning |
| --- | --- |
| "Saved on this device — waiting for the host" | queued locally, not yet admitted |
| "Received by the host" | host admitted it |
| "Delivered to the agent" | the agent received it |
| "Not delivered yet — needs attention" | refused, retrying, or uncertain |

Pressing an attention mark explains the state: refused (with the host's
error), retrying ("The host has not answered after N tries. The message is
saved on this device and retries whenever the host reconnects."), or uncertain
("The host stopped while submitting this message, so it may already have it.
Retry only if the agent did not receive it."). **Retry now** resends with the
same identity; **Keep waiting** leaves it queued.

The composer's **Unsent messages (N)** track lists unsent items with
**Retry now**, **Move back to the message box** (only when the host positively
refused — editing is safe only then), and **Discard unsent message**. Queued
messages offer **Move up** / **Move down** / **Delete** / **Retry**, and
status text distinguishes "Not synced yet — saved here, still retrying" from
"On the host — sends when the agent is free". An offline device's messages
report as held, never as zero pending.

## Inspection and diagnostics from the CLI

- `paseo target set|show|clear` — persist the default daemon target for CLI
  commands (stored in `cli.json`); `clear` returns to local daemon discovery.
- `paseo queue ls <agent>` — "Show what waits on the host, what was delivered,
  and what devices still hold", separated into host queue, delivery/receipt
  history and device-reported backlog sections. Requires `deliveryInspect`;
  older hosts answer "Update the host to use this: it does not report message
  delivery state."
- `paseo diagnostics errors` — "List reported client errors and GPT Realtime
  failures, newest first", with `--limit`, `--since` (30m, 2h, 1d or ISO) and
  `--source` (toast, voice, rpc, global, host-voice). Requires
  `clientDiagnostics`. Device reports are bounded, redacted before persisting,
  and clear on acknowledgment.
- `scripts/reconcile-queue-alias.mts` — offline maintenance only ("never
  starts a daemon or replays a provider prompt"): `inspect PLAN` reports
  read-only; `apply-offline PLAN NEW_EVIDENCE_DIRECTORY` writes to a fresh
  directory, refusing stale plan hashes. Installing it authorizes nothing
  against live production data.

## Voice

Two entry points, both in the composer (and in the new-workspace flow):

- **Voice mode** (AudioLines icon, "Enable Voice mode"): ordinary dictation
  and speech flow.
- **GPT Realtime voice** (CircleDot icon, "Start GPT Realtime voice"): the
  realtime transport, shown when the host advertises `openaiRealtimeVoice`.
  Creating an agent for voice in an empty workspace admits exactly one empty
  agent before voice starts — navigating away or rapid taps never double-create.

Voice states are explicit: **Microphone on**, **Not listening**,
**Microphone interrupted**, plus host errors such as "Host disconnected.
Microphone input is paused until it reconnects." Permission denial says so
directly and offers retry; there is no silent microphone.

- **Verbal mute** (opt-in, `voiceVerbalMute`): say "mute microphone" and the
  overlay switches to "Listening for 'unmute microphone'" while the mic stays
  live for that one phrase; unrelated speech is discarded. "unmute microphone"
  resumes input.
- **GPT Realtime mute**: muting stops host capture and upload outright; only
  the **Unmute realtime voice** button resumes. If the host disconnects or the
  ACK fails, capture stays off and the overlay offers recovery ("Retry GPT
  Realtime" / **Stop realtime voice**).
- Queued speech attachments report truthfully: "Speech queued for agent",
  "Speech sent to agent", "Speech delivery uncertain", "Speech removed from
  queue". Recordings and queued messages survive reconnects without double
  sending.
- Platform limits: voice runs where the client and host support capture.
  Browser evidence does not certify native behavior. iOS background dictation
  is unverified — the fleet has no iPhone; Android results are recorded per
  row in the feature matrix. GPT Realtime requires the host to be configured
  with its own realtime key; this fork never ships source private endpoints.

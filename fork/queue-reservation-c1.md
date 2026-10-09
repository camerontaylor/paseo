# Queue outbox: attempt reservation (C1, fork-specific)

The upstream TMAD queue outbox retries an un-acked enqueue forever behind an attention toast. Our
carry diverges deliberately: 8 attempts, then the entry parks in a visible failed state with explicit
retry/discard (`docs/queue-mirroring.md`, "Exhausted retries stay visible").

The reservation is the fork-side mechanism that keeps that cap exact under storage failure:

- Every automatic send is preceded by a durable attempt reservation — the incremented attempt count is
  persisted and awaited *before* the enqueue goes out. A send only ever happens with its attempt number
  already on disk, so neither a mid-flush storage failure nor an app restart can push an entry past
  eight automatic attempts.
- A failed reservation blocks the agent's flush lane; nothing is sent.
- An entry already at the cap is parked on sight without sending, so a restart that lost a failed park
  write still cannot re-send it.
- A failed park write keeps the fence in-process (`parkedVolatile`) on top of the in-memory `failedAt`.
- Automatic flushes are probe-gated: a real storage write must succeed before the flush lists anything,
  so persistently failing storage permits zero automatic sends.

Conservative cost: a crash between reservation and send burns the reserved attempt, so an entry can
park one attempt early. Explicit retry remains available. Over-counting is safe; under-counting would
be an unbounded retry.

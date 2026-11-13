# Concurrency and Speech Budgets

The defaults per server process are 4 active projects, 2 concurrent LLM requests,
2 image workers and 3 video workers. Image/video slots cover submission, polling,
download and preview conversion; they are shared across projects, not multiplied
by the project count. Another server process does not share these limits.

Override before starting the server with `DRAMA_MAX_PROJECTS`,
`DRAMA_LLM_CONCURRENCY`, `DRAMA_IMAGE_CONCURRENCY`, or
`DRAMA_VIDEO_CONCURRENCY` (integers 1 through 8). These are local worker limits,
not a statement of provider quotas. Increase only after checking actual latency
and 429 responses. Restart only after active requests have reached a checkpoint.

LLM requests use FIFO slots. A 429 retry waits outside its slot. Paused projects
are checked before a queued request starts. Extra projects beyond the limit are
rejected explicitly, not silently queued. Same-project episode planning remains
ordered; character masters precede variants; continuing video shots still wait
for the predecessor and the existing pilot approval gate.

The health endpoint `/api/drama/health` exposes current worker counts and limits.
Task logs distinguish queued requests, active requests, retry waits and latency.
The page's service-status tooltip shows the configured limits after refreshing.

Speech validation remains 2.5-7 spoken characters per second with at least three
seconds of off-screen narration. Overlong lines get a targeted rewrite capped at
6 characters per second, preserving timestamps, speakers, visual direction and
all other lines. A failed rewrite cannot bypass validation or start paid video
generation. Accepted rewrites retain the original text under `speechScore.repair`.

## Validation

```powershell
node --test
node tools/drama-production-browser-qa.cjs
node tools/drama-assets-browser-qa.cjs
Invoke-RestMethod http://127.0.0.1:4329/api/drama/health
```

The automated scheduler tests use isolated projects and mocked providers. They
verify overlap, caps, FIFO order, pause, retries, failures and reuse without
duplicate submissions. Provider capacity must be verified separately.

# EduPilot AI — Reference Backend (Phase 9)

A small, genuinely-working Node/Express server that implements the
contracts in [`../EVALUATION_BACKEND.md`](../EVALUATION_BACKEND.md) and
[`../ASSIGNMENT_GENERATOR_BACKEND.md`](../ASSIGNMENT_GENERATOR_BACKEND.md).
It replaces the "illustrative only" pseudocode those documents used to show
in isolation — this one actually runs, with two honest modes:

| | No configuration | `ANTHROPIC_API_KEY` set |
|---|---|---|
| Handwriting OCR | Real, open-source Tesseract OCR (`tesseract.js`) | Real Claude vision model reads the images directly |
| Answer grading | Deterministic heuristic (MCQ-only, see below) | Real Claude vision model grades against the marking scheme |
| Question generation | Not available — frontend uses its built-in demo generator | Real Claude text generation, grounded only in the lecture content sent to it |

Nothing here ever fabricates a result. Where a mode genuinely can't
determine something, it says so (via the `flags` in the contract) and
assigns 0 suggested marks rather than guessing.

## Setup

```
cd server
npm install
npm start
```

The server listens on `http://127.0.0.1:8787` by default (see `.env.example`
to change the port or add an API key). Then, in EduPilot AI's **Settings**
page, set:
- **AI Evaluation Backend URL** → `http://127.0.0.1:8787/evaluate`
- **Assignment Generator Backend URL** (optional) → `http://127.0.0.1:8787/generate-assignment`

No account, signup or API key is required for the default (Tesseract) mode.

## Honest limitation: Tesseract on handwriting

Tesseract (the OCR engine `tesseract.js` wraps) was built and tuned for
**printed text**, not handwriting. Real-world evidence on handwritten text:

- A widely-cited benchmark (Tesseract 2.01, user-trained) measured ~83.5%
  character accuracy on handwritten Roman script, but with over 5% of
  characters failing to segment at all and word-level accuracy
  "substantially lower" than the character-level number, due to
  segmentation issues on connected/cursive strokes.
  ([source](https://deepai.org/publication/recognition-of-handwritten-roman-script-using-tesseract-open-source-ocr-engine))
- A 2025 industry analysis states plainly that "even with extensive
  preprocessing and parameter tuning, Tesseract rarely achieves acceptable
  handwriting recognition accuracy," contrasting it with newer LLM-based
  vision tools reaching far higher accuracy in controlled tests.
  ([source](https://extend.ai/resources/best-handwriting-ocr-tools-business))

**In practice**: expect the demo's default (no-API-key) mode to frequently
misread, merge or drop characters on real handwritten answer sheets — this
is a genuine, inherent limitation of open-source OCR, not a bug in this
server. It is why every OCR result includes a real confidence score, and
why `low_confidence_ocr` / `illegible_handwriting` flags exist and are
used honestly rather than suppressed. Setting `ANTHROPIC_API_KEY` swaps in
a real vision-capable model, which reads handwriting far more reliably —
that's the intended upgrade path for anything beyond a casual demo.

## Why MCQ-only heuristic grading (no key configured)

Without a real vision/reasoning model, there is no honest way to:
- Determine which option a student circled or ticked on a printed MCQ
  (text OCR doesn't detect circles/ticks) — this server instead looks for
  the student having *written* the option letter or the option's own text
  near their answer, and says exactly that in `reasoning` when it does.
- Judge the correctness of a free-form written answer (short/long/sum)
  without actually understanding it.

So: MCQ questions get a best-effort, clearly-explained heuristic guess
(`ambiguous_grading` if nothing is found); every other question type
always returns `suggestedMarks: 0` with `ambiguous_grading` and a note that
automated grading of free text needs a real AI model. The teacher reviews
and edits every suggestion before anything is approved — this server never
finalizes a mark.

## How images map to questions (no API key)

If you upload exactly as many images as there are questions, image *N* is
treated as the answer to question *N* (one photographed page per question,
in the same order as the question paper — a convention, not a guess).
Any other image count falls back to giving every question the combined
OCR text from all images, flagged `uncertain_question_match`, since
splitting a multi-question page into per-question answers without a
vision-reasoning model isn't something plain OCR can honestly claim to do.
With `ANTHROPIC_API_KEY` set, the model sees every image and every
question together and does this matching itself.

## Security notice

This is a **demo reference implementation**, not production-ready:
- CORS defaults to allowing only `localhost`/`127.0.0.1` (any port). Set
  `ALLOWED_ORIGINS` (see `.env.example`) to permit a specific deployed
  frontend origin too — see "Deploying publicly" below. An unlisted
  origin gets a `403` and no `Access-Control-Allow-Origin` header.
- There is no authentication on any endpoint. Per the Phase 9 scope, this
  project deliberately does not add login/auth. A per-IP rate limit
  (`AI_RATE_LIMIT`, default 20 requests/15min on the three AI-backed
  routes) exists only as a blunt cap against runaway API cost — it is not
  real abuse protection, and does nothing to stop a determined attacker
  who isn't going through a browser's CORS restrictions.
- Uploaded images are processed in memory and discarded after the
  response; nothing is written to disk or a database by this server.

See `../EVALUATION_BACKEND.md` §4 for the full list of things a real,
publicly-deployed version of this would need (real auth, per-tenant
authorization, proper rate limiting, retention policy, etc.) — none of
that is in scope for this reference implementation.

## Deploying publicly (e.g. Render)

A `render.yaml` Blueprint is included at the repo root so Render can
provision this automatically:

1. Push this repo to GitHub (already done if you're reading this from
   the repo) and sign in to [Render](https://render.com) with that GitHub
   account.
2. **New → Blueprint**, select this repo. Render reads `render.yaml` and
   proposes one web service (`edupilot-ai-backend`, free plan, rooted at
   `server/`).
3. Before deploying, set the **`ANTHROPIC_API_KEY`** environment variable
   yourself in Render's dashboard (it's marked `sync: false` in the
   blueprint specifically so it is never written into the repo or typed
   by anyone else — paste it there directly, not anywhere in this
   project). Real AI features won't work without it (or without a funded
   balance on that key).
4. Adjust `ALLOWED_ORIGINS` in the blueprint/dashboard if your deployed
   frontend isn't at `edupilot-ai-nine.vercel.app`.
5. Once deployed, Render gives you a URL like
   `https://edupilot-ai-backend.onrender.com`. In EduPilot AI's
   **Settings** page, point each backend URL field at it (e.g.
   `.../evaluate`, `.../generate-assignment`, `.../analyze-mistakes`) —
   exactly like pointing them at `127.0.0.1:8787` locally, just a public
   URL instead. This is still opt-in per browser/visitor; nothing in the
   frontend auto-connects to it.

**Free-tier note:** Render's free web services sleep after inactivity —
the first request after idle can take 30–50 seconds while it wakes up.
The frontend's existing honest-failure UI (spinner / error message, never
a fake result) handles this fine; it just looks slow on that first call.

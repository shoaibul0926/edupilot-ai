# EduPilot AI — Doubt Solver Backend Contract (Phase 7)

Like evaluation (see `EVALUATION_BACKEND.md`), genuine AI-generated doubt
answers require a **backend you deploy and control**, holding your AI
provider's credentials server-side. EduPilot AI's frontend is a single
static HTML file with no server of its own and never embeds or sends an
API key from the browser.

The frontend's `AIDoubtService.ask()` (in `index.html`) makes a real
`fetch()` call to the URL configured on the **Settings** page. If that
field is empty, or the request fails, the Doubt Solver falls back to a
clearly-labelled demo sample response — it never presents a fabricated
answer as real AI output.

## 1. Request

`POST <your-endpoint-url>` with `Content-Type: application/json`:

```jsonc
{
  "board": "karnataka",
  "class": "5",
  "subject": "Mathematics",
  "chapter": "Chapter 4: Fractions",
  "topic": "Adding like fractions",
  "lectureId": "lec_xxxxx",
  "lectureTitle": "Introduction to Fractions",
  "language": "English",                 // "English" | "Hindi" | "Kannada"
  "expectedLevel": {
    "label": "Elementary (Classes 3-5)",
    "style": "simple, clear language with everyday examples",
    "answerLength": "one to two short sentences"
  },
  "groundingSources": {
    "transcript": "",                    // empty string if none captured yet
    "referenceNotes": "Refer to KTBS Mathematics Class 5, Chapter 4...",
    "description": "A beginner-friendly walkthrough of what fractions represent...",
    "objectives": "Understand what a fraction represents\nAdd two fractions with the same denominator"
  },
  "curriculumContext": [
    { "board": "karnataka", "class": "5", "subject": "Mathematics", "chapter": "Chapter 4: Fractions", "topic": "Adding like fractions", "year": "2026-27" }
  ],
  "segments": [
    { "label": "Adding fractions with the same denominator", "seconds": 165 }
  ],
  "conversationHistory": [
    { "from": "user", "text": "How do I add fractions?" },
    { "from": "bot", "text": "..." }
  ],
  "question": "Can you give me a worked example?"
}
```

**Ground the answer only in `groundingSources`, `curriculumContext` and
`segments`.** Do not have the model invent facts, lecture content, or
citations beyond what's provided. If these fields are too sparse to answer
confidently, return `insufficientContent: true` (see §2) rather than
guessing — the frontend already checks for *some* content before calling
you, but the backend should make its own judgment too, since "some content"
isn't the same as "enough to answer this specific question."

## 2. Response

`200 OK` with:

```jsonc
{
  "answer": "To add 1/7 + 2/7, add the numerators (1 + 2 = 3) and keep the denominator: 3/7.",
  "insufficientContent": false,
  "citation": {
    "segmentIndex": 0,        // index into the `segments` array you were sent, or null
    "verified": true          // true only if you are confident this segment actually covers the answer
  }
}
```

- `citation.segmentIndex` must index into the **same `segments` array the
  request sent** — the frontend looks up that segment's real timestamp
  from its own lecture data, it does not trust a raw timestamp number from
  you. If you cannot confidently tie the answer to one specific segment,
  return `segmentIndex: null` (the frontend then falls back to its own
  keyword heuristic, or links to the start of the lecture) rather than
  guessing an index.
- Set `verified: false` if you're offering a segment as a plausible but
  not certain match. The frontend labels unverified matches as such.
- If you cannot answer reliably from the supplied grounding content, return
  `{"insufficientContent": true}` with no `answer` (or an empty one) — the
  frontend will tell the student to ask their teacher or pick another
  lecture, rather than show a weak guess.

On failure, a non-2xx status with a plain-text or JSON body describing the
error; the frontend surfaces your status code and message to the student.

## 3. Safeguards required for a school environment (req 13)

This demo includes only a minimal, generic client-side keyword filter as a
first line of defence — **your backend must implement real safeguards**,
at minimum:

- **Content moderation** appropriate for school-age users: refuse or
  redirect off-topic, inappropriate, or unsafe questions (self-harm,
  violence, explicit content, etc.) with a supportive, non-alarming
  message, and consider escalation/logging for genuinely concerning
  content per your institution's policy.
- **Stay on-topic**: decline questions unrelated to the selected
  curriculum context rather than answering as a general-purpose chatbot.
- **No personal data collection**: this app never sends a student's name
  or any identifier in the doubt-solver payload — don't add any either.
  Treat `conversationHistory` as ephemeral working context, not a
  permanent profile.
- **Rate-limit** per session/IP to control cost and abuse.
- **Log for teacher oversight** (question + answer, not raw student
  identity) so teachers can review what the AI told students, consistent
  with how a real classroom tool should be auditable.

## 4. Security and privacy

Everything in `EVALUATION_BACKEND.md` §4 applies equally here: authenticate
every request (this frontend has no login system), keep provider
credentials server-side only, and authorize access appropriately — there
is no student identity in this payload to authorize *by*, but the endpoint
itself should still require a valid session/API key so it isn't open to
the public internet.

## 5. Minimal illustrative sketch

Not production-ready — illustrative only, to show the shape of a real
implementation. Add authentication, moderation, and rate-limiting before
deploying anywhere real.

```js
// server/doubt-solver.js  (illustrative only — not production-ready)
import express from 'express';
const app = express();
app.use(express.json());

app.post('/api/ai/doubt-solver', async (req, res) => {
  // TODO: authenticate the request before doing anything else.
  const { groundingSources, curriculumContext, segments, question, language, expectedLevel } = req.body;

  const hasContent = Object.values(groundingSources || {}).some(v => (v || '').trim().length > 0);
  if (!hasContent) return res.json({ insufficientContent: true });

  // TODO: run a real content-moderation check on `question` before calling
  // your AI provider, and on the generated answer before returning it.

  try {
    // Call your chosen AI provider here, instructing it to answer ONLY
    // from groundingSources/curriculumContext, in `language`, adapted to
    // `expectedLevel`, and to pick a segment index from `segments` only if
    // genuinely confident it covers the answer.
    const result = await callYourAIProvider({ groundingSources, curriculumContext, segments, question, language, expectedLevel });
    res.json(result); // must match the §2 response shape
  } catch (err) {
    res.status(502).send('Doubt-solver provider error: ' + err.message);
  }
});

export default app;
```

## 6. Configuring the frontend

Once deployed, open **Settings → AI Doubt Solver Backend** in EduPilot AI
and paste its URL. Stored in `localStorage` like the evaluation backend URL
— it's a plain configuration value, not a secret.

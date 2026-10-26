# EduPilot AI — Assignment Generator Backend Contract (Phase 9)

EduPilot AI's frontend is a single static HTML file with no server of its
own. It never holds, embeds, or sends an AI provider's API key — doing so
in client-side JavaScript would expose it to anyone who views the page
source. The Assignment Generator's built-in mode is therefore a
deterministic, template-based demo generator that never calls a real
language model.

Real AI-generated questions — grounded in a lecture's actual objectives,
reference notes, description or transcript — require a **backend you
deploy and control**, which holds your provider credentials server-side
and does the actual generation.

The frontend's `AIService.generateAssignmentQuestions()` (in `index.html`)
checks whether an **Assignment Generator Backend URL** is configured on the
**Settings** page. If so, it makes a real `fetch()` call there first. If
that field is empty, or the request fails for any reason, it falls back to
the original built-in demo generator — it never silently presents a mock
result as if a real model produced it. Every generated assignment records
which path actually produced it (`generatedBy`: `'real-backend'` or
`'demo-mock-ai'`), and the Assignment Generator page shows this in the UI.

This document specifies the contract your backend must implement, and the
requirements it must meet.

## 1. Request

`POST <your-endpoint-url>`

Content-Type: `application/json`

```jsonc
{
  "topic": "Adding like fractions",
  "chapter": "Fractions",
  "board": "cbse",
  "class": "5",
  "subject": "Mathematics",
  "expectedLevel": {
    "label": "Elementary (Classes 3-5)",
    "style": "simple, clear language with everyday examples",
    "answerLength": "one to two short sentences"
  },
  "groundingSources": {
    "objectives": "Add two fractions with the same denominator\nSimplify the result",
    "referenceNotes": "...teacher's reference notes text, if any...",
    "description": "...lecture description text, if any...",
    "transcript": "...lecture transcript text, if any..."
  },
  "config": {
    "mcqCount": 3,
    "shortCount": 2,
    "longCount": 0,              // 0 for class bands that don't allow long answers
    "sumCount": 0,                // 0 for non-Mathematics subjects
    "marksOverride": { "mcq": 1, "short": 2, "long": 0, "sum": 2 }
  }
}
```

`groundingSources` is **everything your backend is allowed to generate
from** — it comes directly from the lecture record the teacher created, not
from the YouTube link itself (the video is never fetched or transcribed by
this project). Treat it as the only source of truth: never invent facts,
figures, or correct answers the given content doesn't support. The
frontend already checked that at least one source is non-trivially present
before calling you (see `getLectureContentSources()`), but always re-check
on your side — if what's given is too sparse to responsibly produce the
requested question counts, generate fewer questions rather than filling in
gaps from the model's own general knowledge.

## 2. Response

On success, `200 OK` with:

```jsonc
{
  "questions": [
    {
      "type": "mcq",                       // "mcq" | "short" | "long" | "sum"
      "text": "Which one of these is correct about \"Adding like fractions\"?",
      "options": ["...", "...", "...", "..."],  // mcq only, else null
      "correctIndex": 1,                          // mcq only, else null
      "suggestedAnswer": "Add the numerators and keep the denominator the same.",
      "markingScheme": "Award full marks (1) for selecting option B; 0 marks otherwise.",
      "topicTag": "Adding like fractions",        // optional — falls back to the lecture's topic
      "difficulty": "medium",                     // optional — "easy" | "medium" | "hard", falls back to "medium"
      "marks": 1                                   // optional — falls back to the class band's default for this type
    }
  ]
}
```

The frontend validates only that `questions` is present and is an array;
a response missing it, or a non-2xx status, is treated as a backend
failure and triggers the demo-generator fallback (with a toast telling the
teacher this happened). Return a clear, actionable message in the body so
that fallback toast is useful — a plain-text or JSON error description is
fine.

Every question the frontend accepts from you is written into the
assignment as a **Draft** — nothing is published or sent to students until
a teacher reviews and approves it on the Assignment Generator page. Your
backend must never be the thing that finalizes an assignment.

## 3. Honesty requirements

- **Never fabricate content beyond `groundingSources`.** This is the one
  rule that matters most for this endpoint: a question, a correct answer,
  or a marking scheme that isn't actually supported by the lecture's own
  objectives/notes/description/transcript is worse than generating fewer
  questions. If the board/class/subject combination is unfamiliar or the
  grounding content is thin, say less, don't guess more.
- **Respect `config`'s requested counts and marks** as a ceiling, not a
  quota you must hit by any means — returning fewer questions than
  requested (including zero) is the correct behavior when the content
  doesn't support more, and is explicitly preferable to inventing filler
  questions.
- **Respect `expectedLevel`** — question complexity, vocabulary, and
  expected answer length should match the class band given, not be
  generic across all ages.
- There is no local heuristic fallback for this endpoint the way
  `/evaluate` has OCR+heuristics — generating new question text without a
  real reasoning/language model would mean fabricating lecture content.
  If you have no real model configured, return a clear `NOT_CONFIGURED`-style
  error (see `server/index.js` for the reference shape: HTTP 501 with
  `{"errorCode":"NOT_CONFIGURED","message":"..."}`) and let the frontend's
  own demo generator take over, rather than trying to approximate real
  generation without one.

## 4. Security and privacy requirements

- **Authenticate every request.** This demo frontend has no login system —
  do not deploy your backend without adding your own auth (e.g. a signed
  session token or API key issued to the teacher's account) and check it on
  every call. An unauthenticated endpoint that accepts arbitrary generation
  requests is not safe to expose publicly, both for cost-abuse reasons and
  because lecture content (`groundingSources`) may be a school's own
  curriculum material.
- **Keep provider credentials server-side only** — environment variables or
  a secrets manager, never committed to source control, never sent to the
  client.
- **Rate-limit and size-limit** requests to control generation cost and
  abuse — `groundingSources` fields are free text supplied by whoever is
  logged in as a teacher on the frontend.
- **Treat `board`/`class`/`subject`/`chapter`/`topic` as hints, not as
  authorization** — if your backend has its own notion of which teacher
  may generate assignments for which class/section, enforce that
  server-side from the authenticated session, not from these client-supplied
  fields.

## 5. Minimal illustrative sketch

This is **not** a production server — no auth, no rate limiting, no
validation beyond the basics. It exists only to show the shape of a real
implementation using Node/Express and a language-model provider's SDK. A
genuinely working reference implementation (using Claude) is in
[`server/`](server/) — see [`server/README.md`](server/README.md) to run
it locally; this sketch is a simplified illustration of the same idea.

```js
// server/generate-assignment.js  (illustrative only — not production-ready)
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/ai/generate-assignment', async (req, res) => {
  // TODO: authenticate the request before doing anything else.
  const body = req.body || {};
  if (!body.groundingSources) {
    return res.status(400).send('Missing groundingSources.');
  }

  try {
    // Call your chosen language-model provider here, grounding the prompt
    // ONLY in body.groundingSources and body.config. Keep the provider's
    // API key in process.env, never in source control.
    const result = await callYourLanguageModelProvider(body);
    res.json(result); // must match the §2 response shape
  } catch (err) {
    res.status(502).send('Generation provider error: ' + err.message);
  }
});

export default app;
```

## 6. Configuring the frontend

Once your backend is deployed, open **Settings → Assignment Generator
Backend** in EduPilot AI and paste its URL. The frontend stores this in
`localStorage` (plain text, as with everything else in this browser-only
demo — it is not a secret, since it's just a URL) and uses it for every
"Generate Assignment" and "Regenerate" action on the Assignment Generator
page from then on. Leaving it blank keeps the original demo mock generator
as the only mode, exactly as in Phase 3.

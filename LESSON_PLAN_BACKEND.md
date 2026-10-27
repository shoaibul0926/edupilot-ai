# EduPilot AI — Lesson Plan Backend Contract

Like the Assignment Generator, lesson plan generation needs a **backend you
deploy and control**, holding your AI provider credentials server-side. The
frontend's `AILessonPlanService.generate()` (in `index.html`) checks whether
a **Lesson Plan Backend URL** is configured on the **Settings** page. If so,
it makes a real `fetch()` call there first. If that field is empty, or the
request fails for any reason, it falls back to the built-in deterministic
demo template — it never silently presents a mock result as if a real model
produced it. Every generated lesson plan records which path produced it
(`generatedBy`: `'real-backend'` or `'demo-mock-ai'`).

This reuses the same grounding discipline as
`ASSIGNMENT_GENERATOR_BACKEND.md`: a lesson plan is generated **only** from
a lecture's own objectives, reference notes, description or transcript —
never from general subject knowledge the lecture content doesn't support.

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
  }
}
```

`groundingSources` is the only source of truth, exactly as in the
Assignment Generator contract — never invent activities or facts it doesn't
support. If it's too sparse to responsibly produce a full plan, generate
fewer steps rather than filling gaps from general knowledge.

## 2. Response

On success, `200 OK` with:

```jsonc
{
  "objectives": ["Add two fractions with the same denominator", "Simplify the result"],
  "materials": ["Fraction strips or blank paper", "Whiteboard"],
  "warmUp": "Ask students to recall what a numerator and denominator are.",
  "steps": [
    { "activity": "Introduce the concept", "duration": "10 min", "description": "Explain that fractions with the same denominator can be added by adding the numerators." },
    { "activity": "Guided practice", "duration": "15 min", "description": "Work through 2-3 examples on the board together." }
  ],
  "assessmentChecks": ["Can the student add two like fractions without help?"],
  "homework": "Complete the practice worksheet on adding like fractions.",
  "durationMinutes": 40
}
```

The frontend validates only that the object is present and `steps` is an
array; anything else, or a non-2xx status, triggers the demo-template
fallback (with a toast telling the teacher this happened).

## 3. No results without a real model

There is no local heuristic fallback for this endpoint — generating a
genuine lesson plan requires real reasoning, not a deterministic transform.
If no AI provider is configured, respond `501` with
`{"errorCode":"NOT_CONFIGURED","message":"..."}` and let the frontend's own
demo template take over.

## 4. Security and privacy requirements

Same requirements as `ASSIGNMENT_GENERATOR_BACKEND.md` §4: authenticate
every request yourself (this demo has no login system), keep provider
credentials server-side only, rate-limit and size-limit requests, and treat
`board`/`class`/`subject` as hints, not authorization.

## 5. Reference implementation

`server/lib/claude.js` (`generateLessonPlanWithClaude`) and the
`POST /generate-lesson-plan` route in `server/index.js` implement this
contract using the Claude API, reusing the same client setup as evaluation,
assignment generation and mistake analysis. Run `cd server && npm start` and
point Settings → Lesson Plan Backend at
`http://127.0.0.1:8787/generate-lesson-plan`.

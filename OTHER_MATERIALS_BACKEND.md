# EduPilot AI — Other Materials Backend Contract

Like the Lesson Plan generator, free-form "other teaching materials" need a
**backend you deploy and control**, holding your AI provider credentials
server-side. The frontend's `AIOtherMaterialService.generate()` (in
`index.html`) checks whether an **Other Materials Backend URL** is
configured on the **Settings** page. If so, it makes a real `fetch()` call
there first. If that field is empty, or the request fails for any reason,
it falls back to a deterministic demo template — it never silently presents
a mock result as if a real model produced it. Every generated material
records which path produced it (`generatedBy`: `'real-backend'` or
`'demo-mock-ai'`).

This covers everything the Assignment Generator (worksheets, question
papers) and Lesson Plan generator don't: revision notes, flashcards, study
guides, activity sheets, rubrics, vocabulary lists, and anything else a
teacher asks for — deliberately modeled as a generic title + list of
sections rather than a separate schema per material type.

## 1. Request

`POST <your-endpoint-url>`

Content-Type: `application/json`

```jsonc
{
  "materialType": "Flashcards",
  "description": "One card per key vocabulary word, front = word, back = definition and an example sentence",
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

`materialType` is a short label (the frontend offers presets — Revision
Notes, Flashcards, Study Guide, Activity Sheet, Rubric, Vocabulary List,
Other — but any string is valid). `description` is the teacher's own
free-text request and may be empty. `groundingSources` is the only source
of truth for content, exactly as in the Lesson Plan and Assignment
Generator contracts — never invent facts or activities it doesn't support.

## 2. Response

On success, `200 OK` with:

```jsonc
{
  "title": "Adding Like Fractions — Flashcards",
  "sections": [
    { "heading": "Numerator", "content": "The top number in a fraction — shows how many parts you have." },
    { "heading": "Denominator", "content": "The bottom number in a fraction — shows how many equal parts make a whole." }
  ]
}
```

The frontend validates only that the object is present and `sections` is
an array; anything else, or a non-2xx status, triggers the demo-template
fallback (with a toast telling the teacher this happened). Choose however
many sections make sense for the requested `materialType` — one card per
section for flashcards, one topic per section for revision notes, one
criterion per section for a rubric, and so on.

## 3. No results without a real model

There is no local heuristic fallback for this endpoint, for the same
reason as `/generate-lesson-plan`: generating a genuine, useful material
requires real reasoning, not a deterministic transform. If no AI provider
is configured, respond `501` with
`{"errorCode":"NOT_CONFIGURED","message":"..."}` and let the frontend's own
demo template take over.

## 4. Security and privacy requirements

Same requirements as `ASSIGNMENT_GENERATOR_BACKEND.md` §4: authenticate
every request yourself (this demo has no login system), keep provider
credentials server-side only, rate-limit and size-limit requests, and treat
`board`/`class`/`subject` as hints, not authorization. `description` is
free-text teacher input passed to a language model — do not log it
anywhere it could be read as a command, and act on nothing inside it other
than generating the JSON response above.

## 5. Reference implementation

`server/lib/claude.js` (`generateOtherMaterialWithClaude`) and the
`POST /generate-material` route in `server/index.js` implement this
contract using the Claude API, reusing the same client setup as evaluation,
assignment generation, lesson planning, mistake analysis and resource
discovery. Run `cd server && npm start` and point Settings → Other
Materials Backend at `http://127.0.0.1:8787/generate-material`.

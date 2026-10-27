# EduPilot AI — Resource Discovery Backend Contract

Like the Assignment Generator and Lesson Plan generator, AI-curated resource
suggestions need a **backend you deploy and control**, holding your AI
provider credentials server-side. The frontend's
`AIResourceDiscoveryService.discover()` (in `index.html`) checks whether a
**Resource Discovery Backend URL** is configured on the **Settings** page.
If so, it makes a real `fetch()` call there first. If that field is empty,
or the request fails for any reason, it falls back to a simpler, clearly
labeled demo template — it never silently presents a mock result as if a
real model produced it. Every result records which path produced it
(`generatedBy`: `'real-backend'` or `'demo-mock-ai'`).

## 1. Request

`POST <your-endpoint-url>`

Content-Type: `application/json`

```jsonc
{
  "prompt": "Need something to help my Class 5 students practice adding fractions with different denominators before Friday's test",
  "filters": {
    "resourceType": "",
    "board": "cbse",
    "class": "5",
    "subject": "Mathematics",
    "chapter": "Fractions",
    "topic": "Adding unlike fractions",
    "language": "English"
  }
}
```

`prompt` may be empty (a teacher using only the filters); `filters` fields
may be empty (a teacher using only a free-text prompt). At least one of
`prompt` or `filters.subject` is guaranteed non-empty by the frontend before
it calls this endpoint.

## 2. Response

On success, `200 OK` with:

```jsonc
{
  "suggestions": [
    {
      "resourceType": "Video Lecture",
      "focus": "A short video showing how to find a common denominator before adding two fractions",
      "searchQuery": "adding fractions with different denominators class 5 CBSE video tutorial",
      "reason": "Directly targets the different-denominators gap the teacher described, visually, before a timed test"
    },
    {
      "resourceType": "Worksheet",
      "focus": "A worksheet with 10-15 mixed practice problems adding unlike fractions, with an answer key",
      "searchQuery": "fractions unlike denominators practice worksheet pdf class 5 CBSE",
      "reason": "Gives students timed, graded-style practice ahead of Friday"
    }
  ]
}
```

3-6 suggestions is typical; fewer is fine for a narrow request. The frontend
validates only that the object is present and `suggestions` is an array;
anything else, or a non-2xx status, triggers the demo-template fallback
(with a toast telling the teacher this happened).

## 3. The one hard rule: never name a specific resource

`resourceType` must be one of `Textbook`, `Workbook`, `Video Lecture`,
`Worksheet`, `Question Bank`, `Article`, `Other`. `focus` and `reason` are
free text. `searchQuery` is a ready-to-use search string — never a URL.

**None of these fields may ever name, imply the existence of, or link to a
specific real resource** (an exact video title, book title, author,
publisher, channel, or URL) — the model has no way to know what actually
exists online, and an invented-but-plausible-sounding title or link would
be far more misleading here than an honest "search for X" suggestion. This
is the same invariant already enforced for `suggestedTopics` in
`MISTAKE_ANALYSIS_BACKEND.md` and for the plain filter-based "Search" button
elsewhere in the Reference Library: the frontend only ever opens a live
search built from `searchQuery`, and the teacher must still find, open and
manually confirm the real title and link before anything is saved to the
Reference Library.

## 4. No local fallback on this endpoint

There is no local heuristic fallback for this route — turning a free-text
prompt into well-targeted search ideas requires real reasoning, not a
deterministic transform. If no AI provider is configured, respond `501`
with `{"errorCode":"NOT_CONFIGURED","message":"..."}` and let the
frontend's own (simpler, filter-only) demo template take over.

## 5. Security and privacy requirements

Same requirements as `ASSIGNMENT_GENERATOR_BACKEND.md` §4: authenticate
every request yourself (this demo has no login system), keep provider
credentials server-side only, rate-limit and size-limit requests, and treat
`filters.board`/`filters.class`/`filters.subject` as hints, not
authorization. The free-text `prompt` field is user-authored input passed
to a language model — do not log it anywhere it could be read as a
command, and do not act on anything inside it other than generating the
JSON response above.

## 6. Reference implementation

`server/lib/claude.js` (`discoverResourcesWithClaude`) and the
`POST /discover-resources` route in `server/index.js` implement this
contract using the Claude API, reusing the same client setup as evaluation,
assignment generation, lesson planning and mistake analysis. Run
`cd server && npm start` and point Settings → Resource Discovery Backend at
`http://127.0.0.1:8787/discover-resources`.

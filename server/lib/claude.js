/* Optional real-AI tier. Only used when ANTHROPIC_API_KEY is set in the
 * environment (never read from the frontend, never committed — see
 * .env.example). When absent, index.js falls back to genuine local OCR +
 * deterministic heuristic grading (ocr.js / grading.js) instead of this.
 */
const Anthropic = require('@anthropic-ai/sdk');

function isClaudeConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return a JSON object.');
  return JSON.parse(match[0]);
}

async function evaluateWithClaude(payload, files) {
  const anthropic = client();
  const imageBlocks = files.map(f => ({
    type: 'image',
    source: { type: 'base64', media_type: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') },
  }));
  const prompt = `You are assisting a teacher by reading photographed handwritten answer sheets and comparing them to an approved marking scheme. Respond with ONLY a single JSON object matching this exact shape, no other text, no markdown fences:
{"ocr":{"overallConfidence":0-1,"extractedText":[{"questionId":"...","text":"...","confidence":0-1}]},"grading":{"suggestedTotal":number,"questionResults":[{"questionId":"...","suggestedMarks":number,"maxMarks":number,"reasoning":"...","misconceptions":["..."],"confidence":0-1,"flags":["..."]}]}}
Allowed flags: illegible_handwriting, low_confidence_ocr, uncertain_question_match, ambiguous_grading. Use a flag and a lower confidence whenever you are not sure, rather than guessing a mark. Never invent an answer you cannot actually read in the images, and never award marks for a question you cannot clearly match to an answer in the images.

Board: ${payload.board}, Class: ${payload.class}, Subject: ${payload.subject}.
Expected level: ${payload.expectedLevel && payload.expectedLevel.label}.
Questions (this is the approved answer key and marking scheme — grade against this, not your own judgment of what's "right"):
${JSON.stringify(payload.questions, null, 2)}`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

async function generateWithClaude(body) {
  const anthropic = client();
  const prompt = `Generate exam questions for a classroom assignment, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain, and never fabricate a correct answer you can't support from that content. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"questions":[{"type":"mcq|short|long|sum","text":"...","options":["..."] or null,"correctIndex":number or null,"suggestedAnswer":"...","markingScheme":"...","topicTag":"...","difficulty":"easy|medium|hard","marks":number}]}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}; expected answer length: ${body.expectedLevel && body.expectedLevel.answerLength}).
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
Requested question counts and marks: ${JSON.stringify(body.config || {})}
If the lecture content above is too sparse to responsibly generate the requested questions, generate fewer questions rather than inventing content.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

async function generateLessonPlanWithClaude(body) {
  const anthropic = client();
  const prompt = `Generate a classroom lesson plan, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain, and never fabricate activities or content it doesn't support. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"objectives":["..."],"materials":["..."],"warmUp":"...","steps":[{"activity":"...","duration":"...","description":"..."}],"assessmentChecks":["..."],"homework":"...","durationMinutes":number}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}; expected answer length: ${body.expectedLevel && body.expectedLevel.answerLength}).
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
If the lecture content above is too sparse to responsibly generate a full lesson plan, generate fewer steps rather than inventing content.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

/* Phase 13: open-ended mistake analysis for submissions that don't have an
 * approved question set to grade against (general submissions, written
 * text answers, or any photo/document a student submits for self-review).
 * Distinct from evaluateWithClaude: that one grades strictly against a
 * teacher-approved marking scheme; this one reviews freeform work and
 * explains mistakes in student-friendly language, with no marking scheme
 * input and no score output — it is never treated as an official grade.
 */
async function analyzeMistakesWithClaude(payload, files){
  const anthropic = client();
  const content = [];
  if (files && files.length) {
    for (const f of files) {
      if (f.mimetype === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.buffer.toString('base64') } });
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') } });
      }
    }
  }
  const basis = payload.kind === 'text'
    ? `The student's typed written answer is given below — read it directly, no OCR needed:\n"""${payload.textAnswer}"""`
    : `The student's work is attached as ${payload.kind === 'document' ? 'a document' : 'photographed image(s)'}. Read it as carefully as you can.`;
  const prompt = `You are a patient CBSE tutor reviewing a Class ${payload.class} ${payload.subject} student's submitted work titled "${payload.title}", so you can point out mistakes and explain them in age-appropriate language the student can learn from.
${basis}
If the handwriting or scan is too unclear to confidently read a part of the answer, do not guess — mark that item's assessment as "uncertain" and explain what's unclear instead of inventing content.
Respond with ONLY a single JSON object matching this exact shape, no other text, no markdown fences:
{"overallAssessment":"correct|partially_correct|incorrect|uncertain","summary":"one or two sentence overview for the student","items":[{"excerpt":"the student's original answer or the relevant section, quoted or closely paraphrased from what you can actually read","assessment":"correct|partially_correct|incorrect|uncertain","mistake":"what's wrong, or null if correct","explanation":"simple age-appropriate reason why","correction":"the corrected answer or proper form","steps":["step-by-step reasoning, only for math problems, else omit"],"tip":"a short learning tip to avoid this mistake next time"}],"flags":["illegible_handwriting","low_confidence","needs_teacher_review"],"suggestedTopics":["a short topic keyword for self-guided review, e.g. fractions","another short keyword, 3-5 total"]}
suggestedTopics must be short topic/keyword strings only (never a resource title, URL, or description — the caller matches these keywords against its own resource library, so do not invent resource names). Omit suggestedTopics or return an empty array if the submission is fully correct.
Board: ${payload.board}. Keep language simple and encouraging, suitable for a Class ${payload.class} student.`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [...content, { type: 'text', text: prompt }] }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

/* Phase 15: AI Resource Finder curation. Turns a teacher's free-text prompt
 * (plus class/subject/chapter/topic/language/type filters) into several
 * targeted search suggestions. Like suggestedTopics in
 * analyzeMistakesWithClaude above, this must NEVER name a specific real
 * resource (title, author, publisher, URL) — the model has no way to know
 * what actually exists online. It only ever proposes what to look for and a
 * search query; the frontend opens that as a real YouTube/Google search, and
 * the teacher still finds, opens and manually confirms whatever they save.
 */
async function discoverResourcesWithClaude(body) {
  const anthropic = client();
  const prompt = `A CBSE teacher is looking for teaching resources. Suggest 3-6 targeted search ideas — never a specific resource title, author, publisher, or URL, since you cannot know what actually exists online; only describe what to look for and a ready-to-use search query. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"suggestions":[{"resourceType":"Textbook|Workbook|Video Lecture|Worksheet|Question Bank|Article|Other","focus":"short description of what this resource should cover or show","searchQuery":"a ready-to-use web/video search query, including class/subject/topic context","reason":"one sentence tying this suggestion to the teacher's request"}]}

Teacher's request: "${body.prompt || '(no free-text request — use the filters below only)'}"
Filters: Board ${body.filters && body.filters.board}, Class ${body.filters && body.filters.class}, Subject ${body.filters && body.filters.subject}, Chapter ${body.filters && body.filters.chapter}, Topic ${body.filters && body.filters.topic}, Preferred resource type ${(body.filters && body.filters.resourceType) || '(any)'}, Language ${body.filters && body.filters.language}.
If the request and filters are too sparse to responsibly target suggestions, fall back to general suggestions for the given class/subject/topic rather than inventing specifics.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

/* Phase 16: free-form "other teaching materials" — revision notes,
 * flashcards, study guides, rubrics, vocabulary lists, anything that isn't
 * a lesson plan, worksheet or question paper. Deliberately generic
 * (title + sections) so one endpoint covers all of these without a
 * separate schema per material type.
 */
async function generateOtherMaterialWithClaude(body) {
  const anthropic = client();
  const prompt = `Generate a "${body.materialType || 'teaching material'}" for a classroom, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"title":"...","sections":[{"heading":"...","content":"..."}]}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}).
Teacher's description of what they need: "${body.description || '(none given — use your judgment for this material type)'}"
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
Choose a sensible number of sections for a "${body.materialType || 'teaching material'}" (e.g. one card per section for flashcards, one topic per section for revision notes, one criterion per section for a rubric). If the lecture content above is too sparse to responsibly generate this, generate fewer sections rather than inventing content.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

module.exports = { isClaudeConfigured, evaluateWithClaude, generateWithClaude, generateLessonPlanWithClaude, analyzeMistakesWithClaude, discoverResourcesWithClaude, generateOtherMaterialWithClaude };

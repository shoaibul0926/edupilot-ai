/* Real-AI tier using Gemini. Mirrors claude.js's function shapes exactly so
 * index.js and lib/ai.js can treat either provider interchangeably. Only
 * used when GEMINI_API_KEY is set in the environment (never read from the
 * frontend, never committed — see .env.example).
 */
const { GoogleGenAI } = require('@google/genai');

function isGeminiConfigured() {
  return !!(process.env.GEMINI_API_KEY || '').trim();
}

function client() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

async function generateJson(parts) {
  const ai = client();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(response.text);
}

function imagePart(f) {
  return { inlineData: { mimeType: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') } };
}

async function evaluateWithGemini(payload, files) {
  const prompt = `You are assisting a teacher by reading photographed handwritten answer sheets and comparing them to an approved marking scheme. Respond with ONLY a single JSON object matching this exact shape, no other text, no markdown fences:
{"ocr":{"overallConfidence":0-1,"extractedText":[{"questionId":"...","text":"...","confidence":0-1}]},"grading":{"suggestedTotal":number,"questionResults":[{"questionId":"...","suggestedMarks":number,"maxMarks":number,"reasoning":"...","misconceptions":["..."],"confidence":0-1,"flags":["..."]}]}}
Allowed flags: illegible_handwriting, low_confidence_ocr, uncertain_question_match, ambiguous_grading. Use a flag and a lower confidence whenever you are not sure, rather than guessing a mark. Never invent an answer you cannot actually read in the images, and never award marks for a question you cannot clearly match to an answer in the images.

Board: ${payload.board}, Class: ${payload.class}, Subject: ${payload.subject}.
Expected level: ${payload.expectedLevel && payload.expectedLevel.label}.
Questions (this is the approved answer key and marking scheme — grade against this, not your own judgment of what's "right"):
${JSON.stringify(payload.questions, null, 2)}`;
  return generateJson([...files.map(imagePart), { text: prompt }]);
}

async function generateWithGemini(body) {
  const prompt = `Generate exam questions for a classroom assignment, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain, and never fabricate a correct answer you can't support from that content. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"questions":[{"type":"mcq|short|long|sum","text":"...","options":["..."] or null,"correctIndex":number or null,"suggestedAnswer":"...","markingScheme":"...","topicTag":"...","difficulty":"easy|medium|hard","marks":number}]}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}; expected answer length: ${body.expectedLevel && body.expectedLevel.answerLength}).
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
Requested question counts and marks: ${JSON.stringify(body.config || {})}
If the lecture content above is too sparse to responsibly generate the requested questions, generate fewer questions rather than inventing content.`;
  return generateJson([{ text: prompt }]);
}

async function generateLessonPlanWithGemini(body) {
  const prompt = `Generate a classroom lesson plan, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain, and never fabricate activities or content it doesn't support. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"objectives":["..."],"materials":["..."],"warmUp":"...","steps":[{"activity":"...","duration":"...","description":"..."}],"assessmentChecks":["..."],"homework":"...","durationMinutes":number}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}; expected answer length: ${body.expectedLevel && body.expectedLevel.answerLength}).
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
If the lecture content above is too sparse to responsibly generate a full lesson plan, generate fewer steps rather than inventing content.`;
  return generateJson([{ text: prompt }]);
}

async function analyzeMistakesWithGemini(payload, files) {
  const content = (files || []).map(f => {
    if (f.mimetype === 'application/pdf') {
      return { inlineData: { mimeType: 'application/pdf', data: f.buffer.toString('base64') } };
    }
    return imagePart(f);
  });
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
  return generateJson([...content, { text: prompt }]);
}

async function discoverResourcesWithGemini(body) {
  const prompt = `A CBSE teacher is looking for teaching resources. Suggest 3-6 targeted search ideas — never a specific resource title, author, publisher, or URL, since you cannot know what actually exists online; only describe what to look for and a ready-to-use search query. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"suggestions":[{"resourceType":"Textbook|Workbook|Video Lecture|Worksheet|Question Bank|Article|Other","focus":"short description of what this resource should cover or show","searchQuery":"a ready-to-use web/video search query, including class/subject/topic context","reason":"one sentence tying this suggestion to the teacher's request"}]}

Teacher's request: "${body.prompt || '(no free-text request — use the filters below only)'}"
Filters: Board ${body.filters && body.filters.board}, Class ${body.filters && body.filters.class}, Subject ${body.filters && body.filters.subject}, Chapter ${body.filters && body.filters.chapter}, Topic ${body.filters && body.filters.topic}, Preferred resource type ${(body.filters && body.filters.resourceType) || '(any)'}, Language ${body.filters && body.filters.language}.
If the request and filters are too sparse to responsibly target suggestions, fall back to general suggestions for the given class/subject/topic rather than inventing specifics.`;
  return generateJson([{ text: prompt }]);
}

async function generateOtherMaterialWithGemini(body) {
  const prompt = `Generate a "${body.materialType || 'teaching material'}" for a classroom, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"title":"...","sections":[{"heading":"...","content":"..."}]}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}).
Teacher's description of what they need: "${body.description || '(none given — use your judgment for this material type)'}"
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
Choose a sensible number of sections for a "${body.materialType || 'teaching material'}" (e.g. one card per section for flashcards, one topic per section for revision notes, one criterion per section for a rubric). If the lecture content above is too sparse to responsibly generate this, generate fewer sections rather than inventing content.`;
  return generateJson([{ text: prompt }]);
}

module.exports = {
  isGeminiConfigured,
  evaluateWithGemini,
  generateWithGemini,
  generateLessonPlanWithGemini,
  analyzeMistakesWithGemini,
  discoverResourcesWithGemini,
  generateOtherMaterialWithGemini,
};

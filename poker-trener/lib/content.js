const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { seededRng, randomSeed } = require('./rng');
const D = require('./drills');
const S = require('./spots');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'));
const lessons = read('lessons.json');
const quizzes = read('quizzes.json');
const stages = read('path.json');
const MAX_STAGE = stages.length;
const EXAM_PASS = 0.8;

function getLessons() {
  return lessons;
}

function getLesson(id) {
  return lessons.find((l) => l.id === id) || null;
}

function getQuiz(id) {
  return quizzes.find((q) => q.id === id) || null;
}

function getQuizForLesson(lessonId) {
  return quizzes.find((q) => q.lessonId === lessonId) || null;
}

function getStages() {
  return stages.map((s) => ({ ...s, lessons: lessons.filter((l) => l.stage === s.stage).map((l) => ({ id: l.id, title: l.title, summary: l.summary, illustration: l.illustration, order: l.order })) }));
}

// Typy spotów i formaty dostępne na danym etapie ścieżki (A1).
function unlocked(pathStage, freeMode) {
  if (freeMode) {
    return { spotTypes: Object.keys(S.SPOT_TYPES), formats: ['mtt', 'pko', 'sng', 'satellite', 'wta'], exploit: true, drills: Object.keys(D.DRILL_TYPES), maxLessonStage: MAX_STAGE };
  }
  const st = stages.filter((s) => s.stage <= pathStage);
  const spotTypes = new Set(['open_shove', 'facing_shove']);
  const formats = new Set(['mtt', 'sng', 'wta']);
  const drills = new Set();
  let exploit = false;
  for (const s of st) {
    (s.spotTypes || []).forEach((t) => spotTypes.add(t));
    (s.formats || []).forEach((f) => formats.add(f));
    (s.drills || []).forEach((d) => drills.add(d));
    if (s.mode === 'exploit') exploit = true;
  }
  for (const s of stages.filter((x) => x.stage <= Math.max(2, pathStage))) (s.drills || []).forEach((d) => drills.add(d));
  return { spotTypes: [...spotTypes], formats: [...formats], exploit, drills: [...drills], maxLessonStage: Math.min(MAX_STAGE, pathStage) };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function quizItemsForStage(stage, count, rng) {
  const ids = new Set(lessons.filter((l) => l.stage === stage).map((l) => l.id));
  const pool = quizzes.filter((q) => ids.has(q.lessonId)).flatMap((q) => q.questions.map((qq) => ({ ...qq, lessonId: q.lessonId })));
  return shuffled(pool, rng).slice(0, count).map((q) => ({ kind: 'quiz', q: q.q, options: q.options, answer: q.correctIndex, explanation: q.explanation, lessonId: q.lessonId }));
}

function practicalItems(stageDef, count, rng) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const seed = Math.floor(rng() * 2 ** 31);
    if (stageDef.drills && stageDef.drills.length) {
      const d = D.generateDrill(stageDef.drills[i % stageDef.drills.length], seed);
      items.push({ kind: 'drill', drill: d });
    } else {
      const type = stageDef.spotTypes[i % stageDef.spotTypes.length];
      const spot = S.generateSpot({ type, seed, format: stageDef.formats ? stageDef.formats[i % stageDef.formats.length] : 'mix', mode: stageDef.mode || 'gto', difficulty: 'normal' });
      items.push({ kind: 'spot', spot });
    }
  }
  return items;
}

const pendingExams = new Map();

function createExam(stage, kind = 'exam') {
  const seed = randomSeed();
  const rng = seededRng(seed);
  let items;
  if (kind === 'placement') {
    items = stages.flatMap((s) => quizItemsForStage(s.stage, 2, rng).map((it) => ({ ...it, stage: s.stage })));
  } else {
    const def = stages.find((s) => s.stage === stage);
    if (!def) throw new Error('Nieznany poziom.');
    items = shuffled([...quizItemsForStage(stage, 8, rng), ...practicalItems(def, 4, rng)], rng);
  }
  const id = crypto.randomUUID();
  pendingExams.set(id, { id, kind, stage, items, createdAt: Date.now() });
  if (pendingExams.size > 200) pendingExams.delete(pendingExams.keys().next().value);
  return {
    id,
    kind,
    stage,
    items: items.map((it) => {
      if (it.kind === 'quiz') return { kind: 'quiz', q: it.q, options: it.options, stage: it.stage };
      if (it.kind === 'drill') return { kind: 'drill', drill: D.publicDrill(it.drill) };
      return { kind: 'spot', spot: S.publicView(it.spot) };
    }),
  };
}

function gradeExam(id, answers) {
  const exam = pendingExams.get(id);
  if (!exam) throw new Error('Egzamin wygasł — zacznij od nowa.');
  pendingExams.delete(id);
  const results = exam.items.map((it, i) => {
    const a = answers[i];
    if (it.kind === 'quiz') return { kind: 'quiz', correct: a === it.answer, correctAnswer: it.answer, explanation: it.explanation, stage: it.stage };
    if (it.kind === 'drill') {
      const r = D.resolveDrill(it.drill, a);
      return { kind: 'drill', correct: r.correct, correctAnswer: r.answer, explanation: r.explanation.join(' ') };
    }
    const r = S.resolveSpot(it.spot, a || 'fold', { trials: 1200 });
    return { kind: 'spot', correct: r.correct, correctAnswer: r.optimal, explanation: r.explanation.join(' ') };
  });
  const score = results.filter((r) => r.correct).length;
  const total = results.length;
  let newStage = null;
  if (exam.kind === 'placement') {
    let reached = 1;
    for (const s of stages) {
      const rs = results.filter((r) => r.stage === s.stage);
      if (rs.length && rs.every((r) => r.correct)) reached = s.stage + 1;
      else break;
    }
    newStage = Math.min(reached, MAX_STAGE);
  } else if (score / total >= EXAM_PASS) {
    newStage = Math.min(exam.stage + 1, MAX_STAGE + 1);
  }
  return { kind: exam.kind, stage: exam.stage, score, total, passed: exam.kind === 'exam' ? score / total >= EXAM_PASS : null, newStage, results, passThreshold: EXAM_PASS };
}

module.exports = { getLessons, getLesson, getQuiz, getQuizForLesson, getStages, unlocked, createExam, gradeExam, MAX_STAGE };

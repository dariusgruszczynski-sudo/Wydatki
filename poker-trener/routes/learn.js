const express = require('express');
const db = require('../lib/db');
const C = require('../lib/content');
const G = require('../lib/gamification');
const At = require('../lib/attempts');
const { h, httpError } = require('./util');

const router = express.Router();

function lessonLocked(profile, lesson) {
  return !profile.settings.freeMode && lesson.stage > profile.pathStage;
}

router.get('/learn/path', h((req) => {
  const p = req.profile;
  const done = new Set(db.prepare('SELECT lesson_id FROM lesson_done WHERE profile_id = ?').all(p.id).map((r) => r.lesson_id));
  const exams = db.prepare(`SELECT quiz_id, MAX(score * 1.0 / total) AS best, COUNT(*) AS tries FROM quiz_attempts WHERE profile_id = ? AND kind = 'exam' GROUP BY quiz_id`).all(p.id);
  const examBest = new Map(exams.map((e) => [e.quiz_id, e]));
  const quizBest = new Map(db.prepare(`SELECT quiz_id, MAX(score * 1.0 / total) AS best FROM quiz_attempts WHERE profile_id = ? AND kind = 'quiz' GROUP BY quiz_id`).all(p.id).map((r) => [r.quiz_id, r.best]));
  return {
    pathStage: p.pathStage,
    placementDone: p.placementDone,
    freeMode: p.settings.freeMode,
    unlocked: C.unlocked(p.pathStage, p.settings.freeMode),
    stages: C.getStages().map((s) => {
      const e = examBest.get(`exam-${s.stage}`);
      return {
        ...s,
        locked: !p.settings.freeMode && s.stage > p.pathStage,
        passed: p.pathStage > s.stage,
        examBest: e ? Math.round(e.best * 100) : null,
        examTries: e ? e.tries : 0,
        lessons: s.lessons.map((l) => {
          const q = C.getQuizForLesson(l.id);
          return { ...l, completed: done.has(l.id), quizBest: q && quizBest.has(q.id) ? Math.round(quizBest.get(q.id) * 100) : null };
        }),
      };
    }),
  };
}));

router.get('/lessons/:id', h((req) => {
  const lesson = C.getLesson(req.params.id);
  if (!lesson) throw httpError(404, 'Lekcja nie znaleziona.');
  if (lessonLocked(req.profile, lesson)) throw httpError(403, `Lekcja odblokuje się na poziomie ${lesson.stage}. Zdaj egzamin poprzedniego poziomu albo włącz tryb swobodny.`);
  const quiz = C.getQuizForLesson(lesson.id);
  const done = !!db.prepare('SELECT 1 FROM lesson_done WHERE profile_id = ? AND lesson_id = ?').get(req.profile.id, lesson.id);
  const all = C.getLessons();
  const idx = all.findIndex((l) => l.id === lesson.id);
  return { ...lesson, quizId: quiz ? quiz.id : null, completed: done, prevId: all[idx - 1]?.id || null, nextId: all[idx + 1]?.id || null };
}));

router.post('/lessons/:id/complete', h((req) => {
  const lesson = C.getLesson(req.params.id);
  if (!lesson) throw httpError(404, 'Lekcja nie znaleziona.');
  const r = db.prepare('INSERT OR IGNORE INTO lesson_done (profile_id, lesson_id, completed_at) VALUES (?, ?, ?)').run(req.profile.id, lesson.id, new Date().toISOString());
  if (r.changes) G.addXp(req.profile.id, G.XP.lessonDone, `lesson:${lesson.id}`);
  return { ok: true, firstTime: !!r.changes, ...At.progressPayload(req.profile.id) };
}));

router.get('/quizzes/:id', h((req) => {
  const quiz = C.getQuiz(req.params.id);
  if (!quiz) throw httpError(404, 'Quiz nie znaleziony.');
  return { id: quiz.id, lessonId: quiz.lessonId, title: quiz.title, questions: quiz.questions.map((q) => ({ q: q.q, options: q.options })) };
}));

router.post('/quizzes/:id/submit', h((req) => {
  const quiz = C.getQuiz(req.params.id);
  if (!quiz) throw httpError(404, 'Quiz nie znaleziony.');
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  let score = 0;
  const results = quiz.questions.map((q, i) => {
    const correct = answers[i] === q.correctIndex;
    if (correct) score++;
    return { correct, correctIndex: q.correctIndex, explanation: q.explanation };
  });
  const prev = db.prepare(`SELECT MAX(score) AS best FROM quiz_attempts WHERE profile_id = ? AND quiz_id = ? AND kind = 'quiz'`).get(req.profile.id, quiz.id).best;
  db.prepare(`INSERT INTO quiz_attempts (created_at, quiz_id, lesson_id, score, total, profile_id, kind) VALUES (?, ?, ?, ?, ?, ?, 'quiz')`).run(new Date().toISOString(), quiz.id, quiz.lessonId, score, quiz.questions.length, req.profile.id);
  const gain = Math.max(0, score - (prev || 0));
  if (gain) G.addXp(req.profile.id, gain * G.XP.quizAnswer, `quiz:${quiz.id}`);
  return { score, total: quiz.questions.length, results, xp: gain * G.XP.quizAnswer, ...At.progressPayload(req.profile.id) };
}));

// Quiz zbudowany z własnych błędów bez AI (fallback dla H9).
router.post('/quizzes/mistakes', h((req) => {
  const rows = db
    .prepare(`SELECT id, spot_type, hero_position, hero_stack_bb, villain_position, hero_label, chosen_action, optimal_action, stage FROM trainer_attempts WHERE profile_id = ? AND kind = 'spot' AND correct = 0 AND close = 0 ORDER BY id DESC LIMIT 40`)
    .all(req.profile.id);
  if (!rows.length) throw httpError(400, 'Brak błędów do przerobienia — świetnie!');
  const seen = new Set();
  const label = { shove: 'All-in', call: 'Call', raise: 'Otwarcie', fold: 'Pas' };
  const questions = [];
  for (const r of rows) {
    const key = `${r.spot_type}|${r.hero_position}|${r.hero_label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const aggr = r.optimal_action === 'fold' ? r.chosen_action : r.optimal_action;
    const opts = [aggr, 'fold'];
    questions.push({
      q: `${r.hero_label} na ${r.hero_position} ze stosem ${r.hero_stack_bb}bb (${r.spot_type.replace('_', ' ')}${r.villain_position !== '-' ? `, przeciwnik ${r.villain_position}` : ''}, etap: ${r.stage}). Co jest lepsze?`,
      options: opts.map((o) => label[o] || o),
      correctIndex: opts.indexOf(r.optimal_action),
      explanation: `Wcześniej wybrałeś: ${label[r.chosen_action] || r.chosen_action}. Model: ${label[r.optimal_action]}. Odtwórz ten spot w Statystykach → Najdroższe błędy, żeby zobaczyć pełne wyliczenie.`,
    });
    if (questions.length >= 8) break;
  }
  return { title: 'Quiz z Twoich błędów', questions, ai: false };
}));

// ---------- egzaminy (A10) i test wstępny (A2) ----------

router.post('/exams/start', h((req) => {
  const stage = Number(req.body?.stage);
  if (!req.profile.settings.freeMode && stage > req.profile.pathStage) throw httpError(403, 'Najpierw zdaj egzamin poprzedniego poziomu.');
  return C.createExam(stage, 'exam');
}));

router.post('/placement/start', h(() => C.createExam(null, 'placement')));

router.post('/exams/submit', h((req) => {
  const res = C.gradeExam(req.body?.id, Array.isArray(req.body?.answers) ? req.body.answers : []);
  const p = req.profile;
  const quizId = res.kind === 'placement' ? 'placement' : `exam-${res.stage}`;
  db.prepare(`INSERT INTO quiz_attempts (created_at, quiz_id, lesson_id, score, total, profile_id, kind) VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(new Date().toISOString(), quizId, res.score, res.total, p.id, res.kind);
  let promoted = false;
  if (res.newStage && res.newStage > p.pathStage) {
    db.prepare('UPDATE profiles SET path_stage = ? WHERE id = ?').run(res.newStage, p.id);
    promoted = true;
    if (res.kind === 'exam') G.addXp(p.id, G.XP.examPass, `exam:${res.stage}`);
  }
  if (res.kind === 'placement') db.prepare('UPDATE profiles SET placement_done = 1 WHERE id = ?').run(p.id);
  return { ...res, promoted, pathStage: Math.max(p.pathStage, res.newStage || 0), ...At.progressPayload(p.id) };
}));

module.exports = router;

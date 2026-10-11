const fs = require('fs');
const path = require('path');

const lessons = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'lessons.json'), 'utf8'));
const quizzes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'quizzes.json'), 'utf8'));

function getLessons() {
  return lessons;
}

function getLesson(id) {
  return lessons.find((l) => l.id === id) || null;
}

function getQuizzes() {
  return quizzes;
}

function getQuiz(id) {
  return quizzes.find((q) => q.id === id) || null;
}

function getQuizForLesson(lessonId) {
  return quizzes.find((q) => q.lessonId === lessonId) || null;
}

module.exports = { getLessons, getLesson, getQuizzes, getQuiz, getQuizForLesson };

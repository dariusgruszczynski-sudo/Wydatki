const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'poker-trener.sqlite');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS trainer_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    hero_position TEXT NOT NULL,
    villain_position TEXT NOT NULL,
    hero_stack_bb REAL NOT NULL,
    villain_stack_bb REAL NOT NULL,
    num_players INTEGER NOT NULL,
    hero_cards TEXT NOT NULL,
    range_percent REAL NOT NULL,
    chosen_action TEXT NOT NULL,
    optimal_action TEXT NOT NULL,
    correct INTEGER NOT NULL,
    ev_fold REAL NOT NULL,
    ev_aggressive REAL NOT NULL,
    ev_lost REAL NOT NULL,
    speed_mode_ms INTEGER,
    time_taken_ms INTEGER,
    timed_out INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    quiz_id TEXT NOT NULL,
    lesson_id TEXT,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lesson_progress (
    lesson_id TEXT PRIMARY KEY,
    completed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hand_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    title TEXT,
    stage TEXT,
    position TEXT,
    stack_bb REAL,
    hero_cards TEXT,
    board TEXT,
    action_summary TEXT,
    result TEXT,
    result_bb REAL,
    notes TEXT,
    tags TEXT
  );
`);

module.exports = db;

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'poker-trener.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumn(table, name, def) {
  if (!columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}

function tableExists(name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

const MIGRATIONS = [
  function v1() {
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
        title TEXT, stage TEXT, position TEXT, stack_bb REAL, hero_cards TEXT, board TEXT,
        action_summary TEXT, result TEXT, result_bb REAL, notes TEXT, tags TEXT
      );
    `);
  },

  function v2() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        pin_hash TEXT,
        avatar TEXT DEFAULT '🃏',
        created_at TEXT NOT NULL,
        settings TEXT NOT NULL DEFAULT '{}',
        virtual_bankroll REAL NOT NULL DEFAULT 10000,
        path_stage INTEGER NOT NULL DEFAULT 1,
        placement_done INTEGER NOT NULL DEFAULT 0
      );
    `);
    if (!db.prepare('SELECT id FROM profiles LIMIT 1').get()) {
      db.prepare(`INSERT INTO profiles (id, name, avatar, created_at) VALUES (1, 'Darek', '♠️', ?)`).run(new Date().toISOString());
    }

    const ta = [
      ['profile_id', 'INTEGER NOT NULL DEFAULT 1'],
      ['kind', "TEXT NOT NULL DEFAULT 'spot'"],
      ['spot_type', 'TEXT'],
      ['mode', "TEXT NOT NULL DEFAULT 'standard'"],
      ['format', 'TEXT'],
      ['stage', 'TEXT'],
      ['hero_pos_group', 'TEXT'],
      ['stack_bucket', 'TEXT'],
      ['hero_label', 'TEXT'],
      ['opp_type', 'TEXT'],
      ['confidence', 'TEXT'],
      ['close', 'INTEGER NOT NULL DEFAULT 0'],
      ['ev_delta', 'REAL'],
      ['pool_total', 'REAL'],
      ['value_mode', 'TEXT'],
      ['spot_json', 'TEXT'],
      ['xp', 'INTEGER NOT NULL DEFAULT 0'],
      ['bankroll_delta', 'REAL NOT NULL DEFAULT 0'],
      ['run_id', 'INTEGER'],
    ];
    for (const [n, d] of ta) addColumn('trainer_attempts', n, d);
    db.exec(`UPDATE trainer_attempts SET spot_type = decision_type WHERE spot_type IS NULL`);
    db.exec(`UPDATE trainer_attempts SET value_mode = 'icm' WHERE value_mode IS NULL`);

    addColumn('quiz_attempts', 'profile_id', 'INTEGER NOT NULL DEFAULT 1');
    addColumn('quiz_attempts', 'kind', "TEXT NOT NULL DEFAULT 'quiz'");

    db.exec(`
      CREATE TABLE IF NOT EXISTS lesson_done (
        profile_id INTEGER NOT NULL,
        lesson_id TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, lesson_id)
      );
    `);
    if (tableExists('lesson_progress')) {
      db.exec(`INSERT OR IGNORE INTO lesson_done (profile_id, lesson_id, completed_at) SELECT 1, lesson_id, completed_at FROM lesson_progress`);
      db.exec(`DROP TABLE lesson_progress`);
    }

    addColumn('hand_journal', 'profile_id', 'INTEGER NOT NULL DEFAULT 1');
    addColumn('hand_journal', 'hand_id', 'INTEGER');
    addColumn('hand_journal', 'opponent', 'TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

      CREATE TABLE IF NOT EXISTS review_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        spot_json TEXT NOT NULL,
        source_attempt_id INTEGER,
        due_at TEXT NOT NULL,
        interval_days REAL NOT NULL DEFAULT 0,
        ease REAL NOT NULL DEFAULT 2.3,
        reps INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_due ON review_queue(profile_id, active, due_at);

      CREATE TABLE IF NOT EXISTS xp_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_xp_profile ON xp_events(profile_id, created_at);

      CREATE TABLE IF NOT EXISTS achievements (
        profile_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        awarded_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, key)
      );

      CREATE TABLE IF NOT EXISTS mode_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        mode TEXT NOT NULL,
        score REAL NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_results (
        profile_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        ev_lost REAL NOT NULL DEFAULT 0,
        time_ms INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, day)
      );

      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        week_start TEXT NOT NULL,
        kind TEXT NOT NULL,
        target REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (profile_id, week_start, kind)
      );

      CREATE TABLE IF NOT EXISTS push_subs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        keys_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_notified_day TEXT
      );

      CREATE TABLE IF NOT EXISTS opponents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        site TEXT NOT NULL DEFAULT '',
        type TEXT,
        notes TEXT,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (profile_id, name, site)
      );

      CREATE TABLE IF NOT EXISTS hands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        site TEXT NOT NULL,
        hand_no TEXT NOT NULL,
        tournament_id TEXT,
        played_at TEXT,
        sb REAL, bb REAL, ante REAL,
        max_seats INTEGER,
        hero_name TEXT,
        hero_cards TEXT,
        hero_pos TEXT,
        hero_stack_bb REAL,
        board TEXT,
        players_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        result_bb REAL,
        showdown INTEGER NOT NULL DEFAULT 0,
        hero_vpip INTEGER NOT NULL DEFAULT 0,
        hero_pfr INTEGER NOT NULL DEFAULT 0,
        hero_3bet INTEGER NOT NULL DEFAULT 0,
        hero_allin_pre INTEGER NOT NULL DEFAULT 0,
        review_json TEXT,
        raw TEXT,
        imported_at TEXT NOT NULL,
        UNIQUE (profile_id, site, hand_no)
      );
      CREATE INDEX IF NOT EXISTS idx_hands_profile ON hands(profile_id, played_at);

      CREATE TABLE IF NOT EXISTS bankroll_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        site TEXT,
        game_type TEXT,
        tournaments INTEGER NOT NULL DEFAULT 1,
        buyins REAL NOT NULL DEFAULT 0,
        cashes REAL NOT NULL DEFAULT 0,
        hours REAL,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS custom_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        labels TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tournament_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        state_json TEXT NOT NULL,
        finish_place INTEGER,
        prize REAL,
        field INTEGER,
        session_key TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        thread TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_attempts_profile ON trainer_attempts(profile_id, created_at);
    `);
  },
];

function currentVersion() {
  if (!tableExists('meta')) return tableExists('trainer_attempts') ? 1 : 0;
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get();
  return row ? Number(row.value) : 1;
}

function migrate() {
  let v = currentVersion();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[v]();
      v++;
      if (tableExists('meta')) db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(v));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

migrate();

function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

module.exports = db;
module.exports.getMeta = getMeta;
module.exports.setMeta = setMeta;
module.exports.DB_PATH = DB_PATH;

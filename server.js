// CABNATION Express API: rides, live seat inventory and transactional tickets.
const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { pool, TABLE_SQL, dbError, ts, sleep } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hosted MySQL services refuse DROP/CREATE DATABASE and some disallow USE.
// Strip those lines and the client-only DELIMITER markers, then split the file
// into single statements (trigger bodies keep their internal semicolons).
function sqlStatements(sqlText) {
  const executable = sqlText
    .split(/\r?\n/)
    .filter((line) => !/^\s*(DROP\s+DATABASE|CREATE\s+DATABASE|USE|DELIMITER)\b/i.test(line));
  const boundary = /^(CREATE|DELETE|ALTER|INSERT|TRUNCATE|SET)\b/i;
  const statements = [];
  let current = null;
  for (const line of executable) {
    if (boundary.test(line)) {
      if (current !== null) statements.push(current);
      current = line;
    } else if (current !== null) {
      current += `\n${line}`;
    }
  }
  if (current !== null) statements.push(current);
  return statements
    .map((statement) => statement.replace(/;;\s*$/, ';').trim())
    .filter(Boolean);
}

async function runSqlFile(conn, fileName, tolerant = false) {
  const sqlText = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
  const statements = sqlStatements(sqlText);
  const skipped = [];
  for (const [index, statement] of statements.entries()) {
    try {
      await conn.query(statement);
    } catch (error) {
      if (!tolerant) throw error;
      const detail = dbError(error);
      skipped.push({ statement: index + 1, code: detail.code, message: detail.message.slice(0, 120), sql: statement.slice(0, 60) });
    }
  }
  return { applied: statements.length - skipped.length, skipped };
}

function tempConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    dateStrings: true,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  });
}

// Hosted deployments set SETUP_TOKEN; then destructive endpoints require the
// x-setup-token header. Local demos with no token stay one-click and open.
function tokenOk(req) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return true;
  return req.get('x-setup-token') === expected;
}

// A ticket, payment and optional luggage entry commit together or roll back
// together. SELECT FOR UPDATE serializes two attempts for the same seat.
async function bookSeat(conn, options, trace, actor = 'APP') {
  const step = (text, status = 'OK') => trace.push({ ts: ts(), actor, step: text, status });
  await conn.beginTransaction();
  step('BEGIN');

  const [seats] = await conn.query(
    'SELECT seat_id, ride_id, seat_no, fare FROM seats WHERE seat_id = ? FOR UPDATE',
    [options.seatId],
  );
  if (!seats.length) {
    const error = new Error('Seat not found');
    error.code = 'SEAT_NOT_FOUND';
    throw error;
  }
  const seat = seats[0];
  if (seat.ride_id !== options.rideId) {
    const error = new Error('Seat is not on this ride');
    error.code = 'SEAT_RIDE_MISMATCH';
    throw error;
  }
  step(`SELECT seat ${seat.seat_no} FOR UPDATE -> row lock held`);

  const [booking] = await conn.query(
    "INSERT INTO bookings (ride_id, seat_id, passenger_id, status) VALUES (?, ?, ?, 'CONFIRMED')",
    [options.rideId, options.seatId, options.passengerId],
  );
  step(`INSERT bookings -> booking_id ${booking.insertId}`);
  if (options.failAt === 'booking') {
    const error = new Error('Forced failure after ticket insert');
    error.code = 'FORCED_FAILURE';
    throw error;
  }

  const [payment] = await conn.query(
    "INSERT INTO payments (booking_id, amount, status) VALUES (?, ?, 'PAID')",
    [booking.insertId, seat.fare],
  );
  step(`INSERT payments -> payment_id ${payment.insertId}, amount ${seat.fare}`);
  if (options.failAt === 'payment') {
    const error = new Error('Forced failure after payment insert');
    error.code = 'FORCED_FAILURE';
    throw error;
  }

  if (options.luggageKg > 0) {
    const fee = options.luggageKg * 50;
    const [luggage] = await conn.query(
      'INSERT INTO luggage (booking_id, kg, fee) VALUES (?, ?, ?)',
      [booking.insertId, options.luggageKg, fee],
    );
    step(`INSERT luggage -> luggage_id ${luggage.insertId}, ${options.luggageKg} kg, fee ${fee}`);
  }
  if (options.failAt === 'luggage') {
    const error = new Error('Forced failure after luggage insert');
    error.code = 'FORCED_FAILURE';
    throw error;
  }

  await conn.commit();
  step('COMMIT');
  return { bookingId: booking.insertId };
}

app.get('/api/health', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT DATABASE() AS database_name, VERSION() AS db_version');
  const databaseName = String(rows[0].database_name || '');
  const dbVersion = rows[0].db_version;
  if (databaseName.toLowerCase() !== 'cabnation') {
    return res.status(503).json({
      ok: false,
      code: 'WRONG_DATABASE',
      message: 'Set DB_NAME=cabnation and run schema.sql plus seed.sql.',
    });
  }
  await pool.query('SELECT 1 FROM rides LIMIT 1');
  res.json({ ok: true, db: 'connected', database: databaseName, dbVersion });
}));

app.get('/api/rides', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.ride_id, t.ride_no, t.pickup_at, t.dropoff_at,
            TIMESTAMPDIFF(MINUTE, t.pickup_at, t.dropoff_at) AS duration_minutes,
            pickup.code AS pickup_code, pickup.city AS pickup_city,
            pickup.stand_name AS pickup_stand,
            dropoff.code AS dropoff_code, dropoff.city AS dropoff_city,
            dropoff.stand_name AS dropoff_stand,
            cab.operator_name AS operator, cab.cab_name, cab.cab_type,
            (SELECT MIN(s.fare) FROM seats s WHERE s.ride_id = t.ride_id) AS min_fare,
            (SELECT COUNT(*) FROM seats s
             LEFT JOIN bookings b ON b.seat_id = s.seat_id AND b.status = 'CONFIRMED'
             WHERE s.ride_id = t.ride_id AND b.booking_id IS NULL) AS free_seats
     FROM rides t
     JOIN stands pickup ON pickup.stand_id = t.pickup_id
     JOIN stands dropoff ON dropoff.stand_id = t.dropoff_id
     JOIN cabs cab ON cab.cab_id = t.cab_id
     ORDER BY t.pickup_at`,
  );
  res.json({ ok: true, rows });
}));

app.post('/api/passengers', wrap(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  if (!name || !email) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'name and email are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO passengers (name, email, phone) VALUES (?, ?, ?)',
      [name, email, phone || null],
    );
    const [rows] = await pool.query(
      'SELECT passenger_id, name, email, phone FROM passengers WHERE passenger_id = ?',
      [result.insertId],
    );
    res.json({ ok: true, row: rows[0] });
  } catch (error) {
    if (error.errno === 1062) {
      return res.status(409).json({
        ok: false,
        code: 1062,
        message: 'email already registered — choose that passenger instead',
      });
    }
    throw error;
  }
}));

app.get('/api/bookings', wrap(async (req, res) => {
  const passengerId = Number(req.query.passenger_id);
  if (!Number.isInteger(passengerId) || passengerId <= 0) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'passenger_id must be a positive integer' });
  }
  const [rows] = await pool.query(
    `SELECT bk.booking_id, bk.ride_id, bk.status, bk.created_at,
            t.ride_no, t.pickup_at, t.dropoff_at,
            pickup.city AS pickup_city, dropoff.city AS dropoff_city,
            s.seat_no, IFNULL(pay.amount, 0) AS amount,
            IFNULL(pay.status, '-') AS payment_status,
            (SELECT IFNULL(SUM(l.fee), 0) FROM luggage l WHERE l.booking_id = bk.booking_id) AS luggage_fee
     FROM bookings bk
     JOIN rides t ON t.ride_id = bk.ride_id
     JOIN stands pickup ON pickup.stand_id = t.pickup_id
     JOIN stands dropoff ON dropoff.stand_id = t.dropoff_id
     JOIN seats s ON s.seat_id = bk.seat_id
     LEFT JOIN payments pay ON pay.booking_id = bk.booking_id
     WHERE bk.passenger_id = ?
     ORDER BY bk.booking_id DESC`,
    [passengerId],
  );
  res.json({ ok: true, rows });
}));

app.get('/api/rides/:id/seats', wrap(async (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isInteger(rideId) || rideId <= 0) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'ride id must be a positive integer' });
  }
  const [rows] = await pool.query(
    `SELECT s.seat_id, s.ride_id, s.seat_no, s.class, s.fare,
            b.booking_id, p.name AS passenger_name
     FROM seats s
     LEFT JOIN bookings b ON b.seat_id = s.seat_id AND b.status = 'CONFIRMED'
     LEFT JOIN passengers p ON p.passenger_id = b.passenger_id
     WHERE s.ride_id = ?
     ORDER BY s.seat_no`,
    [rideId],
  );
  res.json({ ok: true, rows });
}));

app.get('/api/table/:name', wrap(async (req, res) => {
  const sql = TABLE_SQL[req.params.name];
  if (!sql) {
    return res.status(404).json({ ok: false, code: 'UNKNOWN_TABLE', message: `table not whitelisted: ${req.params.name}` });
  }
  const [rows, fields] = await pool.query(sql);
  res.json({ ok: true, columns: fields.map((field) => field.name), rows });
}));

app.post('/api/book', async (req, res) => {
  const body = req.body || {};
  const rideId = Number(body.ride_id);
  const seatId = Number(body.seat_id);
  const passengerId = Number(body.passenger_id);
  const luggageKg = body.luggage_kg == null ? 0 : Number(body.luggage_kg);
  const failAt = body.fail_at || null;

  if (![rideId, seatId, passengerId].every((value) => Number.isInteger(value) && value > 0)) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'ride_id, seat_id and passenger_id must be positive integers' });
  }
  if (!Number.isInteger(luggageKg) || luggageKg < 0 || luggageKg > 40) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'luggage_kg must be a whole number from 0 to 40' });
  }
  if (failAt && !['booking', 'payment', 'luggage'].includes(failAt)) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'fail_at must be booking, payment, luggage or null' });
  }

  const conn = await pool.getConnection();
  const trace = [];
  try {
    const result = await bookSeat(conn, { rideId, seatId, passengerId, luggageKg, failAt }, trace);
    res.json({ ok: true, committed: true, booking_id: result.bookingId, trace });
  } catch (error) {
    try {
      await conn.rollback();
      trace.push({ ts: ts(), actor: 'APP', step: 'ROLLBACK', status: 'ERROR' });
    } catch (_) { /* the connection may already be gone */ }
    const detail = dbError(error);
    const seatRace = Number(detail.code) === 1062 || Number(detail.code) === 1213;
    res.status(409).json({
      ok: false,
      committed: false,
      code: seatRace ? 'SEAT_TAKEN' : detail.code,
      sqlState: detail.sqlState,
      message: seatRace
        ? 'Another booking just took this seat — pick a different one.'
        : detail.message,
      rawCode: detail.code,
      trace,
    });
  } finally {
    conn.release();
  }
});

app.post('/api/cancel/:bookingId', async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'booking id must be a positive integer' });
  }
  const conn = await pool.getConnection();
  const trace = [];
  try {
    await conn.beginTransaction();
    trace.push({ ts: ts(), actor: 'APP', step: 'BEGIN', status: 'OK' });
    const [bookings] = await conn.query(
      'SELECT booking_id, status FROM bookings WHERE booking_id = ? FOR UPDATE',
      [bookingId],
    );
    if (!bookings.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, committed: false, code: 'NOT_FOUND', message: `ticket ${bookingId} does not exist`, trace });
    }
    if (bookings[0].status === 'CANCELLED') {
      await conn.rollback();
      return res.status(409).json({ ok: false, committed: false, code: 'ALREADY_CANCELLED', message: `ticket ${bookingId} is already cancelled`, trace });
    }
    await conn.query("UPDATE bookings SET status = 'CANCELLED' WHERE booking_id = ?", [bookingId]);
    trace.push({ ts: ts(), actor: 'APP', step: `UPDATE bookings -> ticket ${bookingId} cancelled`, status: 'OK' });
    await conn.query("UPDATE payments SET status = 'FAILED' WHERE booking_id = ?", [bookingId]);
    trace.push({ ts: ts(), actor: 'APP', step: `UPDATE payments -> voided for ticket ${bookingId}`, status: 'OK' });
    await conn.commit();
    trace.push({ ts: ts(), actor: 'APP', step: 'COMMIT', status: 'OK' });
    res.json({ ok: true, committed: true, trace });
  } catch (error) {
    try {
      await conn.rollback();
      trace.push({ ts: ts(), actor: 'APP', step: 'ROLLBACK', status: 'ERROR' });
    } catch (_) { /* the connection may already be gone */ }
    const detail = dbError(error);
    res.status(409).json({ ok: false, committed: false, code: detail.code, sqlState: detail.sqlState, message: detail.message, trace });
  } finally {
    conn.release();
  }
});

app.post('/api/constraint-demo', wrap(async (req, res) => {
  const type = (req.body || {}).type;
  let sql;
  let params = [];
  if (type === 'fk') {
    sql = "INSERT INTO rides (ride_no, cab_id, pickup_id, dropoff_id, pickup_at, dropoff_at) VALUES ('CB999', 999, 1, 2, '2026-12-01 09:00:00', '2026-12-01 12:00:00')";
  } else if (type === 'unique') {
    sql = "INSERT INTO passengers (name, email, phone) VALUES ('Demo Duplicate', 'asha@mail.com', NULL)";
  } else if (type === 'check') {
    const [bookings] = await pool.query('SELECT booking_id FROM bookings ORDER BY booking_id LIMIT 1');
    if (!bookings.length) return res.json({ ok: true, demo: type, code: 'NO_BOOKINGS', message: 'no ticket exists for the luggage check demo' });
    sql = 'INSERT INTO luggage (booking_id, kg, fee) VALUES (?, 50, 2500.00)';
    params = [bookings[0].booking_id];
  } else if (type === 'trigger') {
    const [bookings] = await pool.query("SELECT ride_id, seat_id, passenger_id FROM bookings WHERE status = 'CONFIRMED' ORDER BY booking_id LIMIT 1");
    if (!bookings.length) return res.json({ ok: true, demo: type, code: 'NO_BOOKINGS', message: 'no confirmed ticket exists to collide with' });
    sql = "INSERT INTO bookings (ride_id, seat_id, passenger_id, status) VALUES (?, ?, ?, 'CONFIRMED')";
    params = [bookings[0].ride_id, bookings[0].seat_id, bookings[0].passenger_id];
  } else {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'type must be fk, unique, check or trigger' });
  }

  try {
    await pool.query(sql, params);
    res.json({ ok: true, demo: type, code: 'NO_ERROR', message: 'statement unexpectedly succeeded' });
  } catch (error) {
    const detail = dbError(error);
    res.json({ ok: true, demo: type, sql, code: detail.code, sqlState: detail.sqlState, message: detail.message });
  }
}));

app.post('/api/isolation-demo', async (req, res) => {
  const body = req.body || {};
  const rideId = Number(body.ride_id);
  const seatId = Number(body.seat_id);
  const passengerId = Number(body.passenger_id || 1);
  const trace = [];
  if (![rideId, seatId, passengerId].every((value) => Number.isInteger(value) && value > 0)) {
    return res.status(400).json({ ok: false, code: 'BAD_INPUT', message: 'ride_id, seat_id and passenger_id must be positive integers' });
  }

  const connA = await pool.getConnection();
  let connB;
  let attemptB = null;
  try {
    connB = await pool.getConnection();
    await connA.query('SET SESSION innodb_lock_wait_timeout = 5');
    await connB.query('SET SESSION innodb_lock_wait_timeout = 5');

    await connA.beginTransaction();
    trace.push({ ts: ts(), actor: 'A', step: 'BEGIN', status: 'OK' });
    const [seats] = await connA.query('SELECT seat_no, fare FROM seats WHERE seat_id = ? AND ride_id = ? FOR UPDATE', [seatId, rideId]);
    if (!seats.length) {
      const error = new Error('Seat is not on this ride');
      error.code = 'SEAT_RIDE_MISMATCH';
      throw error;
    }
    trace.push({ ts: ts(), actor: 'A', step: `SELECT seat ${seats[0].seat_no} FOR UPDATE -> lock held`, status: 'OK' });
    // Occupancy is checked while A holds the seat row lock, so the check and
    // the booking are one atomic step (no check-then-act race).
    const [taken] = await connA.query(
      "SELECT booking_id FROM bookings WHERE seat_id = ? AND status = 'CONFIRMED'",
      [seatId],
    );
    if (taken.length) {
      await connA.rollback();
      return res.status(409).json({ ok: false, committed: false, code: 'SEAT_BUSY', message: 'isolation demo needs a free seat — choose one in the seat map', trace });
    }
    const [bookingA] = await connA.query(
      "INSERT INTO bookings (ride_id, seat_id, passenger_id, status) VALUES (?, ?, ?, 'CONFIRMED')",
      [rideId, seatId, passengerId],
    );
    trace.push({ ts: ts(), actor: 'A', step: `INSERT bookings -> booking_id ${bookingA.insertId} (uncommitted)`, status: 'OK' });
    await connA.query("INSERT INTO payments (booking_id, amount, status) VALUES (?, ?, 'PAID')", [bookingA.insertId, seats[0].fare]);
    trace.push({ ts: ts(), actor: 'A', step: `INSERT payments -> amount ${seats[0].fare} (uncommitted)`, status: 'OK' });

    attemptB = bookSeat(connB, { rideId, seatId, passengerId, luggageKg: 0, failAt: null }, trace, 'B');
    await sleep(1200);
    const [transactions] = await pool.query(
      'SELECT trx_state FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id = ?',
      [connB.connection.threadId],
    );
    trace.push({
      ts: ts(), actor: 'B',
      step: transactions.length ? `status while A holds the lock: trx_state = ${transactions[0].trx_state}` : 'attempting booking',
      status: 'WAIT',
    });

    await connA.commit();
    trace.push({ ts: ts(), actor: 'A', step: 'COMMIT -> ticket is now visible', status: 'OK' });
    let bFailed = null;
    try {
      await attemptB;
    } catch (error) {
      bFailed = dbError(error);
      try {
        await connB.rollback();
        trace.push({ ts: ts(), actor: 'B', step: 'ROLLBACK', status: 'ERROR' });
      } catch (_) { /* the connection may already be gone */ }
      trace.push({ ts: ts(), actor: 'B', step: `failed: [${bFailed.code}] ${bFailed.message}`, status: 'ERROR' });
    }
    res.json({ ok: true, committed: true, trace, b_failed: bFailed });
  } catch (error) {
    // Never release connB with an open transaction: settle B first, then roll
    // back both connections so the pool never inherits either transaction.
    if (attemptB) {
      try { await attemptB; } catch (_) { /* B failed or already settled */ }
    }
    try { await connB.rollback(); } catch (_) { /* B may not have begun */ }
    try { await connA.rollback(); } catch (_) { /* A may not have begun */ }
    const detail = dbError(error);
    res.status(500).json({ ok: false, committed: false, code: detail.code, sqlState: detail.sqlState, message: detail.message, trace });
  } finally {
    connA.release();
    if (connB) connB.release();
  }
});

app.post('/api/query', wrap(async (req, res) => {
  const sql = String((req.body || {}).sql || '').trim();
  const body = sql.replace(/;+\s*$/, '');
  const first = (body.match(/^[a-zA-Z]+/) || [''])[0].toUpperCase();
  if (!body) return res.status(400).json({ ok: false, code: 'EMPTY', message: 'type a SQL statement' });
  if (body.includes(';')) return res.status(400).json({ ok: false, code: 'MULTI', message: 'only a single statement is allowed' });
  if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(first)) {
    return res.status(400).json({ ok: false, code: 'FORBIDDEN', message: `only SELECT, INSERT, UPDATE, DELETE are allowed (got ${first || 'nothing'})` });
  }
  // Hosted deployments set SETUP_TOKEN; there the console is read-only unless
  // the request carries the token. Local demos keep full teaching access.
  if (!tokenOk(req) && first !== 'SELECT') {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'write statements need the x-setup-token header in hosted deployments' });
  }
  try {
    const [rows, fields] = await pool.query(body);
    if (Array.isArray(rows)) {
      res.json({ ok: true, columns: fields.map((field) => field.name), rows: rows.slice(0, 200) });
    } else {
      res.json({ ok: true, columns: [], rows: [], affectedRows: rows.affectedRows, insertId: rows.insertId });
    }
  } catch (error) {
    const detail = dbError(error);
    res.status(400).json({ ok: false, code: detail.code, sqlState: detail.sqlState, message: detail.message });
  }
}));

app.get('/api/logs/audit', wrap(async (req, res) => {
  const since = Number(req.query.since) || 0;
  const [rows] = await pool.query(
    `SELECT log_id, table_name, action, row_id, old_data, new_data, logged_at
     FROM audit_log WHERE log_id > ? ORDER BY log_id DESC LIMIT 100`,
    [since],
  );
  res.json({ ok: true, rows });
}));

app.get('/api/logs/general', wrap(async (req, res) => {
  const [generalLog] = await pool.query('SELECT @@general_log AS enabled');
  if (!generalLog[0].enabled) return res.json({ ok: true, enabled: false, rows: [] });
  try {
    const [rows] = await pool.query(
      `SELECT event_time, user_host, command_type,
              CAST(argument AS CHAR CHARACTER SET utf8mb4) AS argument
       FROM mysql.general_log
       WHERE user_host LIKE ? AND argument NOT LIKE '%general_log%'
       ORDER BY event_time DESC, thread_id DESC LIMIT 30`,
      [`${process.env.DB_USER}%`],
    );
    res.json({ ok: true, enabled: true, rows });
  } catch (_) {
    // Hosted users typically lack privileges on mysql.*; that is expected.
    res.json({ ok: true, enabled: true, rows: [], note: 'no privilege to read mysql.general_log on this host' });
  }
}));

// One-time hosted-database bootstrap: creates tables, triggers and sample data
// without CREATE DATABASE (managed MySQL refuses it). Guarded by SETUP_TOKEN.
// Tolerant mode: on trigger-less managed hosts (TiDB, PlanetScale) the trigger
// statements are skipped and everything else still installs.
app.post('/api/setup', wrap(async (req, res) => {
  if (!tokenOk(req)) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'missing or wrong x-setup-token header' });
  }
  const conn = await tempConnection();
  try {
    const schema = await runSqlFile(conn, 'schema.sql', true);
    const seed = await runSqlFile(conn, 'seed.sql', true);
    res.json({
      ok: true,
      message: 'cabnation schema and sample data are ready',
      schema: { applied: schema.applied, skipped: schema.skipped },
      seed: { applied: seed.applied, skipped: seed.skipped },
    });
  } finally {
    await conn.end();
  }
}));

app.post('/api/reset', wrap(async (req, res) => {
  if (!tokenOk(req)) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'resetting sample data is token-gated in hosted deployments' });
  }
  const conn = await tempConnection();
  try {
    const result = await runSqlFile(conn, 'seed.sql');
    let logCleared = true;
    try {
      await conn.query('TRUNCATE TABLE mysql.general_log');  // local MySQL only; hosted users lack the privilege
    } catch (_) {
      logCleared = false;
    }
    res.json({ ok: true, message: 'CABNATION sample data reset', statements: result.applied, logCleared });
  } finally {
    await conn.end();
  }
}));

function wrap(handler) {
  return (req, res) => handler(req, res).catch((error) => {
    console.error(error);
    const detail = dbError(error);
    res.status(500).json({ ok: false, code: detail.code, sqlState: detail.sqlState, message: detail.message });
  });
}

// Malformed JSON bodies surface as 400 instead of the generic 500.
app.use((error, req, res, next) => {
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', message: 'request body is not valid JSON' });
  }
  next(error);
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`CABNATION listening on http://localhost:${PORT}`));
}

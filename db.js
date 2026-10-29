// db.js: owns the MySQL connection pool and shared helpers for CABNATION.
require('dotenv').config();
const mysql = require('mysql2/promise');

// One pool for the whole app: 5 reusable connections so requests do not
// re-handshake with MySQL every time. dateStrings keeps DATETIME readable.
// DB_SSL=true turns on TLS for hosted providers (TiDB, PlanetScale, Aiven...).
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  connectionLimit: 5,
  queueLimit: 10,
  dateStrings: true,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

// Whitelist: table name -> the exact SQL used to read it. Anything not listed
// here is refused, so /api/table can never be pointed at an arbitrary table.
const TABLE_SQL = {
  stands: 'SELECT stand_id, code, stand_name, city FROM stands ORDER BY stand_id',
  cabs: 'SELECT cab_id, cab_code, operator_name, cab_name, cab_type FROM cabs ORDER BY cab_id',
  rides: 'SELECT ride_id, ride_no, cab_id, pickup_id, dropoff_id, pickup_at, dropoff_at FROM rides ORDER BY ride_id',
  seats: 'SELECT seat_id, ride_id, seat_no, class, fare FROM seats ORDER BY seat_id',
  passengers: 'SELECT passenger_id, name, email, phone FROM passengers ORDER BY passenger_id',
  bookings: 'SELECT booking_id, ride_id, seat_id, passenger_id, status, created_at FROM bookings ORDER BY booking_id DESC LIMIT 500',
  payments: 'SELECT payment_id, booking_id, amount, status, paid_at FROM payments ORDER BY payment_id DESC LIMIT 500',
  luggage: 'SELECT luggage_id, booking_id, kg, fee FROM luggage ORDER BY luggage_id DESC LIMIT 500',
  audit_log: 'SELECT log_id, table_name, action, row_id, old_data, new_data, logged_at FROM audit_log ORDER BY log_id DESC LIMIT 500',
  unnormalized_bookings: 'SELECT * FROM unnormalized_bookings ORDER BY unnorm_id',
  bookings_1nf: 'SELECT * FROM bookings_1nf ORDER BY booking_no, bag_no',
  bookings_2nf: 'SELECT * FROM bookings_2nf ORDER BY booking_no',
  rides_2nf: 'SELECT * FROM rides_2nf ORDER BY ride_no',
  bookings_3nf: 'SELECT * FROM bookings_3nf ORDER BY booking_no',
  passengers_3nf: 'SELECT * FROM passengers_3nf ORDER BY passenger_name',
  rides_3nf: 'SELECT * FROM rides_3nf ORDER BY ride_no',
};

// MySQL error -> {code, message, sqlState} so every endpoint answers uniformly.
function dbError(e) {
  return { code: e.errno || e.code || 'ERROR', message: e.message, sqlState: e.sqlState || null };
}

// Wall-clock timestamp with milliseconds for the UI trace/log lines.
function ts() {
  return new Date().toISOString().slice(11, 23);
}

// sleep(ms) used only by the isolation demo to hold connection A open.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { pool, TABLE_SQL, dbError, ts, sleep };

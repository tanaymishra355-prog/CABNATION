# CABNATION

CABNATION is a local intercity cab ticketing app and RDBMS teaching demo. Passengers can browse scheduled rides, choose a seat, add luggage, confirm a ticket, and cancel it later. A separate operations view exposes the database tables, transactions, constraints, audit log, and SQL examples.

## Project structure

```text
CABNATION/
├── api/
│   └── index.js             # Vercel serverless entry for the Express app
├── public/
│   ├── index.html          # Passenger booking page and operations console
│   ├── site.js             # Rides, seats, passengers, checkout and tickets
│   ├── app.js              # RDBMS console, table explorer and logs
│   └── style.css           # CABNATION visual system and responsive layout
├── sql/
│   ├── 1nf.sql              # Split the flat luggage list into atomic rows
│   ├── 2nf.sql              # Separate repeated ride facts
│   └── 3nf.sql              # Separate passenger and ride facts
├── db.js                    # MySQL pool, table whitelist and shared helpers
├── server.js                # Express API and transactional booking logic
├── schema.sql               # Database, tables, constraints and triggers
├── seed.sql                 # Repeatable sample stands, rides and tickets
├── vercel.json              # Route rewrites for the Vercel deployment
├── PROJECT_EXPLAINED.txt    # Full walkthrough of the project and its concepts
├── package-lock.json
├── package.json
├── .env.example
└── .gitignore
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Zero build step; every API call is inspectable |
| Backend | Node.js + Express | Small, explicit REST API in one file |
| Database | MySQL 8 (InnoDB) | Transactions, row locks, constraints, triggers |
| Driver | mysql2 | Prepared statements prevent SQL injection |
| Hosting | Vercel + hosted MySQL | `api/index.js` + `vercel.json` are preconfigured |

## Concepts covered

Every concept below is demonstrated with working code and UI buttons. `PROJECT_EXPLAINED.txt` walks through each one in plain language, with the SQL and MySQL error codes involved.

| Concept | Where to see it |
|---|---|
| Normalization (1NF–3NF) | `sql/` views, anomaly buttons in the RDBMS lab |
| Primary/foreign keys, `ON DELETE RESTRICT` | `schema.sql`, FK demo button |
| UNIQUE / CHECK / NOT NULL / ENUM | Constraint demo buttons (errors 1062/3819/1265) |
| Transactions (BEGIN/COMMIT/ROLLBACK) | `POST /api/book`, forced-failure demo |
| ACID properties | Atomicity/consistency/isolation/durability demos |
| Row locking (`SELECT ... FOR UPDATE`) | Two-connection seat-lock demo |
| Triggers (14) | Double-booking guards + audit log entries |
| Audit logging with before/after images | `audit_log` table, audit log panel |
| Generated columns + unique indexes | `bookings.active_seat_id` race-safe seat guard |
| Prepared statements / injection safety | every parameterized query in `server.js` |

## Run locally

Requirements: Node.js 18+ and MySQL 8.0.16+ (the project uses enforced `CHECK` constraints).

1. Install dependencies: `npm ci`
2. Copy `.env.example` to `.env` and set your local MySQL user and password.
3. Run `mysql -u root -p < schema.sql`.
4. Run `mysql -u root -p < seed.sql`.
5. Start the app with `npm start` and open [http://localhost:3000](http://localhost:3000).

**Important:** `schema.sql` drops and recreates the `cabnation` database. Do not run it against a database containing data you need.

The `.env` file is ignored by Git. Never put a password or access token in source files.

## Booking flow

- Browse the sample Mumbai–Pune, Delhi–Jaipur, and Bengaluru–Chennai rides.
- See live seat availability and fares; front-row seats have a separate fare.
- Select a passenger or add a passenger record, then optionally add luggage (₹50/kg, 1–40 kg).
- Confirm a ticket. The ticket, payment record, and optional luggage record are created in one transaction.
- Review or cancel a ticket under **My tickets**. Cancellation keeps the history and releases the seat.

Sample rides and fares are stored in MySQL, not hard-coded into the page. `seed.sql` restores the same demo dataset and resets generated IDs.

## RDBMS lab

Choose **RDBMS lab** in the top navigation to explore:

- Normalized tables for stands, cabs, rides, seats, passengers, bookings, payments, and luggage.
- Primary/foreign keys, unique and check constraints, and a database-level active-seat uniqueness rule.
- Booking transactions, forced rollbacks, row locks, and a two-connection isolation demo.
- Trigger-written audit rows and, optionally, MySQL's general query log.
- A single-statement SQL box and the flat-table normalization examples.

To create the optional normalization views, run:

```sh
mysql -u root -p cabnation < sql/1nf.sql
mysql -u root -p cabnation < sql/2nf.sql
mysql -u root -p cabnation < sql/3nf.sql
```

The general query log is off by default. To enable it in MySQL, use an administrative account:

```sql
SET GLOBAL log_output = 'TABLE';
SET GLOBAL general_log = 'ON';
```

Turn it off after the demo with `SET GLOBAL general_log = 'OFF';`.

## Deploy to Vercel (with a hosted MySQL)

Vercel runs the app, but provides no MySQL server, so pair it with a hosted MySQL such as TiDB Cloud Serverless (free tier), PlanetScale, or Aiven.

1. Create a hosted MySQL database and note its host, user, password and database name.
2. Push this repository to GitHub, then on vercel.com choose **Add New → Project → Import** the repo.
3. Add environment variables in the Vercel project settings:
   - `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   - `DB_SSL=true` (TiDB and most managed providers require TLS)
   - `SETUP_TOKEN=any-long-random-string`
4. Deploy, then bootstrap the schema once:
   `curl -X POST https://your-app.vercel.app/api/setup -H "x-setup-token: YOUR_SETUP_TOKEN"`
5. Open the app URL — `/api/health` should report connected.

The hosted setup route skips the local-only `DROP/CREATE DATABASE` lines and creates all tables, triggers and sample data inside your hosted database. Use **POST /api/reset** later to restore the sample data.

## Local-demo limitations

This project simulates a successful payment record; it does **not** contact a payment provider. It has no user authentication, and its SQL console permits writes for teaching purposes. Keep it on localhost—do not expose it as a public booking service without adding authentication, payment integration, rate limits, and stricter database/API permissions.

import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set (see .env.example).");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Hosted databases (Render, Neon, Supabase) usually require SSL. Set DATABASE_SSL=true for them.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
pool.on("error", (error) => console.error("Unexpected database error:", error));

const query = (text, params) => pool.query(text, params);

// Runs callback(client) inside BEGIN/COMMIT on one dedicated connection; rolls back on any error.
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Express 4 does not catch rejected promises, so async handlers are wrapped to forward errors to next().
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Route ids must be whole numbers; anything else would make Postgres throw instead of returning "not found".
const parseId = (value) => (/^\d{1,9}$/.test(value) ? Number(value) : null);

await query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('attendee', 'organizer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    date_time TIMESTAMPTZ NOT NULL,
    venue TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    ticket_count INTEGER NOT NULL CHECK (ticket_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, event_id)
  );
`);

const demoOrganizer = await query("SELECT id FROM users WHERE LOWER(email) = $1", ["hello@eventpulse.local"]);
if (demoOrganizer.rowCount === 0) {
  await transaction(async (client) => {
    const { rows: [organizer] } = await client.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'organizer') RETURNING id",
      ["EventPulse Community", "hello@eventpulse.local", await bcrypt.hash("eventpulse-demo", 10)],
    );
    const day = (offset, hour = 17) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      date.setHours(hour, 0, 0, 0);
      return date.toISOString();
    };
    const seedEvents = [
      ["Designing for a better city", "A hands-on evening of fresh ideas, practical design exercises, and good conversation with people shaping our city.", "Workshop", day(5, 18), "The Workshop Loft · Downtown", 36],
      ["Sunday on the waterfront", "A laid-back afternoon of local makers, live acoustic sets, and the best small-batch food in town.", "Community", day(8, 14), "Harbor Market, Pier 4", 120],
      ["The next wave in climate tech", "Meet the builders turning ambitious climate solutions into real-world impact. Talks, Q&A, and networking included.", "Technology", day(12, 18), "Foundry Hall", 80],
      ["Run club: sunrise miles", "All paces welcome. Pick your distance, meet your running crew, and finish with coffee on us.", "Wellness", day(15, 7), "Riverside Park · North Gate", 45],
    ];
    for (const [title, description, category, dateTime, venue, capacity] of seedEvents) {
      await client.query(
        "INSERT INTO events (title, description, category, date_time, venue, capacity, organizer_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [title, description, category, dateTime, venue, capacity, organizer.id],
      );
    }
  });
}

const app = express();
const jwtSecret = process.env.JWT_SECRET || "local-development-only-change-before-deploying";
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const signToken = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });
const userById = async (id) => (await query("SELECT id, name, email, role FROM users WHERE id = $1", [id])).rows[0];

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
  const user = await userById(payload.sub);
  if (!user) return res.status(401).json({ error: "Your session is no longer valid. Please sign in again." });
  req.user = user;
  next();
});

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: `Only ${role}s can do that.` });
    next();
  };
}

function readEventInput(body, partial = false) {
  const fields = ["title", "description", "category", "date_time", "venue", "capacity"];
  const result = {};
  for (const field of fields) {
    if (partial && body[field] === undefined) continue;
    const value = body[field];
    if (field === "capacity") {
      const capacity = Number(value);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
        return { error: "Capacity must be a whole number between 1 and 10,000." };
      }
      result[field] = capacity;
      continue;
    }
    if (typeof value !== "string" || !value.trim()) return { error: `${field.replace("_", " ")} is required.` };
    const trimmed = value.trim();
    if (field === "date_time") {
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime()) || date <= new Date()) return { error: "Choose an event date and time in the future." };
      result[field] = date.toISOString();
    } else {
      const max = field === "description" ? 3000 : 120;
      if (trimmed.length > max) return { error: `${field.replace("_", " ")} must be ${max} characters or fewer.` };
      result[field] = trimmed;
    }
  }
  return { value: result };
}

// SUM() comes back from Postgres as a string, so it is cast to int to keep reserved/available numeric in the JSON.
const eventSelect = `
  SELECT e.id, e.title, e.description, e.category, e.date_time, e.venue, e.capacity,
         e.organizer_id, u.name AS organizer_name,
         COALESCE(SUM(r.ticket_count), 0)::int AS reserved,
         (e.capacity - COALESCE(SUM(r.ticket_count), 0))::int AS available
  FROM events e
  JOIN users u ON u.id = e.organizer_id
  LEFT JOIN registrations r ON r.event_id = e.id
`;
const oneEvent = async (id) => (await query(`${eventSelect} WHERE e.id = $1 GROUP BY e.id, u.id`, [id])).rows[0];

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) {
    return res.status(400).json({ error: "Name must be between 2 and 80 characters." });
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  }
  if (!["attendee", "organizer"].includes(role)) return res.status(400).json({ error: "Choose an account type." });
  try {
    const { rows: [user] } = await query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name.trim(), email.trim().toLowerCase(), await bcrypt.hash(password, 10), role],
    );
    res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    throw error;
  }
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your email and password." });
  }
  const { rows: [row] } = await query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email.trim()]);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.json({ user, token: signToken(user) });
}));

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/events", asyncHandler(async (req, res) => {
  const conditions = ["e.date_time >= now()"];
  const values = [];
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    values.push(`%${req.query.q.trim()}%`);
    const n = values.length;
    conditions.push(`(e.title ILIKE $${n} OR e.description ILIKE $${n} OR e.venue ILIKE $${n})`);
  }
  if (typeof req.query.category === "string" && req.query.category !== "All events") {
    values.push(req.query.category);
    conditions.push(`e.category = $${values.length}`);
  }
  const { rows: events } = await query(
    `${eventSelect} WHERE ${conditions.join(" AND ")} GROUP BY e.id, u.id ORDER BY e.date_time ASC`,
    values,
  );
  res.json({ events });
}));

app.get("/api/events/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const event = id && await oneEvent(id);
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  res.json({ event });
}));

app.post("/api/events", requireAuth, requireRole("organizer"), asyncHandler(async (req, res) => {
  const { value, error } = readEventInput(req.body ?? {});
  if (error) return res.status(400).json({ error });
  const { rows: [created] } = await query(
    "INSERT INTO events (title, description, category, date_time, venue, capacity, organizer_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [value.title, value.description, value.category, value.date_time, value.venue, value.capacity, req.user.id],
  );
  res.status(201).json({ event: await oneEvent(created.id) });
}));

app.patch("/api/events/:id", requireAuth, requireRole("organizer"), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const event = id && (await query("SELECT * FROM events WHERE id = $1", [id])).rows[0];
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  if (event.organizer_id !== req.user.id) return res.status(403).json({ error: "You can only edit your own events." });
  const { value, error } = readEventInput(req.body ?? {}, true);
  if (error) return res.status(400).json({ error });
  if (value.capacity !== undefined) {
    const { rows: [{ count }] } = await query(
      "SELECT COALESCE(SUM(ticket_count), 0)::int AS count FROM registrations WHERE event_id = $1",
      [event.id],
    );
    if (value.capacity < count) return res.status(400).json({ error: `Capacity can't be lower than the ${count} tickets already reserved.` });
  }
  // Column names come from the fixed whitelist in readEventInput, never from raw user input.
  const fields = Object.keys(value);
  if (fields.length) {
    const assignments = fields.map((field, index) => `${field} = $${index + 1}`).join(", ");
    await query(`UPDATE events SET ${assignments} WHERE id = $${fields.length + 1}`, [...fields.map((field) => value[field]), event.id]);
  }
  res.json({ event: await oneEvent(event.id) });
}));

app.delete("/api/events/:id", requireAuth, requireRole("organizer"), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const event = id && (await query("SELECT organizer_id FROM events WHERE id = $1", [id])).rows[0];
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  if (event.organizer_id !== req.user.id) return res.status(403).json({ error: "You can only cancel your own events." });
  await query("DELETE FROM events WHERE id = $1", [id]);
  res.status(204).end();
}));

app.post("/api/events/:id/registrations", requireAuth, requireRole("attendee"), asyncHandler(async (req, res) => {
  const count = Number(req.body?.ticket_count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return res.status(400).json({ error: "Choose between 1 and 10 tickets." });
  }
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "We couldn't find that event." });
  const result = await transaction(async (client) => {
    // FOR UPDATE locks the event row, so two people booking the last seats are processed one at a time.
    const { rows: [event] } = await client.query("SELECT id, capacity, date_time FROM events WHERE id = $1 FOR UPDATE", [id]);
    if (!event) return { status: 404, error: "We couldn't find that event." };
    if (event.date_time <= new Date()) return { status: 400, error: "This event has already taken place." };
    const existing = await client.query("SELECT 1 FROM registrations WHERE user_id = $1 AND event_id = $2", [req.user.id, event.id]);
    if (existing.rowCount) return { status: 409, error: "You're already registered for this event." };
    const { rows: [{ reserved }] } = await client.query(
      "SELECT COALESCE(SUM(ticket_count), 0)::int AS reserved FROM registrations WHERE event_id = $1",
      [event.id],
    );
    if (reserved + count > event.capacity) return { status: 409, error: "There aren't enough tickets left for that quantity." };
    const { rows: [registration] } = await client.query(
      "INSERT INTO registrations (user_id, event_id, ticket_count) VALUES ($1, $2, $3) RETURNING *",
      [req.user.id, event.id, count],
    );
    return { registration };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result);
}));

app.get("/api/me/registrations", requireAuth, requireRole("attendee"), asyncHandler(async (req, res) => {
  const { rows: registrations } = await query(`
    SELECT r.id, r.ticket_count, r.created_at, e.id AS event_id, e.title, e.category,
           e.date_time, e.venue, u.name AS organizer_name
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN users u ON u.id = e.organizer_id
    WHERE r.user_id = $1
    ORDER BY e.date_time ASC
  `, [req.user.id]);
  res.json({ registrations });
}));

app.get("/api/organizer/events/:id/registrations", requireAuth, requireRole("organizer"), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const event = id && (await query("SELECT id, organizer_id FROM events WHERE id = $1", [id])).rows[0];
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  if (event.organizer_id !== req.user.id) return res.status(403).json({ error: "You can only view guests for your own events." });
  const { rows: registrations } = await query(`
    SELECT r.id, r.ticket_count, r.created_at, u.name, u.email
    FROM registrations r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = $1 ORDER BY r.created_at DESC
  `, [event.id]);
  res.json({ registrations });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`EventPulse API listening on http://localhost:${port}`));
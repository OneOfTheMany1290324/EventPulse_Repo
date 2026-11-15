import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production.");
}
const databasePath = path.resolve(process.env.DATABASE_PATH ?? path.join(root, "data", "eventpulse.sqlite"));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
const transaction = (callback) => () => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('attendee', 'organizer')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    date_time TEXT NOT NULL,
    venue TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    ticket_count INTEGER NOT NULL CHECK (ticket_count > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, event_id)
  );
`);

const demoOrganizer = db.prepare("SELECT id FROM users WHERE email = ?").get("hello@eventpulse.local");
if (!demoOrganizer) {
  const createDemo = transaction(() => {
    const organizerId = Number(db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'organizer')",
    ).run("EventPulse Community", "hello@eventpulse.local", bcrypt.hashSync("eventpulse-demo", 10)).lastInsertRowid);
    const addEvent = db.prepare(
      "INSERT INTO events (title, description, category, date_time, venue, capacity, organizer_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const day = (offset, hour = 17) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      date.setHours(hour, 0, 0, 0);
      return date.toISOString();
    };
    addEvent.run("Designing for a better city", "A hands-on evening of fresh ideas, practical design exercises, and good conversation with people shaping our city.", "Workshop", day(5, 18), "The Workshop Loft · Downtown", 36, organizerId);
    addEvent.run("Sunday on the waterfront", "A laid-back afternoon of local makers, live acoustic sets, and the best small-batch food in town.", "Community", day(8, 14), "Harbor Market, Pier 4", 120, organizerId);
    addEvent.run("The next wave in climate tech", "Meet the builders turning ambitious climate solutions into real-world impact. Talks, Q&A, and networking included.", "Technology", day(12, 18), "Foundry Hall", 80, organizerId);
    addEvent.run("Run club: sunrise miles", "All paces welcome. Pick your distance, meet your running crew, and finish with coffee on us.", "Wellness", day(15, 7), "Riverside Park · North Gate", 45, organizerId);
  });
  createDemo();
}

const app = express();
const jwtSecret = process.env.JWT_SECRET || "local-development-only-change-before-deploying";
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });
const userById = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?");
const signToken = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const { sub } = jwt.verify(token, jwtSecret);
    const user = userById.get(sub);
    if (!user) return res.status(401).json({ error: "Your session is no longer valid. Please sign in again." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

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

const eventSelect = `
  SELECT e.id, e.title, e.description, e.category, e.date_time, e.venue, e.capacity,
         e.organizer_id, u.name AS organizer_name,
         COALESCE(SUM(r.ticket_count), 0) AS reserved,
         e.capacity - COALESCE(SUM(r.ticket_count), 0) AS available
  FROM events e
  JOIN users u ON u.id = e.organizer_id
  LEFT JOIN registrations r ON r.event_id = e.id
`;
const oneEvent = db.prepare(`${eventSelect} WHERE e.id = ? GROUP BY e.id`);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", (req, res) => {
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
    const result = db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    ).run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role);
    const user = userById.get(result.lastInsertRowid);
    res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "An account with that email already exists." });
    throw error;
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your email and password." });
  }
  const row = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email.trim());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const user = publicUser(row);
  res.json({ user, token: signToken(user) });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/events", (req, res) => {
  const conditions = ["datetime(e.date_time) >= datetime('now')"];
  const values = [];
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    conditions.push("(e.title LIKE ? OR e.description LIKE ? OR e.venue LIKE ?)");
    const search = `%${req.query.q.trim()}%`;
    values.push(search, search, search);
  }
  if (typeof req.query.category === "string" && req.query.category !== "All events") {
    conditions.push("e.category = ?");
    values.push(req.query.category);
  }
  const events = db.prepare(`${eventSelect} WHERE ${conditions.join(" AND ")} GROUP BY e.id ORDER BY e.date_time ASC`)
    .all(...values);
  res.json({ events });
});

app.get("/api/events/:id", (req, res) => {
  const event = oneEvent.get(req.params.id);
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  res.json({ event });
});

app.post("/api/events", requireAuth, requireRole("organizer"), (req, res) => {
  const { value, error } = readEventInput(req.body ?? {});
  if (error) return res.status(400).json({ error });
  const result = db.prepare(
    "INSERT INTO events (title, description, category, date_time, venue, capacity, organizer_id) VALUES (@title, @description, @category, @date_time, @venue, @capacity, @organizer_id)",
  ).run({ ...value, organizer_id: req.user.id });
  res.status(201).json({ event: oneEvent.get(result.lastInsertRowid) });
});

app.patch("/api/events/:id", requireAuth, requireRole("organizer"), (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  if (event.organizer_id !== req.user.id) return res.status(403).json({ error: "You can only edit your own events." });
  const { value, error } = readEventInput(req.body ?? {}, true);
  if (error) return res.status(400).json({ error });
  const changes = { ...value, id: event.id };
  if (value.capacity !== undefined) {
    const reserved = db.prepare("SELECT COALESCE(SUM(ticket_count), 0) AS count FROM registrations WHERE event_id = ?").get(event.id).count;
    if (value.capacity < reserved) return res.status(400).json({ error: `Capacity can't be lower than the ${reserved} tickets already reserved.` });
  }
  if (Object.keys(value).length) {
    const assignments = Object.keys(value).map((field) => `${field} = @${field}`).join(", ");
    db.prepare(`UPDATE events SET ${assignments} WHERE id = @id`).run(changes);
  }
  res.json({ event: oneEvent.get(event.id) });
});

app.delete("/api/events/:id", requireAuth, requireRole("organizer"), (req, res) => {
  const event = db.prepare("SELECT organizer_id FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  if (event.organizer_id !== req.user.id) return res.status(403).json({ error: "You can only cancel your own events." });
  db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

app.post("/api/events/:id/registrations", requireAuth, requireRole("attendee"), (req, res) => {
  const count = Number(req.body?.ticket_count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return res.status(400).json({ error: "Choose between 1 and 10 tickets." });
  }
  const reserve = transaction(() => {
    const event = db.prepare("SELECT id, capacity FROM events WHERE id = ?").get(req.params.id);
    if (!event) return { status: 404, error: "We couldn't find that event." };
    if (new Date(oneEvent.get(event.id).date_time) <= new Date()) return { status: 400, error: "This event has already taken place." };
    if (db.prepare("SELECT 1 FROM registrations WHERE user_id = ? AND event_id = ?").get(req.user.id, event.id)) {
      return { status: 409, error: "You're already registered for this event." };
    }
    const reserved = db.prepare("SELECT COALESCE(SUM(ticket_count), 0) AS count FROM registrations WHERE event_id = ?").get(event.id).count;
    if (reserved + count > event.capacity) return { status: 409, error: "There aren't enough tickets left for that quantity." };
    const result = db.prepare("INSERT INTO registrations (user_id, event_id, ticket_count) VALUES (?, ?, ?)")
      .run(req.user.id, event.id, count);
    return { registration: db.prepare("SELECT * FROM registrations WHERE id = ?").get(result.lastInsertRowid) };
  });
  const result = reserve();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result);
});

app.get("/api/me/registrations", requireAuth, requireRole("attendee"), (_req, res) => {
  const registrations = db.prepare(`
    SELECT r.id, r.ticket_count, r.created_at, e.id AS event_id, e.title, e.category,
           e.date_time, e.venue, u.name AS organizer_name
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN users u ON u.id = e.organizer_id
    WHERE r.user_id = ?
    ORDER BY e.date_time ASC
  `).all(_req.user.id);
  res.json({ registrations });
});

app.get("/api/organizer/events/:id/registrations", requireAuth, requireRole("organizer"), (req, res) => {
  const event = db.prepare("SELECT id, organizer_id FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "We couldn't find that event." });
  if (event.organizer_id !== req.user.id) return res.status(403).json({ error: "You can only view guests for your own events." });
  const registrations = db.prepare(`
    SELECT r.id, r.ticket_count, r.created_at, u.name, u.email
    FROM registrations r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? ORDER BY r.created_at DESC
  `).all(event.id);
  res.json({ registrations });
});

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

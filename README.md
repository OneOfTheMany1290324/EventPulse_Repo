# EventPulse

EventPulse is a community event discovery and reservation app. Attendees can search upcoming events, reserve tickets, and see their bookings. Organizers can publish and edit events, cancel listings, and view guest lists. The interface is responsive and the API enforces account roles, unique registrations, and event capacity.

## Run locally

Requires Node.js 22.13+ (the server uses Node's built-in SQLite module).

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (usually `http://localhost:5173`). The Express API runs on port 3001, and SQLite creates `data/eventpulse.sqlite` automatically. The local database is ignored by git. No separately installed database server or native build tools are required.

The app seeds four upcoming sample events on first launch. To try the organizer dashboard, create an organizer account. Attendee accounts are created from the sign-up form. Passwords are hashed with bcrypt before storage.

For production, set `JWT_SECRET` to a long, random secret and set `DATABASE_PATH` to a persistent writable database location before running `npm run build` and `npm start`. The server hosts the built frontend and API on the same port.

## API

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/events`, `GET /api/events/:id`, `POST /api/events`, `PATCH /api/events/:id`, `DELETE /api/events/:id`
- `POST /api/events/:id/registrations`, `GET /api/me/registrations`
- `GET /api/organizer/events/:id/registrations`

Authenticated routes use `Authorization: Bearer <token>`. Event creation and management require an organizer account; reservations require an attendee account.

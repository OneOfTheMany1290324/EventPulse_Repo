import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";

const API = "/api";
const AuthContext = createContext(null);
const categories = ["All events", "Workshop", "Community", "Technology", "Wellness", "Arts", "Food"];
const icons = { Workshop: "✳", Community: "⌂", Technology: "⌘", Wellness: "◉", Arts: "✦", Food: "⌑" };

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("eventpulse-session")) || null; }
    catch { return null; }
  });
  const signIn = (data) => {
    const next = { user: data.user, token: data.token };
    localStorage.setItem("eventpulse-session", JSON.stringify(next));
    setSession(next);
  };
  const signOut = () => {
    localStorage.removeItem("eventpulse-session");
    setSession(null);
  };
  const value = useMemo(() => ({ ...session, signIn, signOut }), [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() { return useContext(AuthContext); }

function App() {
  return <AuthProvider><Layout /></AuthProvider>;
}

function Layout() {
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="EventPulse home">
          <span className="brand-mark"><span /></span><span>event<span className="brand-light">pulse</span></span>
        </Link>
        <button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">☰</button>
        <nav className={menuOpen ? "nav-links nav-open" : "nav-links"}>
          <Link to="/" onClick={() => setMenuOpen(false)}>Explore</Link>
          {auth?.user?.role === "attendee" && <Link to="/my-tickets" onClick={() => setMenuOpen(false)}>My tickets</Link>}
          {auth?.user?.role === "organizer" && <Link to="/dashboard" onClick={() => setMenuOpen(false)}>Dashboard</Link>}
        </nav>
        <div className="nav-actions">
          {auth?.user ? <>
            <span className="nav-greeting">Hey, {auth.user.name.split(" ")[0]}</span>
            <button className="button button-outline button-small" onClick={auth.signOut}>Sign out</button>
            {auth.user.role === "organizer" && <Link className="button button-primary button-small" to="/create">+ Host an event</Link>}
          </> : <>
            <Link className="nav-login" to="/login">Log in</Link>
            <Link className="button button-primary button-small" to="/signup">Join EventPulse <span>↗</span></Link>
          </>}
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/events/:id" element={<EventDetails />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/create" element={<EventForm />} />
          <Route path="/events/:id/edit" element={<EventForm />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/my-tickets" element={<MyTickets />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">
        <Link className="brand footer-brand" to="/"><span className="brand-mark"><span /></span><span>event<span className="brand-light">pulse</span></span></Link>
        <span>Good things happen when we get together.</span>
        <span>© {new Date().getFullYear()} EventPulse</span>
      </footer>
    </div>
  );
}

function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "All events");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category !== "All events") params.set("category", category);
    setSearchParams(params, { replace: true });
    setLoading(true);
    const timer = setTimeout(() => {
      request(`/events?${params}`).then(({ events: items }) => {
        if (active) { setEvents(items); setError(""); }
      }).catch((err) => { if (active) setError(err.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [query, category, setSearchParams]);

  const featured = events[0];
  return (
    <>
      <section className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <div className="eyebrow"><span className="pulse-dot" /> YOUR CITY, A LITTLE CLOSER</div>
          <h1>Find your<br /><span>people.</span></h1>
          <p>Good events make a city feel smaller.<br className="desktop-break" /> Find the ones that make it yours.</p>
          <a className="button button-white" href="#discover">Explore events <span>↓</span></a>
        </div>
        <div className="hero-aside">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-note"><span>01 / 04</span><strong>Make time<br />for something<br /><em>new.</em></strong><div className="note-line" /><small>LOCAL MOMENTS. REAL CONNECTION.</small></div>
          <div className="floating-tag"><span>✦</span> YOUR NEXT STORY STARTS HERE</div>
        </div>
        <div className="hero-bottom"><span>SCROLL TO FIND YOUR NEXT THING</span><span className="scroll-line" /></div>
      </section>

      <section className="discover section-wrap" id="discover">
        <div className="section-heading">
          <div><div className="eyebrow dark-eyebrow">A GOOD PLACE TO START</div><h2>Out there, <span>happening.</span></h2></div>
          <span className="event-count">{loading ? "…" : `${events.length.toString().padStart(2, "0")} EVENTS NEAR YOU`}</span>
        </div>
        <div className="search-bar">
          <span className="search-icon">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try “live music” or “a new skill”" aria-label="Search events" />
          {query && <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
        </div>
        <div className="category-row">
          {categories.map((item) => <button key={item} className={category === item ? "category-chip active" : "category-chip"} onClick={() => setCategory(item)}>{item !== "All events" && <span>{icons[item]}</span>}{item}</button>)}
        </div>

        {error ? <div className="state-card error-state">{error} <button className="text-button" onClick={() => setQuery(`${query} `)}>Try again</button></div>
          : loading ? <div className="state-card">Finding good things to do<span className="loading-dots"> ...</span></div>
            : events.length ? <>
              {featured && category === "All events" && !query.trim() && <FeaturedEvent event={featured} />}
              <div className="event-grid">
                {(category === "All events" && !query.trim() ? events.slice(1) : events).map((event, index) => <EventCard key={event.id} event={event} index={index} />)}
              </div>
            </> : <div className="state-card empty-state"><span>◌</span><strong>No plans found. Yet.</strong><p>Try a different search or category. Your next favorite thing might be just around the corner.</p><button className="button button-outline" onClick={() => { setQuery(""); setCategory("All events"); }}>Clear filters</button></div>}
      </section>
      <section className="host-cta">
        <div><div className="eyebrow">HAVE SOMETHING GOOD IN MIND?</div><h2>Your event.<br /><span>Your people.</span></h2><p>Bring your community together. We’ll take care of the details.</p></div>
        <Link to="/signup?role=organizer" className="button button-white">Start hosting <span>↗</span></Link>
        <div className="host-shape">✳</div>
      </section>
    </>
  );
}

function FeaturedEvent({ event }) {
  return (
    <Link className="featured-card" to={`/events/${event.id}`}>
      <div className="featured-art"><div className="art-sun" /><span className="art-number">FEATURED / 01</span><div className="art-copy"><span>{event.category.toUpperCase()} · {formatDate(event.date_time).weekday}</span><strong>{event.title}</strong></div><div className="art-stamp">EP<br /><span>✳</span></div></div>
      <div className="featured-info"><div><span className="card-kicker">THE ONE TO KNOW</span><h3>{event.title}</h3><p>{event.description}</p><div className="event-meta"><span>◷ &nbsp;{formatDate(event.date_time).full}</span><span>⌖ &nbsp;{event.venue}</span></div></div><div className="featured-availability"><span>{event.available} spots left</span><span className="round-arrow">↗</span></div></div>
    </Link>
  );
}

function EventCard({ event, index }) {
  const palette = ["card-lilac", "card-peach", "card-sage", "card-blue"];
  const date = formatDate(event.date_time);
  return (
    <Link className="event-card" to={`/events/${event.id}`}>
      <div className={`event-card-art ${palette[index % palette.length]}`}>
        <span className="event-card-category">{icons[event.category] || "✦"} &nbsp;{event.category}</span>
        <div className="card-art-shape">{["✳", "◌", "✦", "⌁"][index % 4]}</div>
        <span className="card-date"><strong>{date.day}</strong><span>{date.month}</span></span>
        <span className="card-arrow">↗</span>
      </div>
      <div className="event-card-body"><h3>{event.title}</h3><p>⌖ &nbsp;{event.venue}</p><div className="event-card-bottom"><span>◷ &nbsp;{date.time}</span><span>{event.available} spots left</span></div></div>
    </Link>
  );
}

function EventDetails() {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [tickets, setTickets] = useState(1);
  const [status, setStatus] = useState({ loading: true, error: "", notice: "" });
  useEffect(() => {
    request(`/events/${id}`).then(({ event: data }) => setEvent(data))
      .catch((error) => setStatus((s) => ({ ...s, error: error.message })))
      .finally(() => setStatus((s) => ({ ...s, loading: false })));
  }, [id]);

  async function reserve() {
    if (!auth.user) return navigate(`/login?next=/events/${id}`);
    if (auth.user.role !== "attendee") return setStatus((s) => ({ ...s, error: "Organizer accounts can't reserve tickets. Create an attendee account to join in." }));
    try {
      await request(`/events/${id}/registrations`, { method: "POST", token: auth.token, body: JSON.stringify({ ticket_count: tickets }) });
      setStatus((s) => ({ ...s, error: "", notice: "You're on the list! Your tickets are saved in My tickets." }));
      const { event: updated } = await request(`/events/${id}`);
      setEvent(updated);
    } catch (error) { setStatus((s) => ({ ...s, error: error.message })); }
  }

  if (status.loading) return <div className="page-state">Loading event...</div>;
  if (!event) return <div className="page-state">{status.error || "Event not found."}<Link to="/"> Back to events</Link></div>;
  const date = formatDate(event.date_time);
  return (
    <section className="detail-page section-wrap">
      <Link to="/" className="back-link">← &nbsp;All events</Link>
      <div className="detail-hero"><span>{event.category.toUpperCase()} &nbsp;·&nbsp; {date.weekday.toUpperCase()}</span><h1>{event.title}</h1><p>Hosted by {event.organizer_name}</p></div>
      <div className="detail-layout"><div className="detail-main"><div className="detail-cover"><div className="cover-orb" /><span>MAKE A MOMENT OF IT</span><strong>{icons[event.category] || "✦"}</strong></div><div className="detail-description"><h2>What it’s about</h2><p>{event.description}</p><div className="detail-facts"><div><span>WHEN</span><strong>{date.full}</strong></div><div><span>WHERE</span><strong>{event.venue}</strong></div><div><span>CAPACITY</span><strong>{event.reserved} going · {event.available} spots left</strong></div></div></div></div>
        <aside className="booking-card"><span className="card-kicker">SAVE YOUR SPOT</span><h3>Be part of it.</h3><p>Good things are better together. Bring a friend.</p><label htmlFor="ticket-count">Number of tickets</label><select id="ticket-count" value={tickets} onChange={(e) => setTickets(Number(e.target.value))}>{Array.from({ length: Math.min(10, event.available) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} {i === 0 ? "ticket" : "tickets"}</option>)}</select>{status.error && <p className="form-error">{status.error}</p>}{status.notice && <p className="form-success">{status.notice}</p>}<button className="button button-primary booking-button" onClick={reserve} disabled={!event.available}>{event.available ? "Reserve my spot" : "All spots are taken"} <span>↗</span></button><small>No payment needed. Just show up.</small></aside>
      </div>
    </section>
  );
}

function AuthPage({ mode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSignup = mode === "signup";
  const [form, setForm] = useState({ name: "", email: "", password: "", role: searchParams.get("role") === "organizer" ? "organizer" : "attendee" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const data = await request(`/auth/${isSignup ? "register" : "login"}`, { method: "POST", body: JSON.stringify(form) });
      auth.signIn(data);
      const next = searchParams.get("next");
      navigate(next?.startsWith("/") ? next : data.user.role === "organizer" ? "/dashboard" : "/");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="auth-page"><div className="auth-art"><span>GOOD THINGS<br />HAPPEN WHEN<br /><em>WE GET TOGETHER.</em></span><div className="auth-orbit" /><small>EVENTPULSE / YOUR CITY, CLOSER</small></div><div className="auth-panel"><div className="eyebrow dark-eyebrow">{isSignup ? "YOUR NEXT CHAPTER" : "WELCOME BACK"}</div><h1>{isSignup ? <>Come on <span>in.</span></> : <>Good to <span>see you.</span></>}</h1><p>{isSignup ? "Find your people, or bring them together." : "Your people are just around the corner."}</p><form onSubmit={submit} className="form-stack">
      {isSignup && <><label>Your name<input required minLength="2" maxLength="80" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="What should we call you?" /></label><label>I’m here to<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="attendee">Find events and join in</option><option value="organizer">Host events for my community</option></select></label></>}
      <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label>
      <label>Password<input required type="password" minLength={isSignup ? 8 : undefined} autoComplete={isSignup ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={isSignup ? "At least 8 characters" : "Your password"} /></label>
      {error && <div className="form-error">{error}</div>}<button className="button button-primary booking-button" disabled={busy}>{busy ? "One moment..." : isSignup ? "Create my account" : "Log in"} <span>↗</span></button>
    </form><div className="auth-switch">{isSignup ? "Already part of the community?" : "New around here?"} <Link to={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create an account"}</Link></div></div></div>
  );
}

function EventForm() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = Boolean(id);
  const [form, setForm] = useState({ title: "", category: "Community", description: "", date_time: "", venue: "", capacity: 40 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing || !auth?.token) return;
    request(`/events/${id}`).then(({ event }) => {
      const localDate = new Date(new Date(event.date_time).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setForm({ title: event.title, category: event.category, description: event.description, date_time: localDate, venue: event.venue, capacity: event.capacity });
    }).catch((err) => setError(err.message));
  }, [editing, id, auth?.token]);
  if (!auth.user) return <SignInNotice message="Sign in as an organizer to host an event." />;
  if (auth.user.role !== "organizer") return <SignInNotice message="Event creation is available to organizer accounts." />;
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const { event } = await request(editing ? `/events/${id}` : "/events", { method: editing ? "PATCH" : "POST", token: auth.token, body: JSON.stringify({ ...form, capacity: Number(form.capacity), date_time: new Date(form.date_time).toISOString() }) });
      navigate(editing ? "/dashboard" : `/events/${event.id}`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="form-page section-wrap"><Link to="/dashboard" className="back-link">← &nbsp;Your dashboard</Link><div className="eyebrow dark-eyebrow">{editing ? "MAKE A FEW CHANGES" : "MAKE SOMETHING HAPPEN"}</div><h1>{editing ? <>Make it <span>just right.</span></> : <>Bring your<br /><span>people together.</span></>}</h1><p className="page-intro">{editing ? "Update the details so everyone knows what to expect." : "Tell the neighborhood what you have planned. The good stuff starts here."}</p><form onSubmit={submit} className="event-form form-stack"><label>Event name<input required maxLength="120" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Give your event a name" /></label><div className="form-row"><label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><label>Maximum guests<input type="number" min="1" max="10000" required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label></div><label>When<input type="datetime-local" required min={localDateTimeMin()} value={form.date_time} onChange={(e) => setForm({ ...form, date_time: e.target.value })} /></label><label>Where<input required maxLength="120" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Venue, neighborhood, or address" /></label><label>Tell us about it<textarea required maxLength="3000" rows="5" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What should people know before they come?" /></label>{error && <div className="form-error">{error}</div>}<button className="button button-primary booking-button" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Publish event"} <span>↗</span></button></form></section>;
}

function Dashboard() {
  const auth = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => request("/events").then(({ events: rows }) => setEvents(rows.filter((event) => event.organizer_id === auth?.user?.id))).catch((err) => setError(err.message));
  useEffect(() => { if (auth?.user?.role === "organizer") load(); }, [auth?.token]);
  if (!auth.user) return <SignInNotice message="Sign in as an organizer to manage your events." />;
  if (auth.user.role !== "organizer") return <SignInNotice message="The dashboard is available to organizer accounts." />;
  async function cancelEvent(event) {
    if (!window.confirm(`Cancel “${event.title}”? Existing reservations will also be canceled.`)) return;
    try { await request(`/events/${event.id}`, { method: "DELETE", token: auth.token }); setEvents((rows) => rows.filter((item) => item.id !== event.id)); }
    catch (err) { setError(err.message); }
  }
  async function loadRoster(event) {
    setBusy(true); setError("");
    try { const { registrations } = await request(`/organizer/events/${event.id}/registrations`, { token: auth.token }); setRoster({ event, registrations }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="dashboard-page section-wrap"><div className="dashboard-top"><div><div className="eyebrow dark-eyebrow">YOUR LITTLE CORNER OF THE CITY</div><h1>Good things<br /><span>you started.</span></h1></div><Link to="/create" className="button button-primary">+ Host an event</Link></div><div className="dashboard-summary"><div><strong>{events.length}</strong><span>UPCOMING EVENTS</span></div><div><strong>{events.reduce((sum, event) => sum + event.reserved, 0)}</strong><span>GUESTS REGISTERED</span></div><div><strong>{events.reduce((sum, event) => sum + event.available, 0)}</strong><span>SPOTS STILL OPEN</span></div></div>{error && <div className="form-error">{error}</div>}{events.length ? <div className="dashboard-list">{events.map((event) => <article className="dashboard-event" key={event.id}><div className="dash-date"><strong>{formatDate(event.date_time).day}</strong><span>{formatDate(event.date_time).month}</span></div><div className="dash-info"><span>{event.category.toUpperCase()} · {formatDate(event.date_time).full}</span><h3>{event.title}</h3><p>{event.venue}</p></div><div className="dash-capacity"><strong>{event.reserved}/{event.capacity}</strong><span>GUESTS</span></div><Link className="button button-outline button-small" to={`/events/${event.id}/edit`}>Edit</Link><button className="button button-outline button-small" onClick={() => loadRoster(event)} disabled={busy}>Guest list</button><button className="icon-button danger" onClick={() => cancelEvent(event)} aria-label={`Cancel ${event.title}`}>×</button></article>)}</div> : <div className="state-card empty-state"><strong>Your first event is waiting.</strong><p>Start a gathering and find your people.</p><Link className="button button-primary" to="/create">Create an event ↗</Link></div>}{roster && <div className="modal-backdrop" onClick={() => setRoster(null)}><div className="roster-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setRoster(null)}>×</button><div className="eyebrow dark-eyebrow">THE PEOPLE COMING ALONG</div><h2>{roster.event.title}</h2><p>{roster.registrations.length} reservations · {roster.registrations.reduce((n, item) => n + item.ticket_count, 0)} tickets</p>{roster.registrations.length ? <div className="guest-list">{roster.registrations.map((guest) => <div key={guest.id}><span className="guest-avatar">{guest.name.slice(0, 1).toUpperCase()}</span><span><strong>{guest.name}</strong><small>{guest.email}</small></span><b>× {guest.ticket_count}</b></div>)}</div> : <div className="state-card">No one has signed up yet. Spread the word!</div>}</div></div>}</section>;
}

function MyTickets() {
  const auth = useAuth();
  const [registrations, setRegistrations] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => { if (auth?.user?.role === "attendee") request("/me/registrations", { token: auth.token }).then(({ registrations: rows }) => setRegistrations(rows)).catch((err) => setError(err.message)); }, [auth?.token]);
  if (!auth.user) return <SignInNotice message="Sign in to find your tickets." />;
  if (auth.user.role !== "attendee") return <SignInNotice message="Tickets are available to attendee accounts." />;
  return <section className="dashboard-page section-wrap"><div className="eyebrow dark-eyebrow">YOU’RE ON THE LIST</div><h1>Your upcoming<br /><span>good times.</span></h1><p className="page-intro">Every reservation, all in one place.</p>{error && <div className="form-error">{error}</div>}{registrations.length ? <div className="ticket-grid">{registrations.map((item) => <Link className="ticket-card" to={`/events/${item.event_id}`} key={item.id}><div className="ticket-top"><span>{item.category.toUpperCase()}</span><span>{formatDate(item.date_time).weekday.toUpperCase()}</span></div><h3>{item.title}</h3><p>◷ &nbsp;{formatDate(item.date_time).full}</p><p>⌖ &nbsp;{item.venue}</p><div className="ticket-bottom"><span>{item.ticket_count} {item.ticket_count === 1 ? "ticket" : "tickets"}</span><span>VIEW EVENT ↗</span></div></Link>)}</div> : <div className="state-card empty-state"><strong>Nothing on the calendar. Yet.</strong><p>Your next favorite memory is out there.</p><Link to="/" className="button button-primary">Find an event ↗</Link></div>}</section>;
}

function SignInNotice({ message }) { return <div className="page-state"><h2>{message}</h2><Link to="/login" className="button button-primary">Log in ↗</Link></div>; }
function NotFound() { return <div className="page-state"><h2>Looks like this plan fell through.</h2><Link to="/" className="button button-primary">Explore events ↗</Link></div>; }

function formatDate(value) {
  const date = new Date(value);
  return {
    day: date.toLocaleDateString("en-US", { day: "2-digit" }),
    month: date.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    full: date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  };
}
function localDateTimeMin() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

export default App;

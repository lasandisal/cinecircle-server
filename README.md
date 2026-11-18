# CineCircle Backend API (`cinecircle-be`)

> Robust, real-time REST and WebSocket API powering **CineCircle** — A Social Watch-Decision & Review Platform for TV & Film.

---

## 1. System Overview

CineCircle solves "streaming paralysis" through intelligent solo recommendation algorithms and real-time multiplayer group watch sessions. The backend is built with **Node.js, Express, and TypeScript**, leveraging **PostgreSQL with Prisma ORM** for persistent relational data, **Socket.IO** for low-latency voting rooms, **Google Gemini AI** for automated consensus pitches, and **Brevo SMTP** for transactional email verification.

```mermaid
flowchart TD
    Client["CineCircle Web Client (React 19)"]
    
    subgraph Backend ["CineCircle Server (Express + TypeScript)"]
        Router["Express REST Router (/api/*)"]
        AuthMid["JWT & RBAC Middleware"]
        Controllers["Controllers (Auth, Titles, Sessions, Users, AI)"]
        Services["Core Services (Recommendation, Socket, TMDB, Email, AI)"]
        PrismaClient["Prisma Client ORM"]
        SocketServer["Socket.IO Server (Live Decision Rooms)"]
    end
    
    subgraph Data ["Databases & External APIs"]
        Postgres[("PostgreSQL Database (Supabase / Pooler)")]
        TMDB["TMDB API (Movies & TV Metadata)"]
        Gemini["Google Gemini AI (Compromise Moderation)"]
        Brevo["Brevo SMTP (Transactional OTP Emails)"]
    end

    Client <-->|"REST HTTP & JSON"| Router
    Client <-->|"WebSockets"| SocketServer
    Router --> AuthMid --> Controllers
    Controllers --> Services
    Services --> PrismaClient --> Postgres
    Services --> TMDB
    Services --> Gemini
    Services --> Brevo
    SocketServer <--> Services
```

---

## 2. Core Features & Workflows

### 2.1 Authentication & Email Verification
- **Dual Login Modes**:
  1. Standard **Email + Password** (salted bcrypt hashing).
  2. Passwordless **Email OTP** (6-digit one-time code generated and delivered via Brevo SMTP).
- **Token Authorization**: Stateless JWT with 7-day expiry and role-based access control (`user`, `curator`, `admin`). The token is delivered in an **HttpOnly, Secure, SameSite cookie**, so page scripts cannot read it; a Bearer header is still accepted for non-browser clients.
- **OTP Hardening**: 6-digit codes are bcrypt-hashed, expire after `OTP_TTL_MINUTES` (default 10), are capped at 5 failed attempts, are rate-limited per IP, and enforce a 30s resend cooldown.
- **API Hardening**: Helmet security headers, tiered per-IP rate limits (global API, auth, OTP send/verify, and write budgets) shared across instances through **Upstash Redis** (atomic `INCR`+`PEXPIRE` Lua script, with an automatic in-memory fallback if Redis is unreachable), Origin checks on mutating requests (CSRF defence), Zod request-body validation, and magic-byte image validation for uploads. See [section 4](#4-security--reliability-architecture) for the full threat model.
- **Onboarding Pipeline**: New members configure a CineTaste Matrix (favorite genres, seed titles, owned streaming passes).

### 2.2 Solo Decision Engine & Fatigue Detection
- **Fatigue Counter**: Tracks consecutive "skipped" or decision attempts; upon detecting decision paralysis, applies aggressive filtering to deliver a 3-title high-confidence shortlist.
- **Multi-Vector Scoring**:
  - Contextual constraints (max runtime minutes, current mood like *Gripping*, *Mind-Bending*, *Comfort*, *Stunning*).
  - Streaming platform filters (Netflix, Prime, Disney+, Apple TV+, etc.).
  - Taste profile genre affinities with recency decay.
  - Live TMDB discover API fallback if local database entries are exhausted.

### 2.3 Real-Time Group Decision Rooms
- **Room Lifecycle**: Host creates a session with custom runtime/mood constraints; receives a unique 6-character room code (e.g., `SCI890`).
- **WebSockets via Socket.IO**:
  - Real-time room joining and attendee presence tracking.
  - Dynamic candidate shortlist additions from the TMDB catalogue.
  - Live reaction voting: Yes/No reactions with configurable intensity (strength 1–5).
  - Room broadcast events for real-time progress bars across all participant screens.
- **Weighted Compromise Algorithm**: Calculates a fairness score balancing unanimous approval against individual vetoes.

### 2.4 Gemini AI Consensus Moderator
- Integrates **Google Generative AI (`gemini-3.5-flash-lite`)**.
- When a group session finishes, Gemini analyzes the winner synopsis and individual member votes to write a witty, charismatic compromise pitch acknowledging diverse tastes and encouraging the room to press play.
- Graceful template fallback if external API limits are reached.

### 2.5 Social Graph & Compatibility Engine
- **Taste Compatibility**: Mathematical formula comparing overlapping genre scores and mutual watchlist titles between two members (returns `0-100% match`).
- **Social Feed**: Aggregates reviews, ratings, and active circles from followed members and community trends.
- **Followers & Connections**: Bidirectional connection requests and unidirectional follows with real-time counters.
- **Instagram-Style Feed Interactions**:
  - **Like Toggle**: Users can like/unlike comments; each like is recorded per user (prevents double-liking).
  - **Likers List**: Click like count to see who liked a comment (returns user profiles).
  - **Replies List**: Click comment count to see replies to a comment.
  - **Member Search**: Search users by name, email, or handle with compatibility scoring.
  - **Member Profiles**: Instagram-style profile pages showing watched/reviewed titles, connections, and mutual titles.

### 2.6 Enthusiast Layer & Soundtrack Hub
- Comprehensive title profiles with cast mappings, episode guides, and streaming provider badges.
- Curated soundtrack listings with Spotify preview links and scene references.
- Spoiler-protected community discussion threads with nested replies and moderation flag reporting.

---

## 3. Technology Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v18+) | Server-side JavaScript runtime |
| **Framework** | Express.js 4.x | Fast, unopinionated REST API server |
| **Language** | TypeScript 5.x | Static typing, interface contracts, and maintainability |
| **Database** | PostgreSQL 15+ | Relational data integrity, foreign keys, cascade deletes, array types |
| **ORM** | Prisma ORM 6.x | Type-safe query builder, schema modeling, and migrations |
| **Real-Time** | Socket.IO 4.x | Duplex WebSocket connection for watch party rooms |
| **Artificial Intelligence** | `@google/generative-ai` | Gemini Flash for witty group compromise pitches |
| **Email Service** | Nodemailer + Brevo SMTP | Reliable delivery of 6-digit registration & login OTP codes |
| **Authentication** | JWT (`jsonwebtoken`) + `bcryptjs` | HttpOnly session cookies (Bearer fallback) and secure password/OTP hashing |
| **Rate Limiting** | `express-rate-limit` + Upstash Redis | Tiered per-IP budgets with a shared distributed counter and in-memory fallback |
| **HTTP Security** | `helmet` + `cors` + Zod | Security headers, origin allow-listing, and schema-validated request bodies |
| **External APIs** | Axios | TMDB (The Movie Database) for live films, shows, and streaming data |
| **Dev Tooling** | `tsx` & `typescript` | Instant TypeScript execution with hot-reloading in development |

---

## 4. Security & Reliability Architecture

### 4.1 Multi-Tiered, Distributed Rate Limiting

**Implementation:** `src/middleware/rateLimit.middleware.ts` + `src/services/rateLimitStore.ts`
**Mount points:** `app.ts` (global), `auth.routes.ts`, `title.routes.ts`, `user.routes.ts`

CineCircle runs as a serverless deployment, which means several isolated instances can serve the same client within seconds. A per-process counter would therefore be multiplied by the number of warm instances, turning a 20-request auth limit into "20 × N". The limiter is consequently built around a **dual-layer `ResilientStore`**:

```mermaid
flowchart LR
    Req["Incoming request"] --> L["express-rate-limit"]
    L --> R{"Redis reachable?"}
    R -->|"Yes"| Redis[("Upstash Redis<br/>shared counter + TTL")]
    R -->|"No / timeout"| Mem["In-process MemoryStore<br/>(per-instance fallback)"]
    Redis -.->|"network error"| Mem
    Redis --> Ok["429 or pass"]
    Mem --> Ok
```

- **Primary — Upstash Redis:** one shared counter for the entire deployment. `INCR` and `PEXPIRE` execute inside a single Lua script, so the counter and its expiry are atomic; a crash between two commands can never leave a key without a TTL that would block a client permanently.
- **Fallback — `MemoryStore`:** if Redis is unconfigured or throws, counting continues locally instead of failing the request. The Redis path is then paused for a **30-second cooldown** (`REDIS_RETRY_COOLDOWN_MS`) so an outage does not add a network timeout to every request.
- **Isolation:** every limiter receives its own store instance and `rl:<name>:` key prefix. A client hitting the strict auth budget cannot consume the broad API budget, and `express-rate-limit` never sees a store shared between limiters.

**Tiered budgets:**

| Limiter | Window | Limit | Where it is applied | Threat addressed |
| :--- | :--- | :--- | :--- | :--- |
| `apiLimiter` | 15 min | 600 / IP | All of `/api` | Broad DoS, scraping |
| `authLimiter` | 15 min | 20 / IP | `POST /auth/login`, `POST /auth/register` | Brute force, credential stuffing |
| `otpSendLimiter` | 15 min | 5 / IP | `POST /auth/send-otp` | Mailbox spam, Brevo credit depletion |
| `otpVerifyLimiter` | 15 min | 10 / IP | `POST /auth/verify-otp` | Guessing a 6-digit code |
| `writeLimiter` | 10 min | 60 / IP | Comments, likes, reactions, poll votes, reports, avatar upload | Bot flooding of social writes |

Exceeded budgets return `429` with a JSON error body and standard `RateLimit-*` (draft-7) headers.

**Proxy awareness:** `app.set('trust proxy', 1)` instructs Express to take the client IP from Vercel's `X-Forwarded-For`, so users behind a shared CDN/proxy are not lumped together and one client cannot exhaust the quota for everyone.

### 4.2 Session & Credential Hardening

- **HttpOnly cookie transport:** the JWT is set as `HttpOnly`, `Secure`, `SameSite` (`None; Partitioned` in production, `Lax` locally) with `Path=/`. Page scripts cannot read it, eliminating the usual XSS token-theft path. A `Bearer` header is still accepted for non-browser clients.
- **Password hashing:** `bcryptjs` with 10 salt rounds.
- **OTP hashing:** 6-digit codes are bcrypt-hashed before storage. Plain codes exist only in the outgoing email, so a database leak does not expose live verification codes.
- **OTP lifecycle:** TTL of `OTP_TTL_MINUTES` (default 10), a 5-failure attempt cap, a 30-second resend cooldown, and per-IP send/verify rate limits.
- **Cookie clearing parity:** `setAuthCookie` and `clearAuthCookie` share one `baseCookieOptions()` helper. Clearing a cookie only works when path/domain/secure/sameSite attributes match exactly; centralising them prevents a "logout that silently does nothing".
- **Short-lived socket credentials:** `GET /api/auth/socket-token` issues a separate 2-hour JWT with `scope: 'socket'`, fetched over same-origin REST. It is held in memory only and presented in the Socket.IO handshake, so the long-lived session cookie never has to be exposed to the WebSocket layer.

### 4.3 Upload & Input Validation

- **Memory-only uploads:** avatars use `multer.memoryStorage()` and are never written to server disk; limits are 5 MB, 1 file, 5 fields.
- **Magic-byte inspection:** `utils/image.ts` checks the actual leading bytes of the buffer against JPEG (`FF D8 FF`), PNG (8-byte signature), GIF (`GIF87a` / `GIF89a`), and WebP (`RIFF` … `WEBP`) signatures. The client-supplied MIME type and filename are ignored, so renaming a script to `.png` does not pass.
- **Schema validation:** every request body is parsed through a Zod schema (`validateBody`) before a controller runs, and Prisma parameterises all queries.
- **Pagination clamping:** list endpoints parse `page`/`limit` defensively and cap the page size (see section 5).

### 4.4 Authorization (RBAC)

| Middleware | Behaviour |
| :--- | :--- |
| `authenticate` | Requires a valid session; returns `401` when unauthenticated. |
| `optionalAuthenticate` | Allows guests but attaches the user when a valid session exists, enabling personalised public pages. |
| `authorize('admin')` | Restricts curator routes to the `admin` role; an authenticated non-admin receives `403`. |

Resource-level checks live in the services. For example, `SessionService.finalize` compares `session.creatorId` with `req.user.id` and rejects every non-host with `403` — authentication answers *who you are*, authorization answers *whether this room is yours*.

### 4.5 HTTP Hardening

- **Helmet:** CSP, HSTS, `X-Frame-Options`/frame-ancestors, COOP, and related headers, with `crossOriginResourcePolicy: cross-origin` so posters and avatars can render in the client.
- **Strict CORS:** a whitelist (`config/cors.ts`) with `credentials: true`; unknown origins are rejected rather than reflected.
- **CSRF defence:** `requireTrustedOrigin` validates the `Origin` of mutating requests, which complements `SameSite` cookies.
- **Central error handler:** normalises failures and avoids leaking stack traces in production.

---

## 5. Pagination & Query Safety

All list endpoints use database-level offset paging rather than loading a table and slicing it in memory:

```ts
const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
const skip = (pageNum - 1) * limitNum;
// prisma.findMany({ skip, take: limitNum, ... })
```

- `take` is clamped to **50**, so `?limit=100000` cannot force the server to materialise the catalogue.
- `skip`/`take` push the work into PostgreSQL, keeping memory flat as the dataset grows.
- Endpoints return paging metadata (`page`, `limit`, `totalPages` / `hasMore`) so the client can drive infinite scroll.
- Applied in `getFeedActivity`, `getTitles`, `getCommentLikers`, and `getCommentReplies` (`title.controller.ts`).

---

## 6. Database Schema (Prisma ORM)

The relational schema is configured in `prisma/schema.prisma` with **16 interconnected models**:

```mermaid
erDiagram
    User ||--o{ Session : "creates"
    User ||--o{ Vote : "casts"
    User ||--o{ Watchlist : "tracks"
    User ||--o{ WatchHistory : "logs"
    User ||--o{ Comment : "authors"
    User ||--o{ TasteProfile : "has"
    User ||--o{ Otp : "receives"
    User ||--o{ Like : "likes"
    
    Session ||--o{ Vote : "contains"
    Session }o--o{ User : "participants"
    
    Title ||--o{ Vote : "target"
    Title ||--o{ Watchlist : "saved_in"
    Title ||--o{ WatchProvider : "streamed_on"
    Title ||--o{ SeasonEpisode : "contains"
    Title ||--o{ Soundtrack : "features"
    Title ||--o{ Comment : "discussed_in"
    
    Comment ||--o{ Like : "liked_by"
    Comment }o--o{ Comment : "replies_to"
```

### Models Overview

1. **`User`**: Account identity, hashed credentials, role (`user` | `curator` | `admin`), avatar, bio, subscribed streaming services, fatigue count, and onboarding status.
2. **`Title`**: Movies and TV shows synchronized from TMDB with synopsis, runtime, release year, genres (`TEXT[]`), mood tags (`TEXT[]`), and cast JSON.
3. **`Session`**: Group decision watch rooms with join code, constraints (mood, runtime), shortlist title IDs, status (`open` | `closed`), and winner title ID.
4. **`Vote`**: Weighted reaction cast by a participant (`yes` / `no`, strength `1-5`).
5. **`Watchlist`**: Saved titles, watched status flag, and user star rating (1–10).
6. **`WatchHistory`**: Historical user interaction logs (watched, rated, skipped, picked).
7. **`TasteProfile`**: Recency-weighted per-genre scores and favorite seed titles.
8. **`Comment`**: Community discussion posts supporting spoilers, star ratings, emoji reactions, embedded polls, and nested replies.
9. **`Like`**: Individual user like on a comment (prevents double-liking via `@@unique([userId, commentId])`).
10. **`Soundtrack`**: Curated scene-by-scene soundtracks with Spotify and preview URLs.
11. **`SeasonEpisode`**: Breakdown of TV seasons, episode summaries, and air dates.
12. **`WatchProvider`**: Streaming provider regional availability (Netflix, Prime Video, etc.).
13. **`ConnectionRequest`**: Friend/social invitations with status tracking (`pending`, `accepted`).
14. **`Otp`**: Time-limited verification codes for secure passwordless authentication.
15. **`Notification`**: Social alerts for mentions, comments, and room invites.
16. **`SessionInvitation`**: Direct watch room invitations dispatched to friends.

---

## 7. API Reference

All routes are prefixed with `/api`.

### 7.1 Health & Meta
- `GET /api/health` — Service status check.

### 7.2 Authentication (`/api/auth`)
- `POST /api/auth/send-otp` — Request a 6-digit email verification code (`register` or `login` flow).
- `POST /api/auth/verify-otp` — Verify a 6-digit code and exchange it for a session.
- `POST /api/auth/register` — Create an account with email, name, password, and OTP code.
- `POST /api/auth/login` — Sign in with email + password OR email + OTP.
- `POST /api/auth/logout` — Clear the HttpOnly session cookie.
- `GET /api/auth/me` — Retrieve the current authenticated user profile.
- `GET /api/auth/socket-token` — Issue a short-lived (2 h) `scope: 'socket'` JWT for the Socket.IO handshake.
- `POST /api/auth/refresh` — Re-issue the session cookie for an authenticated user.

### 7.3 Titles (`/api/titles`)
- `GET /api/titles/browse` — Paginated catalogue search & genre/mood filtering.
- `GET /api/titles/trending` — Trending titles combining TMDB live data and catalogue entries.
- `GET /api/titles/:id` — Full title details including cast, providers, soundtracks, and episodes.
- `POST /api/titles/:id/comments` — Post review/comment with spoiler tag.
- `POST /api/titles/:id/comments/:commentId/reaction` — React with emoji (🔥, 🍿, ❤️, etc.).
- `POST /api/titles/:id/comments/:commentId/poll/vote` — Vote on a comment poll.
- `POST /api/titles/comments/:commentId/like` — Toggle like on a comment (like/unlike).
- `GET /api/titles/comments/:commentId/likers` — Get users who liked a comment.
- `GET /api/titles/comments/:commentId/replies` — Get replies to a comment.

### 7.4 Recommendations (`/api/recommendations`)
- `POST /api/recommendations/solo` — Generate high-confidence shortlist based on time, mood, and streaming passes.
- `POST /api/recommendations/feedback` — Record user action (`watched`, `skipped`, `picked`) to adjust fatigue counters.

### 7.5 Group Sessions (`/api/sessions`)
- `POST /api/sessions` — Create a new watch room with constraints (returns 6-char `joinCode`).
- `GET /api/sessions/:joinCode` — Fetch room details, participant roster, and shortlisted titles.
- `POST /api/sessions/join` — Join room by code.
- `POST /api/sessions/:sessionId/shortlist` — Add a candidate title to the room shortlist.
- `DELETE /api/sessions/:sessionId/shortlist/:titleId` — Host removes a title candidate.
- `POST /api/sessions/:sessionId/vote` — Submit a weighted vote on a candidate title.
- `POST /api/sessions/:sessionId/finalize` — Close voting, trigger compromise algorithm, and generate Gemini AI pitch.

### 7.6 Watchlist & Social (`/api/watchlist`, `/api/users`)
- `GET /api/watchlist` — Retrieve authenticated user's watchlist with filtering.
- `POST /api/watchlist` — Add title to watchlist or update rating.
- `DELETE /api/watchlist/:id` — Remove item from watchlist.
- `GET /api/users/search?q=...` — Search community members by name, email, or handle. Each result also carries the viewer-relative `connectionStatus` (`none`, `pending_sent`, `pending_received`, `accepted`) and `connectionRequestId`, so the directory can render Connect, Accept, Pending, or Disconnect without a request per row.
- `GET /api/users/:userId/profile` — View user profile, badges, and mutual-watched compatibility.
- `POST /api/users/:userId/follow` — Follow or unfollow a community member.
- `GET /api/users/:userId/connections` — Fetch user's social connection graph.
- `POST /api/users/connections/request` — Send a connection request to another member.
- `POST /api/users/connections/respond` — Accept or reject a pending request; the sender receives a stored notification of the decision.
- `DELETE /api/users/connections/:targetUserId` — Remove an accepted connection. Only one of the two connected members can remove it, and the other member receives a notification.

### 7.7 Curator & Admin (`/api/curator`)
- `POST /api/curator/sync-tmdb` — Synchronize catalog with TMDB popular titles.
- `POST /api/curator/soundtracks` — Seed and manage soundtracks for titles.
- `GET /api/curator/reports` — View reported spoiler / abuse comments for moderation.

---

## 8. Real-Time Socket Events

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `session:join` | Client ➔ Server | `{ sessionId, userId }` | Join room socket channel |
| `session:leave` | Client ➔ Server | `{ sessionId, userId }` | Leave room socket channel |
| `session:vote` | Client ➔ Server | `{ sessionId, titleId, reaction, strength }` | Cast a reaction vote |
| `session:user_joined` | Server ➔ Room | `{ userId, participantCount }` | Broadcast attendee arrival |
| `session:vote_updated`| Server ➔ Room | `{ titleId, totalScore, votes }` | Live progress bar update |
| `session:finalized` | Server ➔ Room | `{ winner, aiPitch, scores }` | Live winner reveal broadcast |

---

## 9. Setup & Installation

### 9.1 Prerequisites
- **Node.js** v18.0.0 or higher
- **PostgreSQL** (local instance or managed cloud provider such as Supabase / Neon)
- **TMDB API Key** (from [The Movie Database](https://www.themoviedb.org/))
- **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/))
- **Brevo SMTP credentials** (or any standard SMTP service for transactional OTP emails)

### 9.2 Installation Steps

1. Navigate to the backend directory:
   ```bash
   cd cinecircle-be
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your real credentials:
   ```env
   PORT=5000
   NODE_ENV=development
   DATABASE_URL="postgresql://postgres:password@localhost:5432/cinecircle?schema=public"
   JWT_SECRET="generate_a_random_secure_secret_key"
   JWT_EXPIRES_IN=7d
   AUTH_COOKIE_NAME=cinecircle_token
   OTP_TTL_MINUTES=10
   CLIENT_URL="http://localhost:5173"
   ALLOWED_ORIGINS=""
   SUPABASE_URL="https://your-project-ref.supabase.co"
   SUPABASE_SECRET_KEY="your_supabase_secret_key"
   SUPABASE_STORAGE_BUCKET=cinecircle-images
   # Optional: shared rate-limit counters (recommended on Vercel)
   UPSTASH_REDIS_REST_URL=""
   UPSTASH_REDIS_REST_TOKEN=""
   TMDB_API_KEY="your_tmdb_api_key"
   TMDB_ACCESS_TOKEN="your_tmdb_access_token"
   GEMINI_API_KEY="your_gemini_api_key"
   GEMINI_REQUEST_TIMEOUT_MS=15000
   GEMINI_EVAL_TIMEOUT_MS=20000
   GEMINI_MODEL=gemini-3.5-flash-lite
   BREVO_SMTP_KEY="your_brevo_smtp_api_key"
   BREVO_SMTP_LOGIN="your_brevo_login"
   BREVO_SMTP_PORT=587
   BREVO_SENDER_EMAIL="noreply@cinecircle.com"
   BREVO_SENDER_NAME="CineCircle"
   ```

4. Run Database Migrations:
   ```bash
   npx prisma migrate dev --name init
   ```

5. Generate Prisma Client:
   ```bash
   npx prisma generate
   ```

6. Start Development Server:
   ```bash
   npm run dev
   ```
   The server will start on `http://localhost:5000` (Health check at `http://localhost:5000/api/health`).

7. Build for Production:
   ```bash
   npm run build
   npm start
   ```

---

## 10. Project Structure

```text
cinecircle-be/
├── prisma/
│   ├── schema.prisma        # Prisma relational schema (PostgreSQL)
│   └── migrations/          # Version-controlled SQL migration files
├── src/
│   ├── config/              # Prisma client singleton and ENV assertions
│   │   ├── env.ts
│   │   └── prisma.ts
│   ├── controllers/         # Request handling & HTTP response mapping
│   │   ├── auth.controller.ts
│   │   ├── session.controller.ts
│   │   ├── title.controller.ts
│   │   ├── user.controller.ts
│   │   └── watchlist.controller.ts
│   ├── middleware/          # Security, JWT auth, rate limiting, and error handling
│   │   ├── auth.middleware.ts
│   │   ├── rateLimit.middleware.ts  # Tiered limiters + ResilientStore
│   │   ├── origin.middleware.ts     # Trusted-origin (CSRF) checks
│   │   ├── validate.middleware.ts   # Zod request-body validation
│   │   └── error.middleware.ts
│   ├── routes/              # Modular Express routing endpoints
│   │   ├── auth.routes.ts
│   │   ├── index.ts
│   │   ├── session.routes.ts
│   │   ├── title.routes.ts
│   │   ├── user.routes.ts
│   │   └── watchlist.routes.ts
│   ├── services/            # Core business logic & external integrations
│   │   ├── ai.service.ts              # Google Gemini compromise pitches
│   │   ├── EmailService.ts            # Brevo SMTP OTP delivery
│   │   ├── rateLimitStore.ts          # Upstash Redis counter (atomic Lua)
│   │   ├── recommendation.service.ts  # Solo recommendation algorithm
│   │   ├── session.service.ts         # Weighted group decision scoring
│   │   ├── socket.service.ts          # Socket.IO room lifecycle & events
│   │   └── TmdbService.ts             # TMDB catalog fetching
│   ├── types/               # TypeScript interfaces and shared types
│   ├── utils/               # AppError, cookie attributes, and image checks
│   │   ├── authCookie.ts              # HttpOnly cookie set/clear parity
│   │   └── image.ts                   # Magic-byte image validation
│   ├── app.ts               # Express middleware & route composition
│   └── server.ts            # HTTP bootstrap, Socket.IO & DB connector
├── .env.example             # Template environment variables
├── package.json
└── tsconfig.json
```
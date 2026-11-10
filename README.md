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

    Client <-->|REST HTTP / JSON| Router
    Client <-->|WebSockets (ws://)| SocketServer
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
- **Token Authorization**: Stateless JWT (JSON Web Tokens) with 7-day expiry and role-based access control (`user`, `curator`, `admin`).
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
- Integrates **Google Generative AI (`gemini-flash-latest`)**.
- When a group session finishes, Gemini analyzes the winner synopsis and individual member votes to write a witty, charismatic compromise pitch acknowledging diverse tastes and encouraging the room to press play.
- Graceful template fallback if external API limits are reached.

### 2.5 Social Graph & Compatibility Engine
- **Taste Compatibility**: Mathematical formula comparing overlapping genre scores and mutual watchlist titles between two members (returns `0-100% match`).
- **Social Feed**: Aggregates reviews, ratings, and active circles from followed members and community trends.
- **Followers & Connections**: Bidirectional connection requests and unidirectional follows with real-time counters.

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
| **Authentication** | JWT (`jsonwebtoken`) + `bcryptjs` | Stateless session bearer tokens and secure password hashing |
| **External APIs** | Axios | TMDB (The Movie Database) for live films, shows, and streaming data |
| **Dev Tooling** | `tsx` & `typescript` | Instant TypeScript execution with hot-reloading in development |

---

## 4. Database Schema (Prisma ORM)

The relational schema is configured in `prisma/schema.prisma` with 15 interconnected models:

```mermaid
erDiagram
    User ||--o{ Session : "creates"
    User ||--o{ Vote : "casts"
    User ||--o{ Watchlist : "tracks"
    User ||--o{ WatchHistory : "logs"
    User ||--o{ Comment : "authors"
    User ||--o{ TasteProfile : "has"
    User ||--o{ Otp : "receives"
    
    Session ||--o{ Vote : "contains"
    Session }o--o{ User : "participants"
    
    Title ||--o{ Vote : "target"
    Title ||--o{ Watchlist : "saved_in"
    Title ||--o{ WatchProvider : "streamed_on"
    Title ||--o{ SeasonEpisode : "contains"
    Title ||--o{ Soundtrack : "features"
    Title ||--o{ Comment : "discussed_in"
```

### Models Overview
1. **`User`**: Account identity, hashed credentials, role (`user` | `curator` | `admin`), avatar, bio, subscribed streaming services, fatigue count, and onboarding status.
2. **`Title`**: Movies and TV shows synchronized from TMDB with synopsis, runtime, release year, genres (`TEXT[]`), mood tags (`TEXT[]`), and cast JSON.
3. **`Session`**: Group decision watch rooms with join code, constraints (mood, runtime), shortlist title IDs, status (`open` | `closed`), and winner title ID.
4. **`Vote`**: Weighted reaction cast by a participant (`yes` / `no`, strength `1-5`).
5. **`Watchlist`**: Saved titles, watched status flag, and user star rating (1–10).
6. **`WatchHistory`**: Historical user interaction logs (watched, rated, skipped, picked).
7. **`TasteProfile`**: Recency-weighted per-genre scores and favorite seed titles.
8. **`Comment`**: Community discussion posts supporting spoilers, star ratings, and emoji reactions.
9. **`Soundtrack`**: Curated scene-by-scene soundtracks with Spotify and preview URLs.
10. **`SeasonEpisode`**: Breakdown of TV seasons, episode summaries, and air dates.
11. **`WatchProvider`**: Streaming provider regional availability (Netflix, Prime Video, etc.).
12. **`ConnectionRequest`**: Friend/social invitations with status tracking (`pending`, `accepted`).
13. **`Otp`**: Time-limited verification codes for secure passwordless authentication.
14. **`Notification`**: Social alerts for mentions, comments, and room invites.
15. **`SessionInvitation`**: Direct watch room invitations dispatched to friends.

---

## 5. API Reference

All routes are prefixed with `/api`.

### 5.1 Health & Meta
- `GET /api/health` — Service status check.

### 5.2 Authentication (`/api/auth`)
- `POST /api/auth/register` — Create account with email, name, password, and OTP code.
- `POST /api/auth/login` — Sign in with email + password OR email + OTP.
- `POST /api/auth/send-otp` — Request 6-digit email verification code (`register` or `login` flow).
- `GET /api/auth/me` — Retrieve current authenticated session user profile.

### 5.3 Titles (`/api/titles`)
- `GET /api/titles/browse` — Paginated catalogue search & genre/mood filtering.
- `GET /api/titles/trending` — Trending titles combining TMDB live data and catalogue entries.
- `GET /api/titles/:id` — Full title details including cast, providers, soundtracks, and episodes.
- `POST /api/titles/:id/comments` — Post review/comment with spoiler tag.
- `POST /api/titles/:id/comments/:commentId/reaction` — React with emoji (🔥, 🍿, ❤️, etc.).

### 5.4 Recommendations (`/api/recommendations`)
- `POST /api/recommendations/solo` — Generate high-confidence shortlist based on time, mood, and streaming passes.
- `POST /api/recommendations/feedback` — Record user action (`watched`, `skipped`, `picked`) to adjust fatigue counters.

### 5.5 Group Sessions (`/api/sessions`)
- `POST /api/sessions` — Create a new watch room with constraints (returns 6-char `joinCode`).
- `GET /api/sessions/:joinCode` — Fetch room details, participant roster, and shortlisted titles.
- `POST /api/sessions/join` — Join room by code.
- `POST /api/sessions/:sessionId/shortlist` — Add a candidate title to the room shortlist.
- `DELETE /api/sessions/:sessionId/shortlist/:titleId` — Host removes a title candidate.
- `POST /api/sessions/:sessionId/vote` — Submit a weighted vote on a candidate title.
- `POST /api/sessions/:sessionId/finalize` — Close voting, trigger compromise algorithm, and generate Gemini AI pitch.

### 5.6 Watchlist & Social (`/api/watchlist`, `/api/users`)
- `GET /api/watchlist` — Retrieve authenticated user's watchlist with filtering.
- `POST /api/watchlist` — Add title to watchlist or update rating.
- `DELETE /api/watchlist/:id` — Remove item from watchlist.
- `GET /api/users/:userId/profile` — View user profile, badges, and mutual-watched compatibility.
- `POST /api/users/:userId/follow` — Follow or unfollow a community member.
- `GET /api/users/:userId/connections` — Fetch user's social connection graph.

### 5.7 Curator & Admin (`/api/curator`)
- `POST /api/curator/sync-tmdb` — Synchronize catalog with TMDB popular titles.
- `POST /api/curator/soundtracks` — Seed and manage soundtracks for titles.
- `GET /api/curator/reports` — View reported spoiler / abuse comments for moderation.

---

## 6. Real-Time Socket Events

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `session:join` | Client ➔ Server | `{ sessionId, userId }` | Join room socket channel |
| `session:leave` | Client ➔ Server | `{ sessionId, userId }` | Leave room socket channel |
| `session:vote` | Client ➔ Server | `{ sessionId, titleId, reaction, strength }` | Cast a reaction vote |
| `session:user_joined` | Server ➔ Room | `{ userId, participantCount }` | Broadcast attendee arrival |
| `session:vote_updated`| Server ➔ Room | `{ titleId, totalScore, votes }` | Live progress bar update |
| `session:finalized` | Server ➔ Room | `{ winner, aiPitch, scores }` | Live winner reveal broadcast |

---

## 7. Setup & Installation

### 7.1 Prerequisites
- **Node.js** v18.0.0 or higher
- **PostgreSQL** (local instance or managed cloud provider such as Supabase / Neon)
- **TMDB API Key** (from [The Movie Database](https://www.themoviedb.org/))
- **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/))
- **Brevo SMTP credentials** (or any standard SMTP service for transactional OTP emails)

### 7.2 Installation Steps

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
   CLIENT_URL="http://localhost:5173"
   TMDB_API_KEY="your_tmdb_api_key"
   GEMINI_API_KEY="your_gemini_api_key"
   BREVO_SMTP_KEY="your_brevo_smtp_api_key"
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

## 8. Project Structure

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
│   ├── middleware/          # Security, JWT auth, and error handling
│   │   ├── auth.middleware.ts
│   │   └── error.middleware.ts
│   ├── routes/              # Modular Express routing endpoints
│   ├── services/            # Core business logic & external integrations
│   │   ├── ai.service.ts              # Google Gemini compromise pitches
│   │   ├── EmailService.ts            # Brevo SMTP OTP delivery
│   │   ├── recommendation.service.ts  # Solo recommendation algorithm
│   │   ├── session.service.ts         # Weighted group decision scoring
│   │   ├── socket.service.ts          # Socket.IO room lifecycle & events
│   │   └── TmdbService.ts             # TMDB catalog fetching
│   ├── types/               # TypeScript interfaces and shared types
│   ├── utils/               # AppError and API response formatters
│   ├── app.ts               # Express middleware & route composition
│   └── server.ts            # HTTP bootstrap, Socket.IO & DB connector
├── .env.example             # Template environment variables
├── package.json
└── tsconfig.json
```

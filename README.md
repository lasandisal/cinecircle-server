# CineCircle Server (`cinecircle-be`)

Backend API service for **CineCircle** — A Social Watch-Decision Platform for TV & Film.

## Tech Stack
- **Runtime**: Node.js & Express
- **Language**: TypeScript
- **Database**: MongoDB with Mongoose
- **Auth**: JWT & bcryptjs (Role-Based Access Control)
- **Real-Time**: Socket.io for group decision voting
- **External Integration**: TMDB API & JustWatch streaming availability

## Project Structure
```text
src/
├── config/        # Database & Environment configuration
├── controllers/   # Request handler controllers
├── middleware/    # Auth, RBAC, and error handlers
├── models/        # Mongoose data models & schemas
├── routes/        # Modular Express REST routes
├── services/      # TMDB, Recommendation Algorithm & Socket.io services
├── types/         # TypeScript type definitions
├── utils/         # Standardized JSON response helpers
├── app.ts         # Express app configuration
└── server.ts      # Server bootstrap & Socket.io listener
```

## Setup & Running
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   ```
3. Run development server:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```

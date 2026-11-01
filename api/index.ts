import server, { initServer } from '../src/server';

// Eagerly initiate database & seeds on cold start
initServer().catch((err) => {
  console.error('[Vercel] Error during initServer:', err);
});

export default server;


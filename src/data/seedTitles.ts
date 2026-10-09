export interface SeedTitleData {
  tmdbId: number;
  name: string;
  type: 'film' | 'tv';
  genres: string[];
  synopsis: string;
  runtimeMinutes: number;
  releaseYear: number;
  voteAverage: number;
  posterUrl: string;
  backdropUrl: string;
  moodTags: string[];
  cast: {
    actorName: string;
    characterName: string;
    photoUrl?: string;
    bio?: string;
  }[];
  watchProviders: {
    service: string;
    region: string;
    type: 'subscription' | 'rental' | 'purchase';
  }[];
  seasons?: {
    seasonNumber: number;
    episodes: {
      episodeNumber: number;
      name: string;
      summary: string;
      runtimeMinutes: number;
    }[];
  }[];
  soundtracks?: {
    songName: string;
    artist: string;
    episodeRef?: string;
    popularityRank: number;
  }[];
}

export const SEED_TITLES: SeedTitleData[] = [
  {
    tmdbId: 693134,
    name: 'Dune: Part Two',
    type: 'film',
    genres: ['Science Fiction', 'Adventure', 'Action'],
    synopsis: 'Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen while on a path of revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the universe, he endeavors to prevent a terrible future only he can foresee.',
    runtimeMinutes: 166,
    releaseYear: 2024,
    voteAverage: 8.2,
    posterUrl: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/xOMo8BRK7PfcJv9JCnx7s520b22.jpg',
    moodTags: ['Cinematic Spectacle', 'Epic & Grand', 'High-Stakes', 'Philosophical'],
    cast: [
      { actorName: 'Timothée Chalamet', characterName: 'Paul Atreides', photoUrl: 'https://image.tmdb.org/t/p/w185/BE2sdjpgsa2rNTFa66f7upkaOP.jpg' },
      { actorName: 'Zendaya', characterName: 'Chani', photoUrl: 'https://image.tmdb.org/t/p/w185/r3A7drrtun9kjVIsq78mi4YVua1.jpg' },
      { actorName: 'Rebecca Ferguson', characterName: 'Lady Jessica', photoUrl: 'https://image.tmdb.org/t/p/w185/6NR8NHEwQzsA3bK001tNn2g5Xw.jpg' },
      { actorName: 'Austin Butler', characterName: 'Feyd-Rautha Harkonnen', photoUrl: 'https://image.tmdb.org/t/p/w185/2B25lqJzL6UuP6jB2XQ4Fj4K5.jpg' },
    ],
    watchProviders: [
      { service: 'Max', region: 'US', type: 'subscription' },
      { service: 'Prime Video', region: 'US', type: 'rental' },
      { service: 'Apple TV+', region: 'US', type: 'rental' },
    ],
    soundtracks: [
      { songName: 'Kiss the Ring', artist: 'Hans Zimmer', popularityRank: 1 },
      { songName: 'A Time of Quiet Between the Storms', artist: 'Hans Zimmer', popularityRank: 2 },
      { songName: 'Lisan al Gaib', artist: 'Hans Zimmer', popularityRank: 3 },
    ],
  },
  {
    tmdbId: 872585,
    name: 'Oppenheimer',
    type: 'film',
    genres: ['Drama', 'History', 'Biography'],
    synopsis: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II, probing deep into moral reckoning, political paranoia, and the birth of the nuclear age.',
    runtimeMinutes: 180,
    releaseYear: 2023,
    voteAverage: 8.1,
    posterUrl: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/rLb2cwF3Pazuxaj0sRXQ037tGI1.jpg',
    moodTags: ['Intense', 'Philosophical', 'Mind-Bending', 'High-Stakes'],
    cast: [
      { actorName: 'Cillian Murphy', characterName: 'J. Robert Oppenheimer', photoUrl: 'https://image.tmdb.org/t/p/w185/360R6otqfgw369v1NQ92Yv4vT.jpg' },
      { actorName: 'Emily Blunt', characterName: 'Katherine Oppenheimer', photoUrl: 'https://image.tmdb.org/t/p/w185/5U4B00g0K3z0pQ1r7Y8eN8y8.jpg' },
      { actorName: 'Robert Downey Jr.', characterName: 'Lewis Strauss', photoUrl: 'https://image.tmdb.org/t/p/w185/1YjdSym1jA7LnUXw32.jpg' },
    ],
    watchProviders: [
      { service: 'Prime Video', region: 'US', type: 'subscription' },
      { service: 'Apple TV+', region: 'US', type: 'purchase' },
    ],
    soundtracks: [
      { songName: 'Can You Hear the Music', artist: 'Ludwig Göransson', popularityRank: 1 },
      { songName: 'Destroyer of Worlds', artist: 'Ludwig Göransson', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 569094,
    name: 'Spider-Man: Across the Spider-Verse',
    type: 'film',
    genres: ['Animation', 'Action', 'Adventure', 'Science Fiction'],
    synopsis: 'After reuniting with Gwen Stacy, Brooklyn’s full-time friendly neighborhood Spider-Man is catapulted across the Multiverse, where he encounters the Spider Society, a team of Spider-People charged with protecting the multiverse’s very existence.',
    runtimeMinutes: 140,
    releaseYear: 2023,
    voteAverage: 8.4,
    posterUrl: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg',
    moodTags: ['Visually Stunning', 'Adrenaline Rush', 'Emotional', 'Fast-Paced'],
    cast: [
      { actorName: 'Shameik Moore', characterName: 'Miles Morales (voice)', photoUrl: 'https://image.tmdb.org/t/p/w185/vwh2vA.jpg' },
      { actorName: 'Hailee Steinfeld', characterName: 'Gwen Stacy (voice)', photoUrl: 'https://image.tmdb.org/t/p/w185/6nrE7K4A.jpg' },
      { actorName: 'Oscar Isaac', characterName: 'Miguel O’Hara (voice)', photoUrl: 'https://image.tmdb.org/t/p/w185/dW534c.jpg' },
    ],
    watchProviders: [
      { service: 'Netflix', region: 'US', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'Am I Dreaming', artist: 'Metro Boomin, A$AP Rocky, Roisee', popularityRank: 1 },
      { songName: 'Mona Lisa', artist: 'Dominic Fike', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 545611,
    name: 'Everything Everywhere All at Once',
    type: 'film',
    genres: ['Action', 'Adventure', 'Science Fiction', 'Comedy'],
    synopsis: 'An aging Chinese immigrant is swept up in an insane adventure, where she alone can save what’s important to her by connecting with the lives she could have led across parallel universes.',
    runtimeMinutes: 139,
    releaseYear: 2022,
    voteAverage: 8.0,
    posterUrl: 'https://image.tmdb.org/t/p/w500/w3LxiVYPqrlxqP9Ydr74-e8oFf.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/8ZfKj2.jpg',
    moodTags: ['Mind-Bending', 'Emotional', 'Witty & Sharp', 'Heartwarming'],
    cast: [
      { actorName: 'Michelle Yeoh', characterName: 'Evelyn Wang', photoUrl: 'https://image.tmdb.org/t/p/w185/iP6x7.jpg' },
      { actorName: 'Ke Huy Quan', characterName: 'Waymond Wang', photoUrl: 'https://image.tmdb.org/t/p/w185/jY9b.jpg' },
      { actorName: 'Stephanie Hsu', characterName: 'Joy Wang / Jobu Tupaki', photoUrl: 'https://image.tmdb.org/t/p/w185/38gB.jpg' },
    ],
    watchProviders: [
      { service: 'Prime Video', region: 'US', type: 'subscription' },
      { service: 'Netflix', region: 'US', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'This Is A Life', artist: 'Son Lux, Mitski, David Byrne', popularityRank: 1 },
    ],
  },
  {
    tmdbId: 66732,
    name: 'Stranger Things',
    type: 'tv',
    genres: ['Sci-Fi & Fantasy', 'Drama', 'Mystery'],
    synopsis: 'When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.',
    runtimeMinutes: 50,
    releaseYear: 2016,
    voteAverage: 8.6,
    posterUrl: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/56v2KjUmLeLoGqaVyt4xY.jpg',
    moodTags: ['Dark & Gritty', 'Nostalgic', 'Binge-Worthy', 'Spooky'],
    cast: [
      { actorName: 'Millie Bobby Brown', characterName: 'Eleven', photoUrl: 'https://image.tmdb.org/t/p/w185/yzp0K.jpg' },
      { actorName: 'Finn Wolfhard', characterName: 'Mike Wheeler', photoUrl: 'https://image.tmdb.org/t/p/w185/mB01.jpg' },
      { actorName: 'David Harbour', characterName: 'Jim Hopper', photoUrl: 'https://image.tmdb.org/t/p/w185/dH37.jpg' },
      { actorName: 'Winona Ryder', characterName: 'Joyce Byers', photoUrl: 'https://image.tmdb.org/t/p/w185/912y.jpg' },
    ],
    watchProviders: [
      { service: 'Netflix', region: 'US', type: 'subscription' },
      { service: 'Netflix', region: 'LK', type: 'subscription' },
    ],
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, name: 'Chapter One: The Vanishing of Will Byers', summary: 'On his way home from a friend’s house, young Will sees something terrifying. Nearby, a sinister secret lurks in the depths of a government lab.', runtimeMinutes: 48 },
          { episodeNumber: 2, name: 'Chapter Two: The Weirdo on Maple Street', summary: 'Lucas, Mike and Dustin try to talk to the girl they found in the woods. Hopper questions an anxious Joyce about an unsettling phone call.', runtimeMinutes: 55 },
          { episodeNumber: 3, name: 'Chapter Three: Holly, Jolly', summary: 'An increasingly concerned Nancy looks for Barb and finds out what Jonathan’s been up to. Joyce is convinced Will is trying to talk to her.', runtimeMinutes: 51 },
        ],
      },
    ],
    soundtracks: [
      { songName: 'Stranger Things Theme', artist: 'Kyle Dixon & Michael Stein', popularityRank: 1 },
      { songName: 'Running Up That Hill', artist: 'Kate Bush', episodeRef: 'S4E4', popularityRank: 2 },
      { songName: 'Should I Stay or Should I Go', artist: 'The Clash', episodeRef: 'S1E2', popularityRank: 3 },
    ],
  },
  {
    tmdbId: 76331,
    name: 'Succession',
    type: 'tv',
    genres: ['Drama'],
    synopsis: 'The Roy family is known for controlling the biggest media and entertainment company in the world. However, their world changes when their aging father steps down from the company, unleashing ruthless family power struggles.',
    runtimeMinutes: 60,
    releaseYear: 2018,
    voteAverage: 8.6,
    posterUrl: 'https://image.tmdb.org/t/p/w500/7udWmr0.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/etj7E.jpg',
    moodTags: ['High-Stakes', 'Dark & Gritty', 'Witty & Sharp', 'Intense'],
    cast: [
      { actorName: 'Brian Cox', characterName: 'Logan Roy', photoUrl: 'https://image.tmdb.org/t/p/w185/7.jpg' },
      { actorName: 'Jeremy Strong', characterName: 'Kendall Roy', photoUrl: 'https://image.tmdb.org/t/p/w185/8.jpg' },
      { actorName: 'Sarah Snook', characterName: 'Shiv Roy', photoUrl: 'https://image.tmdb.org/t/p/w185/9.jpg' },
      { actorName: 'Kieran Culkin', characterName: 'Roman Roy', photoUrl: 'https://image.tmdb.org/t/p/w185/10.jpg' },
    ],
    watchProviders: [
      { service: 'Max', region: 'US', type: 'subscription' },
      { service: 'Hulu', region: 'US', type: 'subscription' },
    ],
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, name: 'Celebration', summary: 'On his 80th birthday, media magnate Logan Roy shocks his family by announcing he is not stepping down as CEO of Waystar Royco.', runtimeMinutes: 64 },
          { episodeNumber: 2, name: 'Shit Show at the Tiffany’s', summary: 'Logan’s incapacitated state sets off a heated debate among his children about who should take the helm.', runtimeMinutes: 58 },
        ],
      },
    ],
    soundtracks: [
      { songName: 'Succession Main Title Theme', artist: 'Nicholas Britell', popularityRank: 1 },
      { songName: 'Andante Risoluto', artist: 'Nicholas Britell', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 136315,
    name: 'The Bear',
    type: 'tv',
    genres: ['Comedy', 'Drama'],
    synopsis: 'A young fine-dining chef returns home to Chicago to run his family’s Italian beef sandwich shop after a tragic loss, pushing himself and a recalcitrant kitchen crew to the edge of sanity.',
    runtimeMinutes: 30,
    releaseYear: 2022,
    voteAverage: 8.3,
    posterUrl: 'https://image.tmdb.org/t/p/w500/s3bS57.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/mrg7V.jpg',
    moodTags: ['Intense', 'Fast-Paced', 'Emotional', 'Heartwarming'],
    cast: [
      { actorName: 'Jeremy Allen White', characterName: 'Carmen "Carmy" Berzatto', photoUrl: 'https://image.tmdb.org/t/p/w185/11.jpg' },
      { actorName: 'Ayo Edebiri', characterName: 'Sydney Adamu', photoUrl: 'https://image.tmdb.org/t/p/w185/12.jpg' },
      { actorName: 'Ebon Moss-Bachrach', characterName: 'Richard "Richie" Jerimovich', photoUrl: 'https://image.tmdb.org/t/p/w185/13.jpg' },
    ],
    watchProviders: [
      { service: 'Hulu', region: 'US', type: 'subscription' },
      { service: 'Disney+', region: 'LK', type: 'subscription' },
    ],
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, name: 'System', summary: 'Carmy attempts to overhaul The Original Beef of Chicagoland kitchen operations amidst debts and stubborn resistance.', runtimeMinutes: 28 },
          { episodeNumber: 7, name: 'Review', summary: 'A frantic one-take look at an unmitigated disaster during lunch rush.', runtimeMinutes: 20 },
        ],
      },
    ],
    soundtracks: [
      { songName: 'New Noise', artist: 'Refused', popularityRank: 1 },
      { songName: 'Love Story (Taylor’s Version)', artist: 'Taylor Swift', episodeRef: 'S2E7', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 95557,
    name: 'Severance',
    type: 'tv',
    genres: ['Drama', 'Mystery', 'Sci-Fi & Fantasy'],
    synopsis: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives. When a mysterious colleague appears outside of work, it begins a journey to discover the truth about their jobs.',
    runtimeMinutes: 55,
    releaseYear: 2022,
    voteAverage: 8.4,
    posterUrl: 'https://image.tmdb.org/t/p/w500/pvi5b.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/gL9k8.jpg',
    moodTags: ['Mind-Bending', 'Dark & Gritty', 'Philosophical', 'Suspenseful'],
    cast: [
      { actorName: 'Adam Scott', characterName: 'Mark Scout', photoUrl: 'https://image.tmdb.org/t/p/w185/14.jpg' },
      { actorName: 'Patricia Arquette', characterName: 'Harmony Cobel', photoUrl: 'https://image.tmdb.org/t/p/w185/15.jpg' },
      { actorName: 'John Turturro', characterName: 'Irving Bailiff', photoUrl: 'https://image.tmdb.org/t/p/w185/16.jpg' },
    ],
    watchProviders: [
      { service: 'Apple TV+', region: 'US', type: 'subscription' },
      { service: 'Apple TV+', region: 'LK', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'Main Titles', artist: 'Theodore Shapiro', popularityRank: 1 },
    ],
  },
  {
    tmdbId: 157336,
    name: 'Interstellar',
    type: 'film',
    genres: ['Adventure', 'Drama', 'Science Fiction'],
    synopsis: 'The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel and conquer the vast distances involved in an interstellar voyage.',
    runtimeMinutes: 169,
    releaseYear: 2014,
    voteAverage: 8.4,
    posterUrl: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
    moodTags: ['Mind-Bending', 'Emotional', 'Epic & Grand', 'Philosophical'],
    cast: [
      { actorName: 'Matthew McConaughey', characterName: 'Joseph Cooper', photoUrl: 'https://image.tmdb.org/t/p/w185/17.jpg' },
      { actorName: 'Anne Hathaway', characterName: 'Amelia Brand', photoUrl: 'https://image.tmdb.org/t/p/w185/18.jpg' },
      { actorName: 'Jessica Chastain', characterName: 'Murphy Cooper', photoUrl: 'https://image.tmdb.org/t/p/w185/19.jpg' },
    ],
    watchProviders: [
      { service: 'Prime Video', region: 'US', type: 'subscription' },
      { service: 'Apple TV+', region: 'US', type: 'rental' },
    ],
    soundtracks: [
      { songName: 'Cornfield Chase', artist: 'Hans Zimmer', popularityRank: 1 },
      { songName: 'No Time for Caution', artist: 'Hans Zimmer', popularityRank: 2 },
      { songName: 'Stay', artist: 'Hans Zimmer', popularityRank: 3 },
    ],
  },
  {
    tmdbId: 496243,
    name: 'Parasite',
    type: 'film',
    genres: ['Comedy', 'Thriller', 'Drama'],
    synopsis: 'All unemployed, Ki-taek’s family takes peculiar interest in the wealthy and glamorous Parks for their livelihood until they get entangled in an unexpected incident.',
    runtimeMinutes: 132,
    releaseYear: 2019,
    voteAverage: 8.5,
    posterUrl: 'https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/hiKmpZMGZsrkA3cdce8a7Dpos1j.jpg',
    moodTags: ['Dark & Gritty', 'Witty & Sharp', 'Suspenseful', 'High-Stakes'],
    cast: [
      { actorName: 'Song Kang-ho', characterName: 'Kim Ki-taek', photoUrl: 'https://image.tmdb.org/t/p/w185/20.jpg' },
      { actorName: 'Lee Sun-kyun', characterName: 'Park Dong-ik', photoUrl: 'https://image.tmdb.org/t/p/w185/21.jpg' },
      { actorName: 'Cho Yeo-jeong', characterName: 'Choi Yeon-gyo', photoUrl: 'https://image.tmdb.org/t/p/w185/22.jpg' },
    ],
    watchProviders: [
      { service: 'Max', region: 'US', type: 'subscription' },
      { service: 'Hulu', region: 'US', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'Soju One Glass', artist: 'Choi Woo-shik', popularityRank: 1 },
    ],
  },
  {
    tmdbId: 27205,
    name: 'Inception',
    type: 'film',
    genres: ['Action', 'Science Fiction', 'Adventure'],
    synopsis: 'Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets, is offered a chance to regain his old life as payment for a task considered to be impossible: "inception", the implantation of another person’s idea into a target’s subconscious.',
    runtimeMinutes: 148,
    releaseYear: 2010,
    voteAverage: 8.4,
    posterUrl: 'https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/s3TBrRGB1jav7Z2ARIEsvxZTk.jpg',
    moodTags: ['Mind-Bending', 'Fast-Paced', 'High-Stakes', 'Cinematic Spectacle'],
    cast: [
      { actorName: 'Leonardo DiCaprio', characterName: 'Dom Cobb', photoUrl: 'https://image.tmdb.org/t/p/w185/23.jpg' },
      { actorName: 'Joseph Gordon-Levitt', characterName: 'Arthur', photoUrl: 'https://image.tmdb.org/t/p/w185/24.jpg' },
      { actorName: 'Elliot Page', characterName: 'Ariadne', photoUrl: 'https://image.tmdb.org/t/p/w185/25.jpg' },
      { actorName: 'Tom Hardy', characterName: 'Eames', photoUrl: 'https://image.tmdb.org/t/p/w185/26.jpg' },
    ],
    watchProviders: [
      { service: 'Netflix', region: 'US', type: 'subscription' },
      { service: 'Prime Video', region: 'US', type: 'rental' },
    ],
    soundtracks: [
      { songName: 'Time', artist: 'Hans Zimmer', popularityRank: 1 },
      { songName: 'Dream is Collapsing', artist: 'Hans Zimmer', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 94605,
    name: 'Arcane',
    type: 'tv',
    genres: ['Animation', 'Sci-Fi & Fantasy', 'Action & Adventure'],
    synopsis: 'Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies and incompatible convictions.',
    runtimeMinutes: 42,
    releaseYear: 2021,
    voteAverage: 8.7,
    posterUrl: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn397cv.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/rkB4LyZHo1NHXSTXY7.jpg',
    moodTags: ['Visually Stunning', 'Emotional', 'High-Stakes', 'Dark & Gritty'],
    cast: [
      { actorName: 'Hailee Steinfeld', characterName: 'Vi (voice)', photoUrl: 'https://image.tmdb.org/t/p/w185/27.jpg' },
      { actorName: 'Ella Purnell', characterName: 'Jinx (voice)', photoUrl: 'https://image.tmdb.org/t/p/w185/28.jpg' },
    ],
    watchProviders: [
      { service: 'Netflix', region: 'US', type: 'subscription' },
      { service: 'Netflix', region: 'LK', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'Enemy', artist: 'Imagine Dragons, JID', popularityRank: 1 },
      { songName: 'Guns for Hire', artist: 'Woodkid', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 100088,
    name: 'The Last of Us',
    type: 'tv',
    genres: ['Drama', 'Sci-Fi & Fantasy', 'Action & Adventure'],
    synopsis: 'Twenty years after modern civilization has been destroyed, Joel, a hardened survivor, is hired to smuggle Ellie, a 14-year-old girl, out of an oppressive quarantine zone. What starts as a small job soon becomes a brutal, heartbreaking journey.',
    runtimeMinutes: 55,
    releaseYear: 2023,
    voteAverage: 8.6,
    posterUrl: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7J.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/uDgy6hyPd82kOH2UmU.jpg',
    moodTags: ['Emotional', 'Dark & Gritty', 'High-Stakes', 'Suspenseful'],
    cast: [
      { actorName: 'Pedro Pascal', characterName: 'Joel Miller', photoUrl: 'https://image.tmdb.org/t/p/w185/29.jpg' },
      { actorName: 'Bella Ramsey', characterName: 'Ellie Williams', photoUrl: 'https://image.tmdb.org/t/p/w185/30.jpg' },
    ],
    watchProviders: [
      { service: 'Max', region: 'US', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'Long Long Time', artist: 'Linda Ronstadt', episodeRef: 'S1E3', popularityRank: 1 },
      { songName: 'The Last of Us Theme', artist: 'Gustavo Santaolalla', popularityRank: 2 },
    ],
  },
  {
    tmdbId: 108978,
    name: 'Reacher',
    type: 'tv',
    genres: ['Action & Adventure', 'Crime', 'Drama'],
    synopsis: 'Jack Reacher, a veteran military police investigator, enters civilian life moving from town to town with only the essentials. When he is wrongly accused of murder, he must uncover a deadly conspiracy.',
    runtimeMinutes: 50,
    releaseYear: 2022,
    voteAverage: 8.1,
    posterUrl: 'https://image.tmdb.org/t/p/w500/j73ytuzox2.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/j0P82z.jpg',
    moodTags: ['Adrenaline Rush', 'Dark & Gritty', 'Fast-Paced'],
    cast: [
      { actorName: 'Alan Ritchson', characterName: 'Jack Reacher', photoUrl: 'https://image.tmdb.org/t/p/w185/31.jpg' },
    ],
    watchProviders: [
      { service: 'Prime Video', region: 'US', type: 'subscription' },
      { service: 'Prime Video', region: 'LK', type: 'subscription' },
    ],
  },
  {
    tmdbId: 673,
    name: 'Harry Potter and the Prisoner of Azkaban',
    type: 'film',
    genres: ['Adventure', 'Fantasy'],
    synopsis: 'Harry Potter, Ron and Hermione return to Hogwarts for their third year of study, where they delve into the mystery surrounding Sirius Black, an escaped prisoner from Azkaban.',
    runtimeMinutes: 141,
    releaseYear: 2004,
    voteAverage: 8.0,
    posterUrl: 'https://image.tmdb.org/t/p/w500/aweqw9p5.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/vbk5C3.jpg',
    moodTags: ['Nostalgic', 'Spooky', 'Cinematic Spectacle', 'Heartwarming'],
    cast: [
      { actorName: 'Daniel Radcliffe', characterName: 'Harry Potter', photoUrl: 'https://image.tmdb.org/t/p/w185/32.jpg' },
      { actorName: 'Emma Watson', characterName: 'Hermione Granger', photoUrl: 'https://image.tmdb.org/t/p/w185/33.jpg' },
      { actorName: 'Rupert Grint', characterName: 'Ron Weasley', photoUrl: 'https://image.tmdb.org/t/p/w185/34.jpg' },
    ],
    watchProviders: [
      { service: 'Max', region: 'US', type: 'subscription' },
      { service: 'Prime Video', region: 'US', type: 'rental' },
    ],
  },
  {
    tmdbId: 414906,
    name: 'The Batman',
    type: 'film',
    genres: ['Crime', 'Mystery', 'Thriller', 'Action'],
    synopsis: 'In his second year of fighting crime, Batman uncovers corruption in Gotham City that connects to his own family while facing a serial killer known as the Riddler.',
    runtimeMinutes: 176,
    releaseYear: 2022,
    voteAverage: 7.7,
    posterUrl: 'https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg',
    moodTags: ['Dark & Gritty', 'Suspenseful', 'Intense', 'Atmospheric'],
    cast: [
      { actorName: 'Robert Pattinson', characterName: 'Bruce Wayne / Batman', photoUrl: 'https://image.tmdb.org/t/p/w185/35.jpg' },
      { actorName: 'Zoë Kravitz', characterName: 'Selina Kyle / Catwoman', photoUrl: 'https://image.tmdb.org/t/p/w185/36.jpg' },
      { actorName: 'Paul Dano', characterName: 'Edward Nashton / Riddler', photoUrl: 'https://image.tmdb.org/t/p/w185/37.jpg' },
    ],
    watchProviders: [
      { service: 'Max', region: 'US', type: 'subscription' },
      { service: 'Netflix', region: 'US', type: 'subscription' },
    ],
    soundtracks: [
      { songName: 'Something in the Way', artist: 'Nirvana', popularityRank: 1 },
      { songName: 'The Batman Theme', artist: 'Michael Giacchino', popularityRank: 2 },
    ],
  },
];

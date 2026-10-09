import axios from 'axios';

export interface SoundtrackTrack {
  songName: string;
  artist: string;
  episodeRef?: string;
  popularityRank: number;
  previewUrl?: string;
  albumArtUrl?: string;
  spotifyUrl?: string;
}

const ICONIC_SOUNDTRACKS: Record<string, { songName: string; artist: string; episodeRef: string; popularityRank: number }[]> = {
  riverdale: [
    { songName: 'Kids in America', artist: 'KJ Apa & Camila Mendes', episodeRef: 'Season 1 Finale - Homecoming / Jubilee Performance', popularityRank: 1 },
    { songName: 'Candy Girl (Sugar Sugar)', artist: 'Josie and the Pussycats', episodeRef: 'Season 1 Episode 2 - Pep Rally Performance', popularityRank: 2 },
    { songName: 'Mad World', artist: 'KJ Apa, Camila Mendes & Lili Reinhart', episodeRef: "Season 2 - FP's Serpent Retirement Party at WhyTe Wyrm", popularityRank: 3 },
    { songName: 'Milkshake', artist: 'Josie and the Pussycats & Cheryl Blossom', episodeRef: "Season 2 Episode 2 - Save Pop's Chock'lit Shoppe Roof Rally", popularityRank: 4 },
    { songName: 'Jailhouse Rock', artist: 'Camila Mendes, Ashleigh Murray & Madelaine Petsch', episodeRef: "Season 3 Episode 2 - Archie's Juvenile Detention Football Game", popularityRank: 5 },
    { songName: 'Seventeen', artist: 'Lili Reinhart & Cole Sprouse', episodeRef: 'Season 3 Episode 16 - Heathers the Musical Duet', popularityRank: 6 },
    { songName: 'Cherry Bomb', artist: 'Madelaine Petsch, Camila Mendes & Vanessa Morgan', episodeRef: 'Season 4 Episode 7 - River Vixens Halftime Cheer Routine', popularityRank: 7 },
    { songName: 'Bittersweet Symphony', artist: 'Ashleigh Murray & Camila Mendes', episodeRef: 'Season 2 Episode 10 - Veronica & Josie Cabaret Duet', popularityRank: 8 },
  ],
  vampire_diaries: [
    { songName: 'Another Love', artist: 'Tom Odell', episodeRef: 'Season 6 Finale - Elena & Damon Farewell Road Dance', popularityRank: 1 },
    { songName: 'Never Say Never', artist: 'The Fray', episodeRef: 'Season 1 Finale - Elena & Stefan Intimate Scene', popularityRank: 2 },
    { songName: 'All I Need', artist: 'Within Temptation', episodeRef: 'Season 1 Episode 19 - Miss Mystic Falls Damon & Elena Dance', popularityRank: 3 },
    { songName: 'A Drop in the Ocean', artist: 'Ron Pope', episodeRef: 'Season 3 Episode 1 - Stefan Birthday Phone Call to Elena', popularityRank: 4 },
    { songName: 'Bloodstream', artist: 'Stateless', episodeRef: 'Season 1 Finale - Damon & Katherine Porch Scene', popularityRank: 5 },
    { songName: 'Skinny Love', artist: 'Birdy', episodeRef: "Season 2 Finale - Jenna's Funeral & John's Letter", popularityRank: 6 },
    { songName: 'Hold On', artist: 'Chord Overstreet', episodeRef: 'Season 8 Finale - Peace in the Afterlife', popularityRank: 7 },
    { songName: 'Feel So Close', artist: 'Calvin Harris', episodeRef: 'Season 4 Episode 4 - College Blood-Feeding Party', popularityRank: 8 },
  ],
  wednesday: [
    { songName: 'Goo Goo Muck', artist: 'The Cramps', episodeRef: "Season 1 Episode 4 - Rave'N Dance Iconic Choreography", popularityRank: 1 },
    { songName: 'Bloody Mary', artist: 'Lady Gaga', episodeRef: 'Viral TikTok Dance Trend & Fan Anthem', popularityRank: 2 },
    { songName: 'Paint It Black', artist: 'Wednesday Addams', episodeRef: 'Season 1 Episode 1 - Balcony Cello Solo', popularityRank: 3 },
    { songName: 'Nothing Else Matters', artist: 'Apocalyptica', episodeRef: 'Season 1 Episode 3 - Cello Duet Montage', popularityRank: 4 },
  ],
  euphoria: [
    { songName: 'All for Us', artist: 'Labrinth & Zendaya', episodeRef: 'Season 1 Finale - Rue Marching Band Climax', popularityRank: 1 },
    { songName: 'Still Don’t Know My Name', artist: 'Labrinth', episodeRef: 'Iconic Theme - Carnival & Glitter Tears', popularityRank: 2 },
    { songName: 'Mount Everest', artist: 'Labrinth', episodeRef: 'Nate Jacobs Hallway Walk', popularityRank: 3 },
    { songName: 'Right Down the Line', artist: 'Gerry Rafferty', episodeRef: 'Season 2 Opening Scene', popularityRank: 4 },
  ],
  friends: [
    { songName: "I'll Be There for You", artist: 'The Rembrandts', episodeRef: 'Main Theme & Central Perk Fountain', popularityRank: 1 },
    { songName: 'Smelly Cat', artist: 'Phoebe Buffay (Lisa Kudrow)', episodeRef: 'Central Perk Live Gig & Music Video', popularityRank: 2 },
    { songName: 'With or Without You', artist: 'U2', episodeRef: 'Ross Radio Dedication to Rachel', popularityRank: 3 },
    { songName: 'Wicked Game', artist: 'Chris Isaak', episodeRef: 'Hayden Planetarium Date Scene', popularityRank: 4 },
    { songName: 'Angel of the Morning', artist: 'Juice Newton', episodeRef: 'Central Perk Flashback Coffee Bar', popularityRank: 5 },
    { songName: 'Shiny Happy People', artist: 'R.E.M.', episodeRef: 'Green Apartment Celebration Party', popularityRank: 6 },
    { songName: 'You Were Meant for Me', artist: 'Jewel', episodeRef: 'Central Perk Heart-to-Heart', popularityRank: 7 },
  ],
  stranger_things: [
    { songName: 'Running Up That Hill (A Deal with God)', artist: 'Kate Bush', episodeRef: "Season 4 - Max's Mind Lair Escape", popularityRank: 1 },
    { songName: 'Master of Puppets', artist: 'Metallica', episodeRef: "Season 4 - Eddie's Upside Down Guitar Solo", popularityRank: 2 },
    { songName: 'Should I Stay or Should I Go', artist: 'The Clash', episodeRef: 'Season 1 - Castle Byers Transmission', popularityRank: 3 },
    { songName: 'Every Breath You Take', artist: 'The Police', episodeRef: 'Season 2 - Snow Ball 1984', popularityRank: 4 },
  ],
  the_bear: [
    { songName: 'New Noise', artist: 'Refused', episodeRef: 'Kitchen High-Pressure Rush Hour', popularityRank: 1 },
    { songName: 'Spiders (Kidsmoke)', artist: 'Wilco', episodeRef: 'Opening Morning Prep Montage', popularityRank: 2 },
    { songName: 'Let Down', artist: 'Radiohead', episodeRef: 'Season 1 Finale Family Dinner Service', popularityRank: 3 },
    { songName: 'Love Story (Taylor’s Version)', artist: 'Taylor Swift', episodeRef: "Season 2 - Richie's Staging Breakthrough Drive", popularityRank: 4 },
  ],
  succession: [
    { songName: 'Succession Main Title Theme', artist: 'Nicholas Britell', episodeRef: 'Roy Family Empire Opening Theme', popularityRank: 1 },
    { songName: 'Andante Risoluto', artist: 'Nicholas Britell', episodeRef: 'Season 2 Boardroom Showdown', popularityRank: 2 },
    { songName: 'Honesty', artist: 'Billy Joel', episodeRef: "Kendall's 40th Birthday Party", popularityRank: 3 },
  ],
  arcane: [
    { songName: 'Enemy', artist: 'Imagine Dragons & JID', episodeRef: 'Opening Theme & Zaun Underworld', popularityRank: 1 },
    { songName: 'Guns for Hire', artist: 'Woodkid', episodeRef: "Silco & Jinx's Pivotal River Pier Scene", popularityRank: 2 },
    { songName: 'What Could Have Been', artist: 'Sting & Ray Chen', episodeRef: 'Season 1 Climactic Finale Feast', popularityRank: 3 },
  ],
  interstellar: [
    { songName: 'Cornfield Chase', artist: 'Hans Zimmer', episodeRef: 'Drone Pursuit Through the Cornfield', popularityRank: 1 },
    { songName: 'No Time for Caution', artist: 'Hans Zimmer', episodeRef: 'Endurance Spinning Docking Sequence', popularityRank: 2 },
    { songName: 'Stay', artist: 'Hans Zimmer', episodeRef: "Murph's Bedroom Departure Farewell", popularityRank: 3 },
  ],
  dune: [
    { songName: 'Paul’s Dream', artist: 'Hans Zimmer', episodeRef: 'Visions of the Golden Path & Chani', popularityRank: 1 },
    { songName: 'Ripples in the Sand', artist: 'Hans Zimmer', episodeRef: 'Shai-Hulud Sandworm Awakening', popularityRank: 2 },
    { songName: 'Leaving Caladan', artist: 'Hans Zimmer', episodeRef: 'House Atreides Departure Fleet', popularityRank: 3 },
  ],
  twilight: [
    { songName: 'A Thousand Years', artist: 'Christina Perri', episodeRef: 'Breaking Dawn - Edward & Bella Forever', popularityRank: 1 },
    { songName: 'Flightless Bird, American Mouth', artist: 'Iron & Wine', episodeRef: 'Prom Gazebo Slow Dance', popularityRank: 2 },
    { songName: 'Supermassive Black Hole', artist: 'Muse', episodeRef: 'Cullen Family Thunderstorm Baseball Game', popularityRank: 3 },
    { songName: 'Decode', artist: 'Paramore', episodeRef: 'End Credits & Forest Chase Theme', popularityRank: 4 },
  ],
  game_of_thrones: [
    { songName: 'Main Title Theme', artist: 'Ramin Djawadi', episodeRef: 'Opening Map Clockwork Sequence', popularityRank: 1 },
    { songName: 'Light of the Seven', artist: 'Ramin Djawadi', episodeRef: 'Season 6 Finale - Sept of Baelor Wildfire Climax', popularityRank: 2 },
    { songName: 'The Rains of Castamere', artist: 'The National', episodeRef: 'Season 3 - The Red Wedding', popularityRank: 3 },
    { songName: 'Jenny of Oldstones', artist: 'Florence + the Machine', episodeRef: 'Season 8 Episode 2 - Eve of the Battle of Winterfell', popularityRank: 4 },
  ],
  breaking_bad: [
    { songName: 'Baby Blue', artist: 'Badfinger', episodeRef: "Series Finale - Walter White's Final Lab Moment", popularityRank: 1 },
    { songName: 'Crystal Blue Persuasion', artist: 'Tommy James & The Shondells', episodeRef: 'Meth Distribution Global Empire Montage', popularityRank: 2 },
    { songName: 'DLZ', artist: 'TV on the Radio', episodeRef: "Hardware Store - 'Stay Out of My Territory'", popularityRank: 3 },
  ],
  peaky_blinders: [
    { songName: 'Red Right Hand', artist: 'Nick Cave & The Bad Seeds', episodeRef: 'Main Title Theme & Birmingham Street Walks', popularityRank: 1 },
    { songName: 'You Want It Darker', artist: 'Leonard Cohen', episodeRef: "Tommy Shelby's Solitary Reflections", popularityRank: 2 },
    { songName: 'Lazarus', artist: 'David Bowie', episodeRef: 'Season 3 Dramatic Climactic Sequence', popularityRank: 3 },
  ],
  gossip_girl: [
    { songName: 'Whatcha Say', artist: 'Jason Derulo', episodeRef: 'Season 3 Episode 11 - The Iconic Thanksgiving Dinner Climax', popularityRank: 1 },
    { songName: 'Apologize', artist: 'Timbaland & OneRepublic', episodeRef: 'Season 1 Episode 10 - Dan & Serena Debutante Ball', popularityRank: 2 },
    { songName: 'With Me', artist: 'Sum 41', episodeRef: 'Season 1 Episode 7 - Chuck & Blair Limo Scene', popularityRank: 3 },
    { songName: 'Young Folks', artist: 'Peter Bjorn and John', episodeRef: 'Pilot - Serena Arrives at Grand Central', popularityRank: 4 },
    { songName: 'Rolling in the Deep', artist: 'Adele', episodeRef: 'Season 4 Finale - Blair & Chuck / Dan Confrontation', popularityRank: 5 },
    { songName: 'Sour Cherry', artist: 'The Kills', episodeRef: 'Season 1 - OMFGG Album Opening', popularityRank: 6 },
    { songName: 'Paparazzi', artist: 'Lady Gaga', episodeRef: 'Season 3 Episode 4 - Secret Society', popularityRank: 7 },
    { songName: 'Video Games', artist: 'Lana Del Rey', episodeRef: "Season 5 Episode 6 - Chuck's Apology to Blair", popularityRank: 8 },
    { songName: 'Three Wishes', artist: 'The Pierces', episodeRef: "Season 1 Episode 3 - Blair's Sleepover", popularityRank: 9 },
    { songName: 'Do You Wanna', artist: 'The Kooks', episodeRef: 'Season 1 - OMFGG Album', popularityRank: 10 },
  ],
  greys_anatomy: [
    { songName: 'Chasing Cars', artist: 'Snow Patrol', episodeRef: 'Season 2 Finale - Denny Duquette Climax', popularityRank: 1 },
    { songName: 'How to Save a Life', artist: 'The Fray', episodeRef: 'Season 2 Episode 21 - Iconic ER Anthem', popularityRank: 2 },
    { songName: 'The Story', artist: 'Brandi Carlile', episodeRef: "Season 7 - Callie's Recovery", popularityRank: 3 },
    { songName: 'Breathe (2 AM)', artist: 'Anna Nalick', episodeRef: 'Season 2 Episode 17 - Bomb in the OR', popularityRank: 4 },
    { songName: 'Where Does the Good Go', artist: 'Tegan and Sara', episodeRef: 'Season 10 Finale - Meredith & Cristina Final Dance', popularityRank: 5 },
    { songName: 'Cosy in the Rocket', artist: 'Psapp', episodeRef: 'Main Title Theme', popularityRank: 6 },
  ],
  the_oc: [
    { songName: 'California', artist: 'Phantom Planet', episodeRef: 'Iconic Main Title Theme', popularityRank: 1 },
    { songName: 'Hide and Seek', artist: 'Imogen Heap', episodeRef: 'Season 2 Finale - Marissa Shoots Trey', popularityRank: 2 },
    { songName: 'Hallelujah', artist: 'Jeff Buckley', episodeRef: 'Season 1 Finale - Ryan Leaves Newport', popularityRank: 3 },
    { songName: 'Forever Young', artist: 'Youth Group', episodeRef: 'Season 3 Episode 16 - Sadie & Ryan Dance', popularityRank: 4 },
    { songName: 'Paint the Silence', artist: 'South', episodeRef: 'Season 1 Model Home Fire', popularityRank: 5 },
  ],
  gilmore_girls: [
    { songName: 'Where You Lead', artist: 'Carole King & Louise Goffin', episodeRef: 'Opening Theme Song', popularityRank: 1 },
    { songName: 'Reflecting Light', artist: 'Sam Phillips', episodeRef: 'Season 4 Finale - Luke & Lorelai First Dance', popularityRank: 2 },
    { songName: 'There She Goes', artist: 'The La’s', episodeRef: 'Pilot - Lorelai Walking Through Stars Hollow', popularityRank: 3 },
    { songName: 'Earn Enough for Us', artist: 'XTC', episodeRef: "Season 3 Luke's Diner Scene", popularityRank: 4 },
    { songName: 'Know Your Onion!', artist: 'The Shins', episodeRef: 'Season 1 Chilton Hallway', popularityRank: 5 },
  ],
  skins: [
    { songName: 'Wild World', artist: 'Cat Stevens', episodeRef: 'Season 1 Finale - Sid & Cast Sing-along', popularityRank: 1 },
    { songName: 'Standing in the Way of Control', artist: 'Gossip', episodeRef: 'Season 1 Episode 1 - Opening House Party', popularityRank: 2 },
    { songName: 'Alice Practice', artist: 'Crystal Castles', episodeRef: 'Season 2 Episode 3 - Club Scene', popularityRank: 3 },
    { songName: 'Cat Chew', artist: 'Fat Segal', episodeRef: 'Main Title & Ambient Theme', popularityRank: 4 },
  ],
  suits: [
    { songName: 'Greenback Boogie', artist: 'Ima Robot', episodeRef: 'Iconic Main Opening Theme', popularityRank: 1 },
    { songName: 'Short Change Hero', artist: 'The Heavy', episodeRef: 'Season 2 Episode 10 - High Stakes Climax', popularityRank: 2 },
    { songName: 'Looking Too Closely', artist: 'Fink', episodeRef: 'Season 4 Mid-Season Finale', popularityRank: 3 },
    { songName: 'Love Me Again', artist: 'John Newman', episodeRef: 'Season 3 Episode 1', popularityRank: 4 },
    { songName: 'Gold on the Ceiling', artist: 'The Black Keys', episodeRef: 'Season 1 Harvey Winning Montage', popularityRank: 5 },
  ],
  one_tree_hill: [
    { songName: 'I Don’t Want to Be', artist: 'Gavin DeGraw', episodeRef: 'Iconic Opening Theme', popularityRank: 1 },
    { songName: 'Hear You Me', artist: 'Jimmy Eat World', episodeRef: 'Season 3 Episode 16 - School Memorial Service', popularityRank: 2 },
    { songName: 'Hands Down', artist: 'Dashboard Confessional', episodeRef: 'Season 1 - Ravens Victory Party', popularityRank: 3 },
    { songName: 'The Mixed Tape', artist: 'Jack’s Mannequin', episodeRef: "Season 3 Episode 15 - Peyton's Studio", popularityRank: 4 },
    { songName: 'Halo', artist: 'Bethany Joy Lenz', episodeRef: 'Season 3 Tour Performance', popularityRank: 5 },
  ],
  pretty_little_liars: [
    { songName: 'Secret', artist: 'The Pierces', episodeRef: 'Iconic Main Theme - Got a secret, can you keep it?', popularityRank: 1 },
    { songName: 'Hands of Time', artist: 'Rachel Diggs', episodeRef: "Season 1 Episode 1 - Alison's Memorial", popularityRank: 2 },
    { songName: 'Fresh Fresh', artist: 'Florence + the Machine', episodeRef: 'Season 1 Pilot Ending', popularityRank: 3 },
    { songName: 'Bones', artist: 'MS MR', episodeRef: 'Season 4 Episode 12', popularityRank: 4 },
  ],
};

export class SoundtrackService {
  private static cache = new Map<string, { previewUrl?: string; albumArtUrl?: string; appleMusicUrl?: string }>();

  /**
   * Enrich song and artist with Apple iTunes Search API
   * Completely legal, free, official 30-sec preview stream & cover art
   */
  public static async enrichTrackWithAudio(
    songName: string,
    artist: string
  ): Promise<{ previewUrl?: string; albumArtUrl?: string; appleMusicUrl?: string }> {
    const cacheKey = `${songName.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const q = encodeURIComponent(`${songName} ${artist}`);
      const res = await axios.get(
        `https://itunes.apple.com/search?term=${q}&entity=song&limit=1`,
        { timeout: 3500 }
      );
      const match = res.data?.results?.[0];
      const result = {
        previewUrl: match?.previewUrl || undefined,
        albumArtUrl: match?.artworkUrl100 || match?.artworkUrl60 || undefined,
        appleMusicUrl: match?.trackViewUrl || undefined,
      };

      this.cache.set(cacheKey, result);
      return result;
    } catch {
      return {};
    }
  }

  /**
   * Search iTunes music directly for user contribution
   */
  public static async searchItunes(query: string): Promise<SoundtrackTrack[]> {
    if (!query || !query.trim()) return [];
    try {
      const q = encodeURIComponent(query.trim());
      const res = await axios.get(
        `https://itunes.apple.com/search?term=${q}&entity=song&limit=12`,
        { timeout: 3500 }
      );
      const results = res.data?.results || [];
      return results.map((item: any, idx: number) => ({
        songName: item.trackName || 'Unknown Title',
        artist: item.artistName || 'Unknown Artist',
        episodeRef: item.collectionName ? `From: ${item.collectionName}` : undefined,
        popularityRank: idx + 1,
        previewUrl: item.previewUrl || undefined,
        albumArtUrl: item.artworkUrl100 || item.artworkUrl60 || undefined,
        spotifyUrl: item.trackViewUrl || undefined,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Universal automated soundtrack discovery:
   * 1. Consults Wikipedia to find the exact soundtrack album / series music articles.
   * 2. Finds the authentic OST album on Apple Music and extracts real tracklist, audio previews & artwork.
   * 3. If no iTunes album exists, parses the track listing from Wikipedia wikitext and enriches with iTunes audio.
   * 4. Enforces strict title verification so unrelated albums (e.g. La La Land) are NEVER matched.
   */
  public static async discoverAlbumSoundtrack(
    titleName: string,
    originalName?: string
  ): Promise<SoundtrackTrack[]> {
    const cleanTitle = titleName.trim();
    const titleLower = cleanTitle.toLowerCase();
    const origLower = (originalName || '').toLowerCase().trim();

    // Primary significant words for verification (ignore stop words)
    const titleWords = titleLower
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'for', 'from', 'with', 'part'].includes(w));

    // 1. Discover soundtrack album articles via Wikipedia Search API
    let wikiCandidates: string[] = [];
    try {
      const wRes = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: `${cleanTitle} soundtrack album OR music`,
          format: 'json',
        },
        headers: { 'User-Agent': 'CineCircleRAD/1.0 (contact@cinecircle.app)' },
        timeout: 4000,
      });
      const items = wRes.data?.query?.search || [];
      wikiCandidates = items
        .map((i: any) => i.title as string)
        .filter((wTitle: string) => {
          const wLower = wTitle.toLowerCase();
          return (
            wLower.includes(titleLower) ||
            (titleWords.length > 0 && titleWords.some((w) => wLower.includes(w)))
          );
        });
    } catch {
      // Continue even if Wikipedia API fails or times out
    }

    // 2. Build prioritized album search queries
    const queries = [
      ...wikiCandidates.slice(0, 3),
      originalName && originalName !== cleanTitle ? `${originalName} OST` : null,
      originalName && originalName !== cleanTitle ? `${originalName} Soundtrack` : null,
      `${cleanTitle} (Original Television Soundtrack)`,
      `${cleanTitle} (Original Motion Picture Soundtrack)`,
      `${cleanTitle} Original Soundtrack`,
      `${cleanTitle} Original Series Soundtrack`,
      `${cleanTitle} Soundtrack`,
      `${cleanTitle} OST`,
      `Music from ${cleanTitle}`,
      cleanTitle,
    ].filter(Boolean) as string[];

    // 3. Search iTunes for a verified album
    for (const q of queries) {
      try {
        const res = await axios.get('https://itunes.apple.com/search', {
          params: { term: q, entity: 'album', limit: 8 },
          timeout: 4000,
        });

        const albums = res.data?.results || [];
        const matchedAlbum = albums.find((a: any) => {
          const name = (a.collectionName || '').toLowerCase();
          const artist = (a.artistName || '').toLowerCase();
          const count = a.trackCount || 0;

          const isSoundtrack =
            name.includes('soundtrack') ||
            name.includes('ost') ||
            name.includes('score') ||
            name.includes('music from') ||
            name.includes('series') ||
            name.includes('original') ||
            artist.includes(titleLower) ||
            artist.includes('soundtrack') ||
            artist.includes('various artists');

          const mentionsTitle =
            name.includes(titleLower) ||
            artist.includes(titleLower) ||
            (origLower && (name.includes(origLower) || artist.includes(origLower))) ||
            (titleWords.length > 0 && titleWords.every((w) => name.includes(w) || artist.includes(w)));

          return isSoundtrack && mentionsTitle && count > 2;
        });

        if (matchedAlbum) {
          const lookup = await axios.get('https://itunes.apple.com/lookup', {
            params: { id: matchedAlbum.collectionId, entity: 'song', limit: 25 },
            timeout: 4000,
          });

          const rawTracks = (lookup.data?.results || []).slice(1);
          if (rawTracks.length > 0) {
            return rawTracks
              .map((item: any, idx: number) => ({
                songName: item.trackName || 'Untitled Track',
                artist: item.artistName || matchedAlbum.artistName,
                episodeRef: `From: ${matchedAlbum.collectionName}`,
                popularityRank: item.trackNumber || idx + 1,
                previewUrl: item.previewUrl || undefined,
                albumArtUrl: item.artworkUrl100 || matchedAlbum.artworkUrl100 || undefined,
                spotifyUrl: item.trackViewUrl || matchedAlbum.collectionViewUrl || undefined,
              }))
              .slice(0, 16);
          }
        }
      } catch {
        // try next candidate
      }
    }

    // 4. Fallback: Parse Wikipedia wikitext track listings if album wasn't on iTunes
    for (const pageTitle of wikiCandidates.slice(0, 2)) {
      try {
        const pRes = await axios.get('https://en.wikipedia.org/w/api.php', {
          params: {
            action: 'parse',
            page: pageTitle,
            prop: 'wikitext',
            format: 'json',
          },
          headers: { 'User-Agent': 'CineCircleRAD/1.0 (contact@cinecircle.app)' },
          timeout: 4000,
        });
        const text = pRes.data?.parse?.wikitext?.['*'] || '';

        const titleRegex = /\|\s*title(\d*)\s*=\s*([^|\n]+)/gi;
        let match;
        const titleMap = new Map<string, string>();
        while ((match = titleRegex.exec(text)) !== null) {
          const idx = match[1] || '1';
          const clean = match[2]
            .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
            .replace(/[[\]"']/g, '')
            .trim();
          titleMap.set(idx, clean);
        }

        const extraRegex = /\|\s*(?:extra|writer|note)(\d*)\s*=\s*([^|\n]+)/gi;
        const extraMap = new Map<string, string>();
        while ((match = extraRegex.exec(text)) !== null) {
          const idx = match[1] || '1';
          const clean = match[2]
            .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
            .replace(/[[\]"']/g, '')
            .trim();
          if (!extraMap.has(idx)) extraMap.set(idx, clean);
        }

        const parsed: { title: string; artist: string }[] = [];
        for (const [idx, tName] of titleMap.entries()) {
          if (tName && !tName.toLowerCase().includes('total length') && tName.length > 1) {
            parsed.push({
              title: tName,
              artist: extraMap.get(idx) || 'Original Soundtrack',
            });
          }
        }

        if (parsed.length > 2) {
          const enriched = await Promise.all(
            parsed.slice(0, 12).map(async (p, idx) => {
              const audio = await this.enrichTrackWithAudio(p.title, p.artist);
              return {
                songName: p.title,
                artist: p.artist,
                episodeRef: `From Soundtrack: ${pageTitle}`,
                popularityRank: idx + 1,
                previewUrl: audio.previewUrl,
                albumArtUrl: audio.albumArtUrl,
                spotifyUrl: audio.appleMusicUrl,
              };
            })
          );
          return enriched;
        }
      } catch {
        // try next
      }
    }

    return [];
  }

  /**
   * Get iconic soundtracks for any movie or TV series automatically.
   * Auto-enriches with official 30-second audio previews & artwork.
   */
  public static async getSoundtracksForTitle(
    titleName: string,
    originalName?: string
  ): Promise<SoundtrackTrack[]> {
    const norm = titleName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

    // 1. Check curated iconic soundtracks first (for titles with bespoke scene descriptions)
    for (const [key, songs] of Object.entries(ICONIC_SOUNDTRACKS)) {
      const formattedKey = key.replace(/_/g, ' ');
      if (norm.includes(formattedKey) || formattedKey.includes(norm)) {
        const enriched = await Promise.all(
          songs.map(async (s) => {
            const audioData = await this.enrichTrackWithAudio(s.songName, s.artist);
            return {
              songName: s.songName,
              artist: s.artist,
              episodeRef: s.episodeRef,
              popularityRank: s.popularityRank,
              previewUrl: audioData.previewUrl,
              albumArtUrl: audioData.albumArtUrl,
              spotifyUrl: audioData.appleMusicUrl,
            };
          })
        );

        // Also attempt to discover and merge any additional album tracks without duplicates
        try {
          const albumTracks = await this.discoverAlbumSoundtrack(titleName, originalName);
          if (albumTracks.length > 0) {
            const seen = new Set(enriched.map((e) => e.songName.toLowerCase().trim()));
            const additional = albumTracks.filter(
              (at) => !seen.has(at.songName.toLowerCase().trim())
            );
            return [...enriched, ...additional].slice(0, 18);
          }
        } catch {
          // keep enriched
        }

        return enriched;
      }
    }

    // 2. Automated Universal Album Discovery (Authentic OST albums across KDramas, Films, Western TV)
    try {
      const albumTracks = await this.discoverAlbumSoundtrack(titleName, originalName);
      if (albumTracks.length > 0) {
        return albumTracks;
      }
    } catch (albumErr: any) {
      console.warn(`[SoundtrackService] Album discovery error for "${titleName}":`, albumErr.message);
    }

    // 3. Fallback: Multi-angle iTunes song search (strictly matching title)
    try {
      const queries = [
        `${titleName} soundtrack`,
        `${titleName} Cast`,
        `${titleName} Original Series Soundtrack`,
      ];

      const searchPromises = queries.map((q) =>
        axios
          .get(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=25`, {
            timeout: 4000,
          })
          .then((res) => res.data?.results || [])
          .catch(() => [])
      );

      const allResultsArrays = await Promise.all(searchPromises);
      const combinedResults = allResultsArrays.flat();

      const seen = new Set<string>();
      const dynamicTracks: SoundtrackTrack[] = [];
      const titleLower = titleName.toLowerCase();

      for (const item of combinedResults) {
        const rawTrack = (item.trackName || '').trim();
        const key = rawTrack.toLowerCase();
        if (!key || seen.has(key)) continue;

        const coll = (item.collectionName || '').toLowerCase();
        const art = (item.artistName || '').toLowerCase();

        // Check if track is genuinely related to this movie/series
        const isRelated = coll.includes(titleLower) || art.includes(titleLower);

        if (isRelated) {
          seen.add(key);
          dynamicTracks.push({
            songName: rawTrack,
            artist: item.artistName || 'Original Soundtrack',
            episodeRef: item.collectionName ? `From: ${item.collectionName}` : 'Featured in Soundtrack',
            popularityRank: dynamicTracks.length + 1,
            previewUrl: item.previewUrl || undefined,
            albumArtUrl: item.artworkUrl100 || item.artworkUrl60 || undefined,
            spotifyUrl: item.trackViewUrl || undefined,
          });

          if (dynamicTracks.length >= 12) break;
        }
      }

      if (dynamicTracks.length > 0) {
        return dynamicTracks;
      }
    } catch {
      // ignore network errors and fallback
    }

    // 4. Fallback generic theme
    const genericTheme = `${titleName} Official Main Theme & Score`;
    const genericAudio = await this.enrichTrackWithAudio(titleName, 'Original Soundtrack');

    return [
      {
        songName: genericTheme,
        artist: 'Original Motion Picture Score',
        episodeRef: 'Main Title / Iconic Theme',
        popularityRank: 1,
        previewUrl: genericAudio.previewUrl,
        albumArtUrl: genericAudio.albumArtUrl,
        spotifyUrl: genericAudio.appleMusicUrl,
      },
    ];
  }

  /**
   * Intelligently match a soundtrack to an episode based on season number, episode number,
   * total episodes in season (e.g. finale detection), and episode name keywords.
   */
  public static matchSongForEpisode(
    songs: SoundtrackTrack[],
    seasonNumber: number,
    episodeNumber: number,
    totalEpisodesInSeason: number,
    episodeName?: string
  ): SoundtrackTrack | undefined {
    if (!songs || songs.length === 0) return undefined;

    const isFinale = episodeNumber === totalEpisodesInSeason && totalEpisodesInSeason > 1;
    const nameLower = (episodeName || '').toLowerCase();

    // 1. Check for exact season finale match
    if (isFinale) {
      const finaleSong = songs.find((s) => {
        const ref = (s.episodeRef || '').toLowerCase();
        return (
          (ref.includes(`season ${seasonNumber}`) || ref.includes(`s${seasonNumber}`)) &&
          (ref.includes('finale') || ref.includes('end') || ref.includes('climax'))
        );
      });
      if (finaleSong) return finaleSong;
    }

    // 2. Check for exact season + episode number match (e.g. "Season 1 Episode 2" or "S1E2")
    const epNumSong = songs.find((s) => {
      const ref = (s.episodeRef || '').toLowerCase();
      const seasonMatch = ref.includes(`season ${seasonNumber}`) || ref.includes(`s${seasonNumber}`);
      const episodeMatch =
        ref.includes(`episode ${episodeNumber}`) ||
        ref.includes(`ep ${episodeNumber}`) ||
        ref.includes(`ep.${episodeNumber}`) ||
        ref.includes(`e${episodeNumber}`);
      return seasonMatch && episodeMatch;
    });
    if (epNumSong) return epNumSong;

    // 3. Check for episode name match (e.g. "Homecoming", "Miss Mystic Falls", "Sweet Hereafter")
    if (episodeName && episodeName.length > 3) {
      const nameSong = songs.find((s) => {
        const ref = (s.episodeRef || '').toLowerCase();
        const words = nameLower
          .replace(/chapter \w+:\s*/gi, '')
          .split(/[\s,–—\-:]+/)
          .filter((w) => w.length > 3 && !['season', 'episode', 'part', 'the', 'and', 'with'].includes(w));
        return words.some((w) => ref.includes(w));
      });
      if (nameSong) return nameSong;
    }

    // 4. Check for any song associated with this season
    const seasonSongs = songs.filter((s) => {
      const ref = (s.episodeRef || '').toLowerCase();
      return ref.includes(`season ${seasonNumber}`) || ref.includes(`s${seasonNumber}`);
    });
    if (seasonSongs.length > 0) {
      return seasonSongs[(episodeNumber - 1) % seasonSongs.length];
    }

    // 5. Fallback: distribute the title's top soundtracks, prioritizing tracks with audio previews
    const tracksWithPreview = songs.filter((s) => s.previewUrl);
    const pool = tracksWithPreview.length > 0 ? tracksWithPreview : songs;
    return pool[(episodeNumber - 1) % pool.length];
  }
}


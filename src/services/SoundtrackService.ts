import axios from 'axios';
import { AiService } from './ai.service';

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
  vampire_diaries: [
    { songName: 'Another Love', artist: 'Tom Odell', episodeRef: 'Season 6 Finale - Elena & Damon Farewell Road Dance', popularityRank: 1 },
    { songName: 'Never Say Never', artist: 'The Fray', episodeRef: 'Season 1 Finale / Elena & Stefan', popularityRank: 2 },
    { songName: 'All I Need', artist: 'Within Temptation', episodeRef: 'Season 1 - Miss Mystic Falls Damon & Elena Dance', popularityRank: 3 },
    { songName: 'A Drop in the Ocean', artist: 'Ron Pope', episodeRef: 'Season 3 - Stefan Birthday Phone Call to Elena', popularityRank: 4 },
    { songName: 'Bloodstream', artist: 'Stateless', episodeRef: 'Season 1 Finale - Damon & Katherine Porch Scene', popularityRank: 5 },
    { songName: 'Skinny Love', artist: 'Birdy', episodeRef: "Season 2 Finale - Jenna's Funeral & John's Letter", popularityRank: 6 },
    { songName: 'Hold On', artist: 'Chord Overstreet', episodeRef: 'Series Finale - Peace in the Afterlife', popularityRank: 7 },
    { songName: 'Feel So Close', artist: 'Calvin Harris', episodeRef: 'Season 4 - College Blood-Feeding Party', popularityRank: 8 },
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
   * Get iconic soundtracks for any movie or TV series.
   * Auto-enriches with official 30-second audio previews & artwork.
   */
  public static async getSoundtracksForTitle(titleName: string): Promise<SoundtrackTrack[]> {
    const norm = titleName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

    // 1. Check curated iconic soundtracks first
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
        return enriched;
      }
    }

    // 2. Query iTunes API directly for dynamic soundtrack discovery
    try {
      const q = encodeURIComponent(`${titleName} soundtrack`);
      const res = await axios.get(
        `https://itunes.apple.com/search?term=${q}&entity=song&limit=6`,
        { timeout: 4000 }
      );

      const items = res.data?.results;
      if (Array.isArray(items) && items.length > 0) {
        return items.map((item: any, idx: number) => ({
          songName: item.trackName || `${titleName} Theme`,
          artist: item.artistName || 'Original Soundtrack',
          episodeRef: item.collectionName ? `From: ${item.collectionName}` : 'Featured in Soundtrack',
          popularityRank: idx + 1,
          previewUrl: item.previewUrl || undefined,
          albumArtUrl: item.artworkUrl100 || item.artworkUrl60 || undefined,
          spotifyUrl: item.trackViewUrl || undefined,
        }));
      }
    } catch {
      // ignore network errors and fallback
    }

    // 3. Fallback generic theme
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
}

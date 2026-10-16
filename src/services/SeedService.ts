import {
  Title,
  WatchProvider,
  SeasonEpisode,
  Soundtrack,
  Comment,
  User,
} from '../models';
import { SEED_TITLES } from '../data/seedTitles';

export class SeedService {
  /**
   * Seeds all initial titles, watch providers, seasons, and soundtracks.
   */
  public static async seedAll(force: boolean = false): Promise<{ titlesCount: number; providersCount: number }> {
    const existingCount = await Title.countDocuments();
    if (existingCount > 0 && !force) {
      console.log(`[SeedService] Titles already exist in database (${existingCount} titles). Skipping initial seed.`);
      return { titlesCount: existingCount, providersCount: await WatchProvider.countDocuments() };
    }

    console.log('[SeedService] Seeding CineCircle catalogue with curated TMDB titles...');

    // Find or create admin user for attribution
    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      adminUser = await User.findOne();
    }

    let titlesSeeded = 0;
    let providersSeeded = 0;

    for (const titleData of SEED_TITLES) {
      // Upsert Title
      const titleDoc = await Title.findOneAndUpdate(
        { tmdbId: titleData.tmdbId },
        {
          tmdbId: titleData.tmdbId,
          name: titleData.name,
          type: titleData.type,
          genres: titleData.genres,
          synopsis: titleData.synopsis,
          runtimeMinutes: titleData.runtimeMinutes,
          releaseYear: titleData.releaseYear,
          voteAverage: titleData.voteAverage,
          posterUrl: titleData.posterUrl,
          backdropUrl: titleData.backdropUrl,
          moodTags: titleData.moodTags,
          cast: titleData.cast,
        },
        { upsert: true, new: true }
      );

      titlesSeeded++;

      // Seed Watch Providers
      if (titleData.watchProviders && titleData.watchProviders.length > 0) {
        for (const wp of titleData.watchProviders) {
          await WatchProvider.findOneAndUpdate(
            { title: titleDoc._id, service: wp.service, region: wp.region },
            {
              title: titleDoc._id,
              service: wp.service,
              region: wp.region,
              type: wp.type,
              sourceUpdatedAt: new Date(),
            },
            { upsert: true }
          );
          providersSeeded++;
        }
      }

      // Seed Seasons & Episodes for TV
      if (titleData.seasons && titleData.seasons.length > 0) {
        for (const season of titleData.seasons) {
          await SeasonEpisode.findOneAndUpdate(
            { title: titleDoc._id, seasonNumber: season.seasonNumber },
            {
              title: titleDoc._id,
              seasonNumber: season.seasonNumber,
              episodes: season.episodes,
            },
            { upsert: true }
          );
        }
      }

      // Seed Soundtracks
      if (titleData.soundtracks && titleData.soundtracks.length > 0 && adminUser) {
        for (const st of titleData.soundtracks) {
          await Soundtrack.findOneAndUpdate(
            { title: titleDoc._id, songName: st.songName },
            {
              title: titleDoc._id,
              songName: st.songName,
              artist: st.artist,
              episodeRef: st.episodeRef,
              popularityRank: st.popularityRank,
              addedBy: adminUser._id,
              // Curated rows are owned by the catalogue, not by auto-discovery,
              // so a refresh never deletes them.
              source: 'curated',
            },
            { upsert: true }
          );
        }
      }
    }

    // Seed initial enthusiast discussion comments
    if (adminUser) {
      const dune = await Title.findOne({ name: 'Dune: Part Two' });
      if (dune) {
        const commentExists = await Comment.findOne({ title: dune._id });
        if (!commentExists) {
          await Comment.create({
            title: dune._id,
            user: adminUser._id,
            text: 'The sound design in IMAX was absolute perfection! Greig Fraser and Hans Zimmer created a masterclass.',
            rating: 5,
            likesCount: 38,
            containsSpoilers: false,
          });
        }
      }

      const theBear = await Title.findOne({ name: 'The Bear' });
      if (theBear) {
        const bearComment = await Comment.findOne({ title: theBear._id });
        if (!bearComment) {
          await Comment.create({
            title: theBear._id,
            user: adminUser._id,
            text: 'Season 1 Episode 7 "Review" is twenty minutes of non-stop adrenaline. Incredible directing!',
            rating: 5,
            likesCount: 29,
            containsSpoilers: false,
          });
        }
      }

      const strangerThings = await Title.findOne({ name: 'Stranger Things' });
      if (strangerThings) {
        const stComment = await Comment.findOne({ title: strangerThings._id });
        if (!stComment) {
          await Comment.create({
            title: strangerThings._id,
            user: adminUser._id,
            text: 'Running Up That Hill in S4E4 is one of the greatest television sequences of the decade. The Duffer Brothers delivered cinema-grade quality.',
            rating: 5,
            likesCount: 42,
            containsSpoilers: false,
          });
          await Comment.create({
            title: strangerThings._id,
            user: adminUser._id,
            text: 'Eddie Munson playing Metallica in the Upside Down is iconic forever.',
            rating: 5,
            likesCount: 27,
            containsSpoilers: true,
          });
        }
      }
    }

    console.log(`[SeedService] Finished seeding ${titlesSeeded} titles and ${providersSeeded} watch providers.`);
    return { titlesCount: titlesSeeded, providersCount: providersSeeded };
  }

  /**
   * Automatically runs on server startup if the Title collection is empty.
   */
  public static async autoSeedIfEmpty(): Promise<void> {
    try {
      const count = await Title.countDocuments();
      if (count === 0) {
        console.log('[SeedService] Database is empty. Initiating automatic catalog seeding...');
        await SeedService.seedAll();
      }
    } catch (err: any) {
      console.error('[SeedService] Auto-seed failed:', err.message);
    }
  }
}

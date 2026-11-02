import prisma from '../config/prisma';
import { SEED_TITLES } from '../data/seedTitles';

export class SeedService {
  /**
   * Seeds all initial titles, watch providers, seasons, and soundtracks.
   */
  public static async seedAll(force: boolean = false): Promise<{ titlesCount: number; providersCount: number }> {
    const existingCount = await prisma.title.count();
    if (existingCount > 0 && !force) {
      console.log(`[SeedService] Titles already exist in database (${existingCount} titles). Skipping initial seed.`);
      return { titlesCount: existingCount, providersCount: await prisma.watchProvider.count() };
    }

    console.log('[SeedService] Seeding CineCircle catalogue with curated TMDB titles in PostgreSQL...');

    let adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!adminUser) {
      adminUser = await prisma.user.findFirst();
    }

    let titlesSeeded = 0;
    let providersSeeded = 0;

    for (const titleData of SEED_TITLES) {
      const titleDoc = await prisma.title.upsert({
        where: { tmdbId: titleData.tmdbId },
        create: {
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
          cast: titleData.cast as any,
        },
        update: {
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
          cast: titleData.cast as any,
        },
      });

      titlesSeeded++;

      if (titleData.watchProviders && titleData.watchProviders.length > 0) {
        for (const wp of titleData.watchProviders) {
          const existingWp = await prisma.watchProvider.findFirst({
            where: {
              titleId: titleDoc.id,
              service: wp.service,
              region: wp.region,
            },
          });

          if (!existingWp) {
            await prisma.watchProvider.create({
              data: {
                titleId: titleDoc.id,
                service: wp.service,
                region: wp.region,
                type: wp.type,
                sourceUpdatedAt: new Date(),
              },
            });
            providersSeeded++;
          }
        }
      }

      if (titleData.seasons && titleData.seasons.length > 0) {
        for (const season of titleData.seasons) {
          await prisma.seasonEpisode.upsert({
            where: {
              titleId_seasonNumber: {
                titleId: titleDoc.id,
                seasonNumber: season.seasonNumber,
              },
            },
            create: {
              titleId: titleDoc.id,
              seasonNumber: season.seasonNumber,
              episodes: season.episodes as any,
            },
            update: {
              episodes: season.episodes as any,
            },
          });
        }
      }

      if (titleData.soundtracks && titleData.soundtracks.length > 0) {
        for (const st of titleData.soundtracks) {
          const existingSt = await prisma.soundtrack.findFirst({
            where: {
              titleId: titleDoc.id,
              songName: st.songName,
            },
          });

          if (!existingSt) {
            await prisma.soundtrack.create({
              data: {
                titleId: titleDoc.id,
                songName: st.songName,
                artist: st.artist,
                episodeRef: st.episodeRef,
                popularityRank: st.popularityRank,
                addedById: adminUser?.id,
                source: 'curated',
              },
            });
          }
        }
      }
    }

    if (adminUser) {
      const dune = await prisma.title.findFirst({ where: { name: 'Dune: Part Two' } });
      if (dune) {
        const commentExists = await prisma.comment.findFirst({ where: { titleId: dune.id } });
        if (!commentExists) {
          await prisma.comment.create({
            data: {
              titleId: dune.id,
              userId: adminUser.id,
              text: 'The sound design in IMAX was absolute perfection! Greig Fraser and Hans Zimmer created a masterclass.',
              rating: 5,
              likesCount: 38,
              containsSpoilers: false,
            },
          });
        }
      }

      const theBear = await prisma.title.findFirst({ where: { name: 'The Bear' } });
      if (theBear) {
        const bearComment = await prisma.comment.findFirst({ where: { titleId: theBear.id } });
        if (!bearComment) {
          await prisma.comment.create({
            data: {
              titleId: theBear.id,
              userId: adminUser.id,
              text: 'Season 1 Episode 7 "Review" is twenty minutes of non-stop adrenaline. Incredible directing!',
              rating: 5,
              likesCount: 29,
              containsSpoilers: false,
            },
          });
        }
      }

      const strangerThings = await prisma.title.findFirst({ where: { name: 'Stranger Things' } });
      if (strangerThings) {
        const stComment = await prisma.comment.findFirst({ where: { titleId: strangerThings.id } });
        if (!stComment) {
          await prisma.comment.create({
            data: {
              titleId: strangerThings.id,
              userId: adminUser.id,
              text: 'Running Up That Hill in S4E4 is one of the greatest television sequences of the decade. The Duffer Brothers delivered cinema-grade quality.',
              rating: 5,
              likesCount: 42,
              containsSpoilers: false,
            },
          });
          await prisma.comment.create({
            data: {
              titleId: strangerThings.id,
              userId: adminUser.id,
              text: 'Eddie Munson playing Metallica in the Upside Down is iconic forever.',
              rating: 5,
              likesCount: 27,
              containsSpoilers: true,
            },
          });
        }
      }
    }

    console.log(`[SeedService] Finished seeding ${titlesSeeded} titles and ${providersSeeded} watch providers into PostgreSQL.`);
    return { titlesCount: titlesSeeded, providersCount: providersSeeded };
  }

  /**
   * Automatically runs on server startup if the Title collection is empty.
   */
  public static async autoSeedIfEmpty(): Promise<void> {
    try {
      const count = await prisma.title.count();
      if (count === 0) {
        console.log('[SeedService] Database is empty. Initiating automatic catalog seeding...');
        await SeedService.seedAll();
      }
    } catch (err: any) {
      console.error('[SeedService] Auto-seed failed:', err.message);
    }
  }
}

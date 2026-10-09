import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Title, Comment, Session, Watchlist, TasteProfile } from '../models';
import { ENV } from '../config/env';

async function seedRichCommunity() {
  console.log('[Seeder] Connecting to MongoDB...');
  await mongoose.connect(ENV.MONGODB_URI);

  console.log('[Seeder] Verifying titles in DB...');
  const titles = await Title.find().limit(10).lean();
  if (titles.length === 0) {
    console.error('No titles found in DB. Please run title seeding first.');
    process.exit(1);
  }

  // 1. Create or ensure realistic community users
  const dummyUsersData = [
    {
      name: 'Marcus Vance',
      email: 'marcus.v@cinecircle.test',
      role: 'admin',
      genres: ['Science Fiction', 'Thriller', 'Drama'],
    },
    {
      name: 'Elena Rostova',
      email: 'elena.films@cinecircle.test',
      role: 'user',
      genres: ['Drama', 'Mystery', 'Romance'],
    },
    {
      name: 'Jordan Hayes',
      email: 'jordan.h@cinecircle.test',
      role: 'user',
      genres: ['Action', 'Comedy', 'Adventure'],
    },
    {
      name: 'Maya Chen',
      email: 'maya.c@cinecircle.test',
      role: 'admin',
      genres: ['Animation', 'Fantasy', 'Science Fiction'],
    },
  ];

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

  const seededUsers = [];
  for (const u of dummyUsersData) {
    let existing = await User.findOne({ email: u.email });
    if (!existing) {
      existing = await User.create({
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
        subscribedServices: ['Netflix', 'Max', 'Prime Video'],
      });
      await TasteProfile.create({
        user: existing._id,
        favoriteGenres: u.genres,
        favoriteTitles: [titles[0]._id, titles[1]._id],
        exclusions: ['Horror'],
      });
    }
    seededUsers.push(existing);
  }

  console.log(`[Seeder] Seeded/Verified ${seededUsers.length} community users.`);

  // 2. Create rich community reviews / feed posts
  const dune = titles.find((t) => t.name.includes('Dune')) || titles[0];
  const oppenheimer = titles.find((t) => t.name.includes('Oppenheimer')) || titles[1 % titles.length];
  const spiderVerse = titles.find((t) => t.name.includes('Spider')) || titles[2 % titles.length];
  const strangerThings = titles.find((t) => t.name.includes('Stranger')) || titles[3 % titles.length];

  const reviewItems = [
    {
      user: seededUsers[0]._id,
      title: dune._id,
      text: 'The sound design and sheer visual scale in the second half left our whole circle speechless. A monumental piece of modern sci-fi cinema.',
      rating: 5,
      likesCount: 38,
      poll: {
        question: 'Which sequence was more intense?',
        options: [
          { optionText: 'The Sandworm Ride', votes: [seededUsers[1]._id, seededUsers[2]._id] },
          { optionText: 'The Final Duel with Feyd-Rautha', votes: [seededUsers[3]._id] },
        ],
      },
    },
    {
      user: seededUsers[1]._id,
      title: oppenheimer._id,
      text: 'Nolan crafts an unbearable tension out of boardroom interrogations and radio silence. Ludwig Göransson’s score is practically a lead character.',
      rating: 5,
      likesCount: 52,
    },
    {
      user: seededUsers[2]._id,
      title: spiderVerse._id,
      text: 'Every single frame belongs in an art gallery. The multiverse sequence in Mumbattan and Gwen’s opening watercolor world set a new benchmark.',
      rating: 5,
      likesCount: 44,
      poll: {
        question: 'Best Spider-Verse soundtrack track?',
        options: [
          { optionText: 'Mona Lisa (Dominic Fike)', votes: [seededUsers[0]._id] },
          { optionText: 'Am I Dreaming (Metro Boomin / A$AP Rocky)', votes: [seededUsers[1]._id, seededUsers[2]._id] },
        ],
      },
    },
    {
      user: seededUsers[3]._id,
      title: strangerThings._id,
      text: 'Rewatching the Season 4 climax with Kate Bush’s Running Up That Hill. Unbeatable television craftsmanship and nostalgic comfort.',
      rating: 4,
      likesCount: 29,
    },
  ];

  for (const rev of reviewItems) {
    const existing = await Comment.findOne({ user: rev.user, title: rev.title });
    if (!existing) {
      await Comment.create(rev);
    }
  }

  console.log('[Seeder] Community reviews & discussion polls verified in database.');

  // 3. Create active group watch sessions
  const activeSessionsData = [
    {
      name: 'Friday Night Sci-Fi Debates',
      joinCode: 'SCI890',
      host: seededUsers[0]._id,
      participants: [seededUsers[0]._id, seededUsers[1]._id, seededUsers[2]._id, seededUsers[3]._id],
      shortlist: [dune._id, oppenheimer._id, spiderVerse._id],
      status: 'open',
      constraints: { maxRuntime: 160, moodFilter: 'Mind-Bending' },
    },
    {
      name: 'Comfort Rewatch Circle',
      joinCode: 'COM412',
      host: seededUsers[1]._id,
      participants: [seededUsers[1]._id, seededUsers[2]._id],
      shortlist: [strangerThings._id, titles[4 % titles.length]._id],
      status: 'open',
      constraints: { maxRuntime: 100, moodFilter: 'Comfort' },
    },
    {
      name: 'Weekend Thriller Session',
      joinCode: 'THR771',
      host: seededUsers[2]._id,
      participants: [seededUsers[2]._id, seededUsers[3]._id],
      shortlist: [oppenheimer._id, dune._id],
      status: 'open',
      constraints: { maxRuntime: 180, moodFilter: 'Gripping' },
    },
  ];

  for (const s of activeSessionsData) {
    const existing = await Session.findOne({ joinCode: s.joinCode });
    if (!existing) {
      await Session.create(s);
    }
  }

  console.log('[Seeder] Active group watch sessions verified in database.');

  // 4. Seed user watchlist entries
  const mainUser = await User.findOne({ email: 'lasandisalwathura@gmail.com' });
  if (mainUser) {
    const userWatchlistSeeds = [
      { user: mainUser._id, title: dune._id, watched: true, starRating: 5, addedAt: new Date(Date.now() - 86400000 * 3) },
      { user: mainUser._id, title: oppenheimer._id, watched: false, addedAt: new Date(Date.now() - 86400000 * 2) },
      { user: mainUser._id, title: spiderVerse._id, watched: true, starRating: 5, addedAt: new Date(Date.now() - 86400000) },
      { user: mainUser._id, title: strangerThings._id, watched: false, addedAt: new Date() },
    ];

    for (const item of userWatchlistSeeds) {
      await Watchlist.findOneAndUpdate(
        { user: item.user, title: item.title },
        item,
        { upsert: true, new: true }
      );
    }
    console.log(`[Seeder] Seeded starter watchlist for ${mainUser.email}.`);
  }

  console.log('🎉 [Seeder] Rich community data successfully seeded!');
  process.exit(0);
}

seedRichCommunity().catch((err) => {
  console.error('[Seeder] Error seeding data:', err);
  process.exit(1);
});

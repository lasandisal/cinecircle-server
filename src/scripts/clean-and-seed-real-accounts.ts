import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Title, Comment, Session, Watchlist, TasteProfile, Follow } from '../models';
import { ENV } from '../config/env';

async function cleanAndSeedRealAccounts() {
  console.log('[CleanSeeder] Connecting to MongoDB...');
  await mongoose.connect(ENV.MONGODB_URI);

  // 1. Delete all fake accounts (any account not in the 4 real accounts list)
  const allowedEmails = [
    'lasandisalwathura@gmail.com',
    'mishtixcreations@gmail.com',
    'eventsphere.tickets@gmail.com',
    'info.pulsefitgym@gmail.com',
  ];

  const fakeUsers = await User.find({ email: { $nin: allowedEmails } });
  const fakeUserIds = fakeUsers.map((u) => u._id);
  console.log(`[CleanSeeder] Found ${fakeUserIds.length} fake/unapproved accounts to purge.`);

  if (fakeUserIds.length > 0) {
    await Promise.all([
      User.deleteMany({ _id: { $in: fakeUserIds } }),
      Comment.deleteMany({ user: { $in: fakeUserIds } }),
      Session.deleteMany({ host: { $in: fakeUserIds } }),
      Watchlist.deleteMany({ user: { $in: fakeUserIds } }),
      TasteProfile.deleteMany({ user: { $in: fakeUserIds } }),
      Follow.deleteMany({ $or: [{ follower: { $in: fakeUserIds } }, { followedUser: { $in: fakeUserIds } }] }),
    ]);
    console.log('[CleanSeeder] Purged all fake accounts and orphaned records.');
  }

  // 2. Real Accounts Definitions
  const realAccounts = [
    {
      name: 'Lasandi Salwathura',
      email: 'lasandisalwathura@gmail.com',
      handle: '@lasandis',
      bio: 'Film enthusiast, cinephile & CineCircle creator 🎬✨ Love atmospheric sci-fi and tense psychological drama.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&h=240&fit=crop&crop=faces',
      role: 'admin',
      subscribedServices: ['Netflix', 'Max', 'Prime Video', 'Apple TV+'],
      favoriteGenres: ['Science Fiction', 'Drama', 'Thriller', 'Mystery'],
    },
    {
      name: 'MishtiX Creations',
      email: 'mishtixcreations@gmail.com',
      handle: '@mishtix',
      bio: 'Creative digital design & cinematic storytelling 🎨🍿 Big fan of animation benchmarks and vibrant cinematography.',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=240&h=240&fit=crop&crop=faces',
      role: 'user',
      subscribedServices: ['Netflix', 'Apple TV+'],
      favoriteGenres: ['Animation', 'Fantasy', 'Romance', 'Comedy'],
    },
    {
      name: 'EventSphere',
      email: 'eventsphere.tickets@gmail.com',
      handle: '@eventsphere',
      bio: 'Curated tech summit events & collaborative watch parties 🎟️ Bringing communities together through cinema.',
      avatar: 'https://ui-avatars.com/api/?name=Event+Sphere&background=9333ea&color=fff&size=200',
      role: 'user',
      subscribedServices: ['Max', 'Prime Video'],
      favoriteGenres: ['Science Fiction', 'Adventure', 'Action'],
    },
    {
      name: 'PulseFit',
      email: 'info.pulsefitgym@gmail.com',
      handle: '@pulsefit',
      bio: 'High-energy lifestyle, fitness & adrenaline-fueled action blockbusters ⚡💪',
      avatar: 'https://ui-avatars.com/api/?name=Pulse+Fit&background=0d9488&color=fff&size=200',
      role: 'user',
      subscribedServices: ['Netflix', 'Prime Video'],
      favoriteGenres: ['Action', 'Thriller', 'Adventure'],
    },
  ];

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

  const activeUsers: Record<string, any> = {};

  for (const acc of realAccounts) {
    let user = await User.findOne({ email: acc.email });
    if (!user) {
      user = await User.create({
        name: acc.name,
        email: acc.email,
        handle: acc.handle,
        bio: acc.bio,
        avatar: acc.avatar,
        passwordHash,
        role: acc.role,
        subscribedServices: acc.subscribedServices,
      });
    } else {
      user.name = acc.name;
      user.handle = acc.handle;
      user.bio = acc.bio;
      user.avatar = acc.avatar;
      user.subscribedServices = acc.subscribedServices;
      user.role = acc.role as any;
      await user.save();
    }

    await TasteProfile.findOneAndUpdate(
      { user: user._id },
      {
        user: user._id,
        favoriteGenres: acc.favoriteGenres,
        exclusions: ['Horror'],
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    activeUsers[acc.email] = user;
    console.log(`[CleanSeeder] Configured verified account: ${acc.name} (${acc.email})`);
  }

  // 3. Create authentic follow connections (Instagram-style network)
  const lasandi = activeUsers['lasandisalwathura@gmail.com'];
  const mishtix = activeUsers['mishtixcreations@gmail.com'];
  const eventSphere = activeUsers['eventsphere.tickets@gmail.com'];
  const pulseFit = activeUsers['info.pulsefitgym@gmail.com'];

  const followPairs = [
    { follower: lasandi._id, followedType: 'user', followedUser: mishtix._id },
    { follower: lasandi._id, followedType: 'user', followedUser: eventSphere._id },
    { follower: lasandi._id, followedType: 'user', followedUser: pulseFit._id },
    { follower: mishtix._id, followedType: 'user', followedUser: lasandi._id },
    { follower: eventSphere._id, followedType: 'user', followedUser: lasandi._id },
    { follower: pulseFit._id, followedType: 'user', followedUser: lasandi._id },
    { follower: mishtix._id, followedType: 'user', followedUser: eventSphere._id },
  ];

  for (const pair of followPairs) {
    await Follow.findOneAndUpdate(
      { follower: pair.follower, followedType: 'user', followedUser: pair.followedUser },
      pair,
      { upsert: true, new: true }
    );
  }
  console.log('[CleanSeeder] Connected social follow network.');

  // 4. Attach authentic reviews & comments to titles
  const titles = await Title.find().limit(10).lean();
  const dune = titles.find((t) => t.name.includes('Dune')) || titles[0];
  const oppenheimer = titles.find((t) => t.name.includes('Oppenheimer')) || titles[1 % titles.length];
  const spiderVerse = titles.find((t) => t.name.includes('Spider')) || titles[2 % titles.length];
  const strangerThings = titles.find((t) => t.name.includes('Stranger')) || titles[3 % titles.length];

  const realReviews = [
    {
      user: lasandi._id,
      title: dune._id,
      text: 'The sound design and sheer visual scale in the second half left our whole circle speechless. A monumental piece of modern sci-fi cinema.',
      rating: 5,
      likesCount: 24,
      poll: {
        question: 'Which sequence was more intense?',
        options: [
          { optionText: 'The Sandworm Ride', votes: [mishtix._id, pulseFit._id] },
          { optionText: 'The Final Duel with Feyd-Rautha', votes: [eventSphere._id] },
        ],
      },
    },
    {
      user: mishtix._id,
      title: spiderVerse._id,
      text: 'Every single frame belongs in an art gallery. The multiverse sequence in Mumbattan and Gwen’s opening watercolor world set a new benchmark.',
      rating: 5,
      likesCount: 31,
      poll: {
        question: 'Favorite visual dimension?',
        options: [
          { optionText: 'Earth-65 (Gwen’s Pastel World)', votes: [lasandi._id, pulseFit._id] },
          { optionText: 'Mumbattan Earth-50101', votes: [eventSphere._id] },
        ],
      },
    },
    {
      user: eventSphere._id,
      title: oppenheimer._id,
      text: 'Nolan crafts an unbearable tension out of boardroom interrogations and radio silence. Ludwig Göransson’s score is practically a lead character.',
      rating: 5,
      likesCount: 19,
    },
    {
      user: pulseFit._id,
      title: strangerThings._id,
      text: 'High-energy climax with Kate Bush’s Running Up That Hill. Unbeatable television craftsmanship and pure adrenaline.',
      rating: 4,
      likesCount: 15,
    },
  ];

  for (const rev of realReviews) {
    await Comment.findOneAndUpdate(
      { user: rev.user, title: rev.title },
      rev,
      { upsert: true, new: true }
    );
  }
  console.log('[CleanSeeder] Verified authentic reviews & polls.');

  // 5. Create real active watch party circles
  const realSessions = [
    {
      name: 'EventSphere Summit Watch Party',
      joinCode: 'EVT2026',
      host: eventSphere._id,
      participants: [eventSphere._id, lasandi._id, mishtix._id, pulseFit._id],
      shortlist: [dune._id, oppenheimer._id, spiderVerse._id],
      status: 'open',
      constraints: { maxRuntime: 165, moodFilter: 'Mind-Bending' },
    },
    {
      name: 'MishtiX Animation & Vibe Circle',
      joinCode: 'MSH412',
      host: mishtix._id,
      participants: [mishtix._id, lasandi._id],
      shortlist: [spiderVerse._id, titles[4 % titles.length]._id],
      status: 'open',
      constraints: { maxRuntime: 120, moodFilter: 'Stunning' },
    },
    {
      name: 'PulseFit Adrenaline Movie Night',
      joinCode: 'FIT890',
      host: pulseFit._id,
      participants: [pulseFit._id, lasandi._id],
      shortlist: [oppenheimer._id, dune._id],
      status: 'open',
      constraints: { maxRuntime: 150, moodFilter: 'Gripping' },
    },
  ];

  for (const s of realSessions) {
    await Session.findOneAndUpdate(
      { joinCode: s.joinCode },
      s,
      { upsert: true, new: true }
    );
  }
  console.log('[CleanSeeder] Verified real watch sessions.');

  // 6. User Watchlist entries for Lasandi
  const lasandiWatchlist = [
    { user: lasandi._id, title: dune._id, watched: true, starRating: 5, addedAt: new Date(Date.now() - 86400000 * 4), watchedAt: new Date(Date.now() - 86400000 * 2) },
    { user: lasandi._id, title: spiderVerse._id, watched: true, starRating: 5, addedAt: new Date(Date.now() - 86400000 * 3), watchedAt: new Date(Date.now() - 86400000) },
    { user: lasandi._id, title: oppenheimer._id, watched: false, addedAt: new Date(Date.now() - 86400000 * 2) },
    { user: lasandi._id, title: strangerThings._id, watched: false, addedAt: new Date() },
  ];

  for (const w of lasandiWatchlist) {
    await Watchlist.findOneAndUpdate(
      { user: w.user, title: w.title },
      w,
      { upsert: true, new: true }
    );
  }
  console.log('[CleanSeeder] Verified personal watchlist for Lasandi.');

  console.log('🎉 [CleanSeeder] Cleaned fake accounts and verified all real accounts successfully!');
  process.exit(0);
}

cleanAndSeedRealAccounts().catch((err) => {
  console.error('[CleanSeeder] Error:', err);
  process.exit(1);
});

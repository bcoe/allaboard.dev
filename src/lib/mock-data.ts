import { Climb, User, Session, ClimberStats, FeedActivity } from "./types";

// ─── Climbs ──────────────────────────────────────────────────────────────────

export const mockClimbs: Climb[] = [
  {
    id: "1",
    name: "The Crimson Project",
    grade: "V8",
    boardId: "kilter-original",
    boardName: "Kilter Board (Original)",
    angle: 40,
    description:
      "Sick compression problem on the Kilter. Start matched on the two crimps at the bottom, move to the big sidepull, then top out on the jug rail. Felt way harder than the grade — watch the beta carefully.",
    author: "alex_sends",
    setter: "Tony Lamiche",
    createdAt: "2026-03-12T14:32:00Z",
    sends: 3,
    betaVideos: [
      { url: "https://www.instagram.com/reel/abc123/", thumbnail: "https://picsum.photos/seed/crimsona/320/320" },
      { url: "https://www.instagram.com/reel/abc456/", thumbnail: "https://picsum.photos/seed/crimsonb/320/320" },
    ],
  },
  {
    id: "2",
    name: "Moonpig Direct",
    grade: "V6",
    boardId: "moonboard-2016",
    boardName: "Moonboard 2016",
    angle: 40,
    description:
      "Classic Moonboard movement — sharp crimps and big moves. Set at 40 degrees. The crux is the move from H7 to J9 — keep your hips in and trust the feet.",
    author: "beth_climbs",
    setter: "Shawn Raboutou",
    createdAt: "2026-03-11T09:15:00Z",
    sends: 8,
    betaVideos: [
      { url: "https://www.instagram.com/reel/moon1/", thumbnail: "https://picsum.photos/seed/moonpiga/320/320" },
      { url: "https://www.instagram.com/reel/moon2/", thumbnail: "https://picsum.photos/seed/moonpigb/320/320" },
      { url: "https://www.instagram.com/reel/moon3/", thumbnail: "https://picsum.photos/seed/moonpigc/320/320" },
    ],
  },
  {
    id: "3",
    name: "Footwork Fundamentals",
    grade: "V4",
    boardId: "kilter-original",
    boardName: "Kilter Board (Original)",
    angle: 20,
    description:
      "A technical low-angle problem focused entirely on precise footwork and balance. Uses the full width of the board — great warmup for dialling in your feet before projecting.",
    author: "carlos_v",
    setter: "Carlo Traversi",
    createdAt: "2026-03-10T18:00:00Z",
    sends: 14,
    betaVideos: [
      { url: "https://www.instagram.com/reel/foot1/", thumbnail: "https://picsum.photos/seed/footworka/320/320" },
    ],
  },
  {
    id: "4",
    name: "Undercling Universe",
    grade: "V10",
    boardId: "kilter-original",
    boardName: "Kilter Board (Original)",
    angle: 45,
    description:
      "One of the hardest problems I've ever tried. Every hold is an undercling. The core tension required is insane. Finally got it after 80+ attempts — the key is keeping tension through the lower body the entire way.",
    author: "diana_proj",
    setter: "Daniel Woods",
    createdAt: "2026-03-09T20:45:00Z",
    sends: 1,
    betaVideos: [
      { url: "https://www.instagram.com/reel/under1/", thumbnail: "https://picsum.photos/seed/underclinga/320/320" },
    ],
  },
  {
    id: "5",
    name: "Slopey Sunday",
    grade: "V5",
    boardId: "kilter-original",
    boardName: "Kilter Board (Original)",
    angle: 25,
    description:
      "Super fun sloper problem. Low angle but the holds are incredibly polished. Great for training body tension and high feet. The finish sloper is a real test of shoulder stability.",
    author: "eli_boulders",
    setter: "Nalle Hukkataival",
    createdAt: "2026-03-08T11:30:00Z",
    sends: 4,
    betaVideos: [
      { url: "https://www.instagram.com/reel/slop1/", thumbnail: "https://picsum.photos/seed/slopya/320/320" },
      { url: "https://www.instagram.com/reel/slop2/", thumbnail: "https://picsum.photos/seed/slopyb/320/320" },
    ],
  },
  {
    id: "6",
    name: "Gaston Alley",
    grade: "V7",
    boardId: "kilter-original",
    boardName: "Kilter Board (Original)",
    angle: 35,
    description:
      "All gastons, all day. Shoulder-intensive but incredibly satisfying. Film yourself — you'll learn a lot about your body positioning and why you keep barn-dooring off the crux.",
    author: "beth_climbs",
    setter: "Jimmy Webb",
    createdAt: "2026-03-07T17:00:00Z",
    sends: 2,
    betaVideos: [
      { url: "https://www.instagram.com/reel/gast1/", thumbnail: "https://picsum.photos/seed/gastona/320/320" },
      { url: "https://www.instagram.com/reel/gast2/", thumbnail: "https://picsum.photos/seed/gastonb/320/320" },
    ],
  },
];

// ─── Users ────────────────────────────────────────────────────────────────────

export const mockUsers: User[] = [
  {
    id: "alex_sends",
    handle: "alex_sends",
    displayName: "Alex Hernandez",
    avatarColor: "bg-orange-500",
    bio: "Projecting V9 compression. Mostly Kilter, occasional Moonboard. Coach at Vertical World.",
    homeBoard: "Kilter Board (Original)",
    homeBoardAngle: 40,
    joinedAt: "2024-09-01",
    followersCount: 34,
    followingCount: 12,
    personalBests: { "Kilter Board (Original)": "V8", "Moonboard 2016": "V6" },
  },
  {
    id: "beth_climbs",
    handle: "beth_climbs",
    displayName: "Beth Nakamura",
    avatarColor: "bg-violet-500",
    bio: "Moonboard obsessive. Slab refugee. V7 and chasing V8.",
    homeBoard: "Moonboard 2016",
    homeBoardAngle: 40,
    joinedAt: "2024-11-15",
    followersCount: 58,
    followingCount: 22,
    personalBests: { "Moonboard 2016": "V7", "Kilter Board (Original)": "V6" },
  },
  {
    id: "carlos_v",
    handle: "carlos_v",
    displayName: "Carlos Vega",
    avatarColor: "bg-teal-500",
    bio: "Coach + setter. Loves heel hooks and technical footwork.",
    homeBoard: "Kilter Board (Original)",
    homeBoardAngle: 30,
    joinedAt: "2025-01-20",
    followersCount: 41,
    followingCount: 18,
    personalBests: { "Kilter Board (Original)": "V6", "Moonboard 2016": "V5" },
  },
  {
    id: "diana_proj",
    handle: "diana_proj",
    displayName: "Diana Osei",
    avatarColor: "bg-pink-500",
    bio: "Professional dreamer, amateur sender. V10 or bust.",
    homeBoard: "Kilter Board (Original)",
    homeBoardAngle: 45,
    joinedAt: "2024-06-10",
    followersCount: 112,
    followingCount: 34,
    personalBests: { "Kilter Board (Original)": "V10", "Moonboard 2016": "V8" },
  },
  {
    id: "eli_boulders",
    handle: "eli_boulders",
    displayName: "Eli Park",
    avatarColor: "bg-cyan-500",
    bio: "Low-angle technique nerd. If it's not a sloper, is it even climbing?",
    homeBoard: "Kilter Board (Original)",
    homeBoardAngle: 25,
    joinedAt: "2025-03-05",
    followersCount: 27,
    followingCount: 9,
    personalBests: { "Kilter Board (Original)": "V6", "Moonboard 2016": "V5" },
  },
];

export function getUserByHandle(handle: string): User | undefined {
  return mockUsers.find((u) => u.handle === handle);
}

// ─── Sessions (for alex_sends) ────────────────────────────────────────────────

export const mockSessions: Session[] = [
  {
    id: "s1",
    userId: "alex_sends",
    date: "2026-01-05",
    boardType: "Kilter Board (Original)",
    angle: 40,
    durationMinutes: 90,
    feelRating: 3,
    logEntries: [
      { id: "l1", climbId: "1", userId: "alex_sends", date: "2026-01-05", attempts: 8, sent: false },
      { id: "l2", climbId: "3", userId: "alex_sends", date: "2026-01-05", attempts: 3, sent: true },
      { id: "l3", climbId: "5", userId: "alex_sends", date: "2026-01-05", attempts: 4, sent: true },
    ],
  },
  {
    id: "s2",
    userId: "alex_sends",
    date: "2026-01-08",
    boardType: "Kilter Board (Original)",
    angle: 40,
    durationMinutes: 75,
    feelRating: 4,
    logEntries: [
      { id: "l4", climbId: "1", userId: "alex_sends", date: "2026-01-08", attempts: 10, sent: false },
      { id: "l5", climbId: "6", userId: "alex_sends", date: "2026-01-08", attempts: 6, sent: false },
      { id: "l6", climbId: "2", userId: "alex_sends", date: "2026-01-08", attempts: 4, sent: true },
    ],
  },
  {
    id: "s3",
    userId: "alex_sends",
    date: "2026-01-14",
    boardType: "Moonboard 2016",
    angle: 40,
    durationMinutes: 60,
    feelRating: 2,
    logEntries: [
      { id: "l7", climbId: "2", userId: "alex_sends", date: "2026-01-14", attempts: 5, sent: true },
      { id: "l8", climbId: "3", userId: "alex_sends", date: "2026-01-14", attempts: 3, sent: true },
      { id: "l9", climbId: "5", userId: "alex_sends", date: "2026-01-14", attempts: 2, sent: true },
    ],
  },
];

// ─── Stats ────────────────────────────────────────────────────────────────────

export const mockStats: ClimberStats = {
  userId: "alex_sends",
  gradePyramid: [
    { grade: "V8", sends: 1 },
    { grade: "V7", sends: 2 },
    { grade: "V6", sends: 4 },
    { grade: "V5", sends: 7 },
    { grade: "V4", sends: 12 },
    { grade: "V3", sends: 18 },
    { grade: "V2", sends: 7 },
  ],
  sessionFrequency: [
    { weekLabel: "Jan 5",  sessionCount: 2 },
    { weekLabel: "Jan 12", sessionCount: 1 },
    { weekLabel: "Jan 19", sessionCount: 2 },
    { weekLabel: "Jan 26", sessionCount: 1 },
    { weekLabel: "Feb 2",  sessionCount: 1 },
    { weekLabel: "Feb 9",  sessionCount: 2 },
  ],
  progressOverTime: [
    { month: "Nov 2025", highestGradeSent: "V5", totalSends: 8 },
    { month: "Dec 2025", highestGradeSent: "V6", totalSends: 11 },
    { month: "Jan 2026", highestGradeSent: "V7", totalSends: 14 },
    { month: "Feb 2026", highestGradeSent: "V8", totalSends: 16 },
    { month: "Mar 2026", highestGradeSent: "V8", totalSends: 9 },
  ],
  attemptsVsSends: [
    { climbId: "1", climbName: "The Crimson Project",   grade: "V8",  attempts: 47, sends: 3 },
    { climbId: "2", climbName: "Moonpig Direct",         grade: "V6",  attempts: 12, sends: 8 },
    { climbId: "3", climbName: "Footwork Fundamentals",  grade: "V4",  attempts: 5,  sends: 5 },
    { climbId: "4", climbName: "Undercling Universe",    grade: "V10", attempts: 83, sends: 0 },
    { climbId: "5", climbName: "Slopey Sunday",          grade: "V5",  attempts: 9,  sends: 4 },
    { climbId: "6", climbName: "Gaston Alley",           grade: "V7",  attempts: 22, sends: 2 },
  ],
  totalSends: 47,
  totalAttempts: 312,
  currentStreak: 4,
};

// ─── Feed Activities ───────────────────────────────────────────────────────────

const byHandle = (h: string) => mockUsers.find((u) => u.handle === h)!;
const byId = (id: string) => mockClimbs.find((c) => c.id === id)!;

export const mockFeedActivities: FeedActivity[] = [
  {
    id: "fa1",
    user: byHandle("diana_proj"),
    climb: byId("4"),
    date: new Date(Date.now() - 1 * 3600000).toISOString(),
    sent: true,
    rating: 4,
    comment: "Finally sent Undercling Universe after months of work. I'm shaking.",
  },
  {
    id: "fa2",
    user: byHandle("beth_climbs"),
    climb: byId("2"),
    date: new Date(Date.now() - 5 * 3600000).toISOString(),
    sent: true,
    rating: 3,
    comment: "Moonpig flash attempt went sideways but got it 3rd go.",
  },
  {
    id: "fa3",
    user: byHandle("carlos_v"),
    climb: byId("3"),
    date: new Date(Date.now() - 18 * 3600000).toISOString(),
    sent: false,
    rating: 2,
    comment: "Wrist was tweaky, had to bail early. Back on it next session.",
  },
  {
    id: "fa4",
    user: byHandle("eli_boulders"),
    climb: byId("5"),
    date: new Date(Date.now() - 26 * 3600000).toISOString(),
    sent: true,
    rating: 4,
  },
  {
    id: "fa5",
    user: byHandle("beth_climbs"),
    climb: byId("6"),
    date: new Date(Date.now() - 48 * 3600000).toISOString(),
    sent: false,
    rating: 2,
    comment: "Gaston Alley is kicking my ass. Shoulder endurance needs work.",
  },
];

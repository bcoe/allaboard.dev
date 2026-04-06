import type { Knex } from "knex";

// Fixed UUIDs for deterministic seeding
const CLIMB_IDS: Record<string, string> = {
  "1": "c1000000-0000-0000-0000-000000000001",
  "2": "c1000000-0000-0000-0000-000000000002",
  "3": "c1000000-0000-0000-0000-000000000003",
  "4": "c1000000-0000-0000-0000-000000000004",
  "5": "c1000000-0000-0000-0000-000000000005",
  "6": "c1000000-0000-0000-0000-000000000006",
};

const SESSION_IDS: Record<string, string> = {
  s1:  "a0000000-0000-0000-0000-000000000001",
  s2:  "a0000000-0000-0000-0000-000000000002",
  s3:  "a0000000-0000-0000-0000-000000000003",
  s4:  "a0000000-0000-0000-0000-000000000004",
  s5:  "a0000000-0000-0000-0000-000000000005",
  s6:  "a0000000-0000-0000-0000-000000000006",
  s7:  "a0000000-0000-0000-0000-000000000007",
  s8:  "a0000000-0000-0000-0000-000000000008",
  s9:  "a0000000-0000-0000-0000-000000000009",
  s10: "a0000000-0000-0000-0000-000000000010",
  s11: "a0000000-0000-0000-0000-000000000011",
  s12: "a0000000-0000-0000-0000-000000000012",
};

const LOG_IDS: Record<string, string> = {
  l1:  "b0000000-0000-0000-0000-000000000001",
  l2:  "b0000000-0000-0000-0000-000000000002",
  l3:  "b0000000-0000-0000-0000-000000000003",
  l4:  "b0000000-0000-0000-0000-000000000004",
  l5:  "b0000000-0000-0000-0000-000000000005",
  l6:  "b0000000-0000-0000-0000-000000000006",
  l7:  "b0000000-0000-0000-0000-000000000007",
  l8:  "b0000000-0000-0000-0000-000000000008",
  l9:  "b0000000-0000-0000-0000-000000000009",
  l10: "b0000000-0000-0000-0000-000000000010",
  l11: "b0000000-0000-0000-0000-000000000011",
  l12: "b0000000-0000-0000-0000-000000000012",
  l13: "b0000000-0000-0000-0000-000000000013",
  l14: "b0000000-0000-0000-0000-000000000014",
  l15: "b0000000-0000-0000-0000-000000000015",
  l16: "b0000000-0000-0000-0000-000000000016",
  l17: "b0000000-0000-0000-0000-000000000017",
  l18: "b0000000-0000-0000-0000-000000000018",
  l19: "b0000000-0000-0000-0000-000000000019",
  l20: "b0000000-0000-0000-0000-000000000020",
  l21: "b0000000-0000-0000-0000-000000000021",
  l22: "b0000000-0000-0000-0000-000000000022",
  l23: "b0000000-0000-0000-0000-000000000023",
  l24: "b0000000-0000-0000-0000-000000000024",
  l25: "b0000000-0000-0000-0000-000000000025",
  l26: "b0000000-0000-0000-0000-000000000026",
  l27: "b0000000-0000-0000-0000-000000000027",
  l28: "b0000000-0000-0000-0000-000000000028",
  l29: "b0000000-0000-0000-0000-000000000029",
  l30: "b0000000-0000-0000-0000-000000000030",
  l31: "b0000000-0000-0000-0000-000000000031",
  l32: "b0000000-0000-0000-0000-000000000032",
  l33: "b0000000-0000-0000-0000-000000000033",
  l34: "b0000000-0000-0000-0000-000000000034",
  l35: "b0000000-0000-0000-0000-000000000035",
  l36: "b0000000-0000-0000-0000-000000000036",
  l37: "b0000000-0000-0000-0000-000000000037",
  l38: "b0000000-0000-0000-0000-000000000038",
  l39: "b0000000-0000-0000-0000-000000000039",
};

export async function seed(knex: Knex): Promise<void> {
  // Clear in reverse FK order
  await knex("log_entries").del();
  await knex("sessions").del();
  await knex("beta_videos").del();
  await knex("climbs").del();
  await knex("users").del();

  // ── Users ────────────────────────────────────────────────────────────────────
  await knex("users").insert([
    {
      id: "alex_sends", handle: "alex_sends", display_name: "Alex Hernandez",
      avatar_color: "bg-orange-500",
      bio: "Projecting V9 compression. Mostly Kilter, occasional Moonboard. Coach at Vertical World.",
      home_board: "Kilter", home_board_angle: 40, joined_at: "2024-09-01",
      followers_count: 34, following_count: 12,
      personal_best_kilter: "V8", personal_best_moonboard: "V6",
    },
    {
      id: "beth_climbs", handle: "beth_climbs", display_name: "Beth Nakamura",
      avatar_color: "bg-violet-500",
      bio: "Moonboard obsessive. Slab refugee. V7 and chasing V8.",
      home_board: "Moonboard", home_board_angle: 40, joined_at: "2024-11-15",
      followers_count: 58, following_count: 22,
      personal_best_moonboard: "V7", personal_best_kilter: "V6",
    },
    {
      id: "carlos_v", handle: "carlos_v", display_name: "Carlos Vega",
      avatar_color: "bg-teal-500",
      bio: "Coach + setter. Loves heel hooks and technical footwork.",
      home_board: "Kilter", home_board_angle: 30, joined_at: "2025-01-20",
      followers_count: 41, following_count: 18,
      personal_best_kilter: "V6", personal_best_moonboard: "V5",
    },
    {
      id: "diana_proj", handle: "diana_proj", display_name: "Diana Osei",
      avatar_color: "bg-pink-500",
      bio: "Professional dreamer, amateur sender. V10 or bust.",
      home_board: "Kilter", home_board_angle: 45, joined_at: "2024-06-10",
      followers_count: 112, following_count: 34,
      personal_best_kilter: "V10", personal_best_moonboard: "V8",
    },
    {
      id: "eli_boulders", handle: "eli_boulders", display_name: "Eli Park",
      avatar_color: "bg-cyan-500",
      bio: "Low-angle technique nerd. If it's not a sloper, is it even climbing?",
      home_board: "Kilter", home_board_angle: 25, joined_at: "2025-03-05",
      followers_count: 27, following_count: 9,
      personal_best_kilter: "V6", personal_best_moonboard: "V5",
    },
  ]);

  // ── Climbs ───────────────────────────────────────────────────────────────────
  await knex("climbs").insert([
    {
      id: CLIMB_IDS["1"], name: "The Crimson Project", grade: "V8",
      board_id: "kilter-original", angle: 40,
      description: "Sick compression problem on the Kilter. Start matched on the two crimps at the bottom, move to the big sidepull, then top out on the jug rail. Felt way harder than the grade — watch the beta carefully.",
      author: "alex_sends", setter: "Tony Lamiche", sends: 3,
      created_at: "2026-03-12T14:32:00Z",
    },
    {
      id: CLIMB_IDS["2"], name: "Moonpig Direct", grade: "V6",
      board_id: "moonboard-2016", angle: 40,
      description: "Classic Moonboard movement — sharp crimps and big moves. Set at 40 degrees. The crux is the move from H7 to J9 — keep your hips in and trust the feet.",
      author: "beth_climbs", setter: "Shawn Raboutou", sends: 8,
      created_at: "2026-03-11T09:15:00Z",
    },
    {
      id: CLIMB_IDS["3"], name: "Footwork Fundamentals", grade: "V4",
      board_id: "kilter-original", angle: 20,
      description: "A technical low-angle problem focused entirely on precise footwork and balance. Uses the full width of the board — great warmup for dialling in your feet before projecting.",
      author: "carlos_v", setter: "Carlo Traversi", sends: 14,
      created_at: "2026-03-10T18:00:00Z",
    },
    {
      id: CLIMB_IDS["4"], name: "Undercling Universe", grade: "V10",
      board_id: "kilter-original", angle: 45,
      description: "One of the hardest problems I've ever tried. Every hold is an undercling. The core tension required is insane. Finally got it after 80+ attempts — the key is keeping tension through the lower body the entire way.",
      author: "diana_proj", setter: "Daniel Woods", sends: 1,
      created_at: "2026-03-09T20:45:00Z",
    },
    {
      id: CLIMB_IDS["5"], name: "Slopey Sunday", grade: "V5",
      board_id: "kilter-original", angle: 25,
      description: "Super fun sloper problem. Low angle but the holds are incredibly polished. Great for training body tension and high feet. The finish sloper is a real test of shoulder stability.",
      author: "eli_boulders", setter: "Nalle Hukkataival", sends: 4,
      created_at: "2026-03-08T11:30:00Z",
    },
    {
      id: CLIMB_IDS["6"], name: "Gaston Alley", grade: "V7",
      board_id: "kilter-original", angle: 35,
      description: "All gastons, all day. Shoulder-intensive but incredibly satisfying. Film yourself — you'll learn a lot about your body positioning and why you keep barn-dooring off the crux.",
      author: "beth_climbs", setter: "Jimmy Webb", sends: 2,
      created_at: "2026-03-07T17:00:00Z",
    },
  ]);

  // ── Beta Videos ──────────────────────────────────────────────────────────────
  await knex("beta_videos").insert([
    { climb_id: CLIMB_IDS["1"], url: "https://www.instagram.com/reel/abc123/", thumbnail: "https://picsum.photos/seed/crimsona/320/320", sort_order: 0 },
    { climb_id: CLIMB_IDS["1"], url: "https://www.instagram.com/reel/abc456/", thumbnail: "https://picsum.photos/seed/crimsonb/320/320", sort_order: 1 },
    { climb_id: CLIMB_IDS["2"], url: "https://www.instagram.com/reel/moon1/", thumbnail: "https://picsum.photos/seed/moonpiga/320/320", sort_order: 0 },
    { climb_id: CLIMB_IDS["2"], url: "https://www.instagram.com/reel/moon2/", thumbnail: "https://picsum.photos/seed/moonpigb/320/320", sort_order: 1 },
    { climb_id: CLIMB_IDS["2"], url: "https://www.instagram.com/reel/moon3/", thumbnail: "https://picsum.photos/seed/moonpigc/320/320", sort_order: 2 },
    { climb_id: CLIMB_IDS["3"], url: "https://www.instagram.com/reel/foot1/", thumbnail: "https://picsum.photos/seed/footworka/320/320", sort_order: 0 },
    { climb_id: CLIMB_IDS["4"], url: "https://www.instagram.com/reel/under1/", thumbnail: "https://picsum.photos/seed/underclinga/320/320", sort_order: 0 },
    { climb_id: CLIMB_IDS["5"], url: "https://www.instagram.com/reel/slop1/", thumbnail: "https://picsum.photos/seed/slopya/320/320", sort_order: 0 },
    { climb_id: CLIMB_IDS["5"], url: "https://www.instagram.com/reel/slop2/", thumbnail: "https://picsum.photos/seed/slopyb/320/320", sort_order: 1 },
    { climb_id: CLIMB_IDS["6"], url: "https://www.instagram.com/reel/gast1/", thumbnail: "https://picsum.photos/seed/gastona/320/320", sort_order: 0 },
    { climb_id: CLIMB_IDS["6"], url: "https://www.instagram.com/reel/gast2/", thumbnail: "https://picsum.photos/seed/gastonb/320/320", sort_order: 1 },
  ]);

  // ── Sessions ─────────────────────────────────────────────────────────────────
  await knex("sessions").insert([
    { id: SESSION_IDS.s1,  user_id: "alex_sends", date: "2026-01-05", board_type: "Kilter",    angle: 40, duration_minutes: 90,  feel_rating: 3 },
    { id: SESSION_IDS.s2,  user_id: "alex_sends", date: "2026-01-08", board_type: "Kilter",    angle: 40, duration_minutes: 75,  feel_rating: 4 },
    { id: SESSION_IDS.s3,  user_id: "alex_sends", date: "2026-01-14", board_type: "Moonboard", angle: 40, duration_minutes: 60,  feel_rating: 2 },
    { id: SESSION_IDS.s4,  user_id: "alex_sends", date: "2026-01-19", board_type: "Kilter",    angle: 40, duration_minutes: 105, feel_rating: 5 },
    { id: SESSION_IDS.s5,  user_id: "alex_sends", date: "2026-01-26", board_type: "Kilter",    angle: 40, duration_minutes: 90,  feel_rating: 4 },
    { id: SESSION_IDS.s6,  user_id: "alex_sends", date: "2026-02-02", board_type: "Kilter",    angle: 20, duration_minutes: 60,  feel_rating: 3 },
    { id: SESSION_IDS.s7,  user_id: "alex_sends", date: "2026-02-09", board_type: "Kilter",    angle: 40, duration_minutes: 120, feel_rating: 5 },
    { id: SESSION_IDS.s8,  user_id: "alex_sends", date: "2026-02-16", board_type: "Kilter",    angle: 40, duration_minutes: 90,  feel_rating: 4 },
    { id: SESSION_IDS.s9,  user_id: "alex_sends", date: "2026-02-23", board_type: "Kilter",    angle: 25, duration_minutes: 75,  feel_rating: 3 },
    { id: SESSION_IDS.s10, user_id: "alex_sends", date: "2026-03-02", board_type: "Kilter",    angle: 40, duration_minutes: 90,  feel_rating: 4 },
    { id: SESSION_IDS.s11, user_id: "alex_sends", date: "2026-03-09", board_type: "Kilter",    angle: 45, duration_minutes: 105, feel_rating: 5 },
    { id: SESSION_IDS.s12, user_id: "alex_sends", date: "2026-03-12", board_type: "Kilter",    angle: 40, duration_minutes: 90,  feel_rating: 4 },
  ]);

  // ── Log Entries ───────────────────────────────────────────────────────────────
  await knex("log_entries").insert([
    // s1 – 2026-01-05
    { id: LOG_IDS.l1,  session_id: SESSION_IDS.s1,  climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-01-05", attempts: 8,  sent: false },
    { id: LOG_IDS.l2,  session_id: SESSION_IDS.s1,  climb_id: CLIMB_IDS["3"], user_id: "alex_sends", date: "2026-01-05", attempts: 3,  sent: true },
    { id: LOG_IDS.l3,  session_id: SESSION_IDS.s1,  climb_id: CLIMB_IDS["5"], user_id: "alex_sends", date: "2026-01-05", attempts: 4,  sent: true },
    // s2 – 2026-01-08
    { id: LOG_IDS.l4,  session_id: SESSION_IDS.s2,  climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-01-08", attempts: 10, sent: false },
    { id: LOG_IDS.l5,  session_id: SESSION_IDS.s2,  climb_id: CLIMB_IDS["6"], user_id: "alex_sends", date: "2026-01-08", attempts: 6,  sent: false },
    { id: LOG_IDS.l6,  session_id: SESSION_IDS.s2,  climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-01-08", attempts: 4,  sent: true },
    // s3 – 2026-01-14
    { id: LOG_IDS.l7,  session_id: SESSION_IDS.s3,  climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-01-14", attempts: 5,  sent: true },
    { id: LOG_IDS.l8,  session_id: SESSION_IDS.s3,  climb_id: CLIMB_IDS["3"], user_id: "alex_sends", date: "2026-01-14", attempts: 3,  sent: true },
    { id: LOG_IDS.l9,  session_id: SESSION_IDS.s3,  climb_id: CLIMB_IDS["5"], user_id: "alex_sends", date: "2026-01-14", attempts: 2,  sent: true },
    // s4 – 2026-01-19
    { id: LOG_IDS.l10, session_id: SESSION_IDS.s4,  climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-01-19", attempts: 12, sent: false },
    { id: LOG_IDS.l11, session_id: SESSION_IDS.s4,  climb_id: CLIMB_IDS["6"], user_id: "alex_sends", date: "2026-01-19", attempts: 5,  sent: true, notes: "Finally got the gaston sequence!" },
    { id: LOG_IDS.l12, session_id: SESSION_IDS.s4,  climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-01-19", attempts: 2,  sent: true },
    { id: LOG_IDS.l13, session_id: SESSION_IDS.s4,  climb_id: CLIMB_IDS["5"], user_id: "alex_sends", date: "2026-01-19", attempts: 3,  sent: true },
    // s5 – 2026-01-26
    { id: LOG_IDS.l14, session_id: SESSION_IDS.s5,  climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-01-26", attempts: 7,  sent: false },
    { id: LOG_IDS.l15, session_id: SESSION_IDS.s5,  climb_id: CLIMB_IDS["4"], user_id: "alex_sends", date: "2026-01-26", attempts: 15, sent: false },
    { id: LOG_IDS.l16, session_id: SESSION_IDS.s5,  climb_id: CLIMB_IDS["3"], user_id: "alex_sends", date: "2026-01-26", attempts: 2,  sent: true },
    // s6 – 2026-02-02
    { id: LOG_IDS.l17, session_id: SESSION_IDS.s6,  climb_id: CLIMB_IDS["3"], user_id: "alex_sends", date: "2026-02-02", attempts: 1,  sent: true },
    { id: LOG_IDS.l18, session_id: SESSION_IDS.s6,  climb_id: CLIMB_IDS["5"], user_id: "alex_sends", date: "2026-02-02", attempts: 3,  sent: true },
    { id: LOG_IDS.l19, session_id: SESSION_IDS.s6,  climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-02-02", attempts: 6,  sent: false },
    // s7 – 2026-02-09
    { id: LOG_IDS.l20, session_id: SESSION_IDS.s7,  climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-02-09", attempts: 6,  sent: true, notes: "Finally cracked it! Hip position was the key." },
    { id: LOG_IDS.l21, session_id: SESSION_IDS.s7,  climb_id: CLIMB_IDS["4"], user_id: "alex_sends", date: "2026-02-09", attempts: 18, sent: false },
    { id: LOG_IDS.l22, session_id: SESSION_IDS.s7,  climb_id: CLIMB_IDS["6"], user_id: "alex_sends", date: "2026-02-09", attempts: 3,  sent: true },
    { id: LOG_IDS.l23, session_id: SESSION_IDS.s7,  climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-02-09", attempts: 2,  sent: true },
    // s8 – 2026-02-16
    { id: LOG_IDS.l24, session_id: SESSION_IDS.s8,  climb_id: CLIMB_IDS["4"], user_id: "alex_sends", date: "2026-02-16", attempts: 20, sent: false },
    { id: LOG_IDS.l25, session_id: SESSION_IDS.s8,  climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-02-16", attempts: 3,  sent: true },
    { id: LOG_IDS.l26, session_id: SESSION_IDS.s8,  climb_id: CLIMB_IDS["6"], user_id: "alex_sends", date: "2026-02-16", attempts: 4,  sent: true },
    // s9 – 2026-02-23
    { id: LOG_IDS.l27, session_id: SESSION_IDS.s9,  climb_id: CLIMB_IDS["5"], user_id: "alex_sends", date: "2026-02-23", attempts: 2,  sent: true },
    { id: LOG_IDS.l28, session_id: SESSION_IDS.s9,  climb_id: CLIMB_IDS["3"], user_id: "alex_sends", date: "2026-02-23", attempts: 1,  sent: true },
    { id: LOG_IDS.l29, session_id: SESSION_IDS.s9,  climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-02-23", attempts: 5,  sent: true },
    // s10 – 2026-03-02
    { id: LOG_IDS.l30, session_id: SESSION_IDS.s10, climb_id: CLIMB_IDS["4"], user_id: "alex_sends", date: "2026-03-02", attempts: 14, sent: false },
    { id: LOG_IDS.l31, session_id: SESSION_IDS.s10, climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-03-02", attempts: 3,  sent: true },
    { id: LOG_IDS.l32, session_id: SESSION_IDS.s10, climb_id: CLIMB_IDS["6"], user_id: "alex_sends", date: "2026-03-02", attempts: 2,  sent: true },
    { id: LOG_IDS.l33, session_id: SESSION_IDS.s10, climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-03-02", attempts: 4,  sent: true },
    // s11 – 2026-03-09
    { id: LOG_IDS.l34, session_id: SESSION_IDS.s11, climb_id: CLIMB_IDS["4"], user_id: "alex_sends", date: "2026-03-09", attempts: 10, sent: false, notes: "Getting closer on the crux undercling" },
    { id: LOG_IDS.l35, session_id: SESSION_IDS.s11, climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-03-09", attempts: 2,  sent: true },
    { id: LOG_IDS.l36, session_id: SESSION_IDS.s11, climb_id: CLIMB_IDS["6"], user_id: "alex_sends", date: "2026-03-09", attempts: 1,  sent: true },
    // s12 – 2026-03-12
    { id: LOG_IDS.l37, session_id: SESSION_IDS.s12, climb_id: CLIMB_IDS["1"], user_id: "alex_sends", date: "2026-03-12", attempts: 4,  sent: true },
    { id: LOG_IDS.l38, session_id: SESSION_IDS.s12, climb_id: CLIMB_IDS["4"], user_id: "alex_sends", date: "2026-03-12", attempts: 11, sent: false },
    { id: LOG_IDS.l39, session_id: SESSION_IDS.s12, climb_id: CLIMB_IDS["2"], user_id: "alex_sends", date: "2026-03-12", attempts: 3,  sent: true },
  ]);
}

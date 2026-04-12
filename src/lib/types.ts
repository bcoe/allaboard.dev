export type Grade =
  | "V0" | "V1" | "V2" | "V3" | "V4" | "V5" | "V5+" | "V6" | "V7" | "V8" | "V8+"
  | "V9" | "V10" | "V11" | "V12" | "V13" | "V14" | "V15" | "V16"
  | "V17" | "V18";

export interface Board {
  id: string;                      // text slug, e.g. 'kilter-original'
  name: string;                    // e.g. 'Kilter Board (Original)'
  type: "standard" | "spray_wall";
  relativeDifficulty: number;      // scaling factor relative to 1.0 baseline
  location?: string;               // spray walls only
  description?: string;            // spray walls only
  createdBy?: string;              // handle of the user who added it; null for pre-seeded boards
}

export interface BetaVideo {
  url: string;
  submittedBy: string; // handle of the user who ticked with this video
}

export interface Tick {
  id: string;
  climbId: string;
  userId: string;
  suggestedGrade?: Grade;
  rating: 1 | 2 | 3 | 4;
  comment?: string;
  instagramUrl?: string;
  sent: boolean;
  attempts?: number;   // null/undefined = "a bunch"
  date: string;        // date the tick happened (YYYY-MM-DD)
  createdAt: string;
}

/** A tick as shown on a climb's detail page — includes the author's handle. */
export interface ClimbTick {
  id: string;
  userHandle: string;
  userDisplayName: string;
  userAvatarColor: string;
  userProfilePictureUrl?: string;
  suggestedGrade?: Grade;
  rating: number;
  comment?: string;
  instagramUrl?: string;
  sent: boolean;
  attempts?: number;
  date: string;
  createdAt: string;
}

export interface UserTick {
  id: string;
  climbId: string;
  climbName: string;
  grade: Grade;
  boardName: string;
  angle: number;
  suggestedGrade?: Grade;
  rating: number;
  comment?: string;
  instagramUrl?: string;
  sent: boolean;
  attempts?: number;
  date: string;
  createdAt: string;
}

export interface Climb {
  id: string;
  name: string;
  grade: Grade;
  boardId: string;
  boardName: string;
  angle: number;       // 0–90; default 40
  description: string;
  betaVideos?: BetaVideo[];
  author: string;      // handle of the user who submitted it
  setter?: string;     // free-form route setter name
  starRating?: number; // aggregated avg from ticks.rating
  sends: number;
  createdAt: string;
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  profilePictureUrl?: string;
  bio: string;
  homeBoard: string;
  homeBoardAngle: number;
  joinedAt: string;
  followersCount: number;
  followingCount: number;
  personalBests: Partial<Record<string, Grade>>;
  /** Only present when the authenticated user fetches their own profile. */
  apiToken?: string;
}

export interface LogEntry {
  id: string;
  climbId: string;
  userId: string;
  date: string;
  attempts: number;
  sent: boolean;
  notes?: string;
}

export interface Session {
  id: string;
  userId: string;
  date: string;
  boardType: string;
  angle: number;
  durationMinutes: number;
  logEntries: LogEntry[];
  feelRating: 1 | 2 | 3 | 4 | 5;
}

export interface ClimberStats {
  userId: string;
  gradePyramid: { grade: Grade; sends: number }[];
  sessionFrequency: { weekLabel: string; sessionCount: number }[];
  progressOverTime: { month: string; highestGradeSent: Grade; totalSends: number }[];
  attemptsVsSends: {
    climbId: string;
    climbName: string;
    grade: Grade;
    attempts: number;
    sends: number;
  }[];
  totalSends: number;
  totalAttempts: number;
  currentStreak: number;
}

export interface FeedActivity {
  id: string;
  user: User;
  climb: Climb;
  date: string;        // date of the tick
  sent: boolean;
  rating: number;
  attempts?: number;   // null/undefined = "a bunch"
  comment?: string;
  suggestedGrade?: Grade;
  instagramUrl?: string;
}

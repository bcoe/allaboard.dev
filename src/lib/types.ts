export type Grade =
  | "V0" | "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8"
  | "V9" | "V10" | "V11" | "V12" | "V13" | "V14" | "V15" | "V16";

export type BoardType = "Kilter" | "Moonboard";

export interface BetaVideo {
  url: string;
  thumbnail: string;
  platform: "instagram" | "youtube";
  credit?: string; // e.g. "@alex_sends"
}

export interface Climb {
  id: string;
  name: string;
  grade: Grade;
  boardType: BoardType;
  angle?: number;
  description: string;
  betaVideos?: BetaVideo[];
  author: string;       // handle of the user who submitted it
  setter?: string;      // common name of the route setter
  createdAt: string;
  sends?: number;
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string; // tailwind bg color class for placeholder avatar
  bio: string;
  homeBoard: BoardType;
  homeBoardAngle: number;
  joinedAt: string;
  followersCount: number;
  followingCount: number;
  personalBests: Partial<Record<BoardType, Grade>>;
}

export interface LogEntry {
  id: string;
  climbId: string;
  userId: string;
  date: string; // ISO date "2026-03-12"
  attempts: number;
  sent: boolean;
  notes?: string;
}

export interface Session {
  id: string;
  userId: string;
  date: string;
  boardType: BoardType;
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
  date: string;
  attempts: number;
  sent: boolean;
  notes?: string;
}

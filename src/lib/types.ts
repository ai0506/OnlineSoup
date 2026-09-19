export type Profile = {
  id: string;
  display_name: string;
  username: string | null;
  points: number;
};

export type Room = {
  id: string;
  code: string;
  name: string;
  status: "waiting" | "playing" | "closed";
  max_members: number;
  points_per_seat: number;
  owner_id: string;
  created_at: string;
};

export type RoomSeat = {
  id: string;
  seat_number: number;
  nickname: string | null;
  user_id: string | null;
  remaining_points: number;
  hint_tokens: number;
  occupied_at: string | null;
  /** Returned only by protected room-state reads. */
  is_current_user?: boolean;
};

export type RoomMemberState = {
  room: Omit<Room, "owner_id" | "created_at"> & { is_owner: boolean };
  seat_id: string;
  seats: RoomSeat[];
  personal_points: number | null;
  requires_password: boolean;
};

export type MessageMode = "chat" | "ask" | "hint" | "reason";

export type RoomMessage = {
  id: number;
  room_id: string;
  seat_id: string;
  sender_name: string;
  sender_seat_number: number;
  sender_type: "registered" | "guest";
  message_type: "chat" | "system" | "ai";
  message_mode: MessageMode;
  content: string;
  puzzle_id?: number | null;
  created_at: string;
};

export type RoomChatBootstrap = {
  realtime_topic: string;
  messages: RoomMessage[];
  seat_id?: string | null;
};

export type PuzzleListItem = {
  id: number;
  title: string;
  surface: string;
  difficulty: string;
  played: boolean;
  solved: boolean;
};

export type CurrentPuzzle = {
  id: number;
  title: string;
  surface: string;
  difficulty: string;
  solved: boolean;
};

export type PointsTransactionType =
  | "signup_bonus"
  | "room_reservation"
  | "room_refund"
  | "gift_sent"
  | "seat_query"
  | "admin_adjustment";

export type PointsTransaction = {
  id: number;
  type: PointsTransactionType;
  amount: number;
  balance_after: number;
  created_at: string;
  login_location: string | null;
  login_device: string | null;
  room_name: string | null;
};

export type SolvedPuzzle = {
  id: number;
  title: string;
  difficulty: string;
  solved_at: string;
};

export type ProfilePageData = {
  profile: {
    username: string | null;
    display_name: string;
    points: number;
    created_at: string;
    last_login_location: string | null;
    last_login_device: string | null;
    last_login_at: string | null;
  };
  stats: {
    ask_count: number;
    hint_count: number;
    reason_count: number;
  };
  solved_puzzles: SolvedPuzzle[];
};

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

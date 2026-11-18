import type { StreamAudioMode, StreamPreset } from "../desktop/types";
import { apiRequest } from "./httpClient";

export interface ParticipantPresenceDto {
  userId: string;
  displayName: string;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  screenShareIdentity: string | null;
  screenShareHasAudio: boolean;
  joinedAtUtc: string;
}

export interface RoomSummaryDto {
  id: string;
  name: string;
  displayOrder: number;
  maxParticipants: number;
  participants: ParticipantPresenceDto[];
}

export interface JoinRoomTokenResponseDto {
  token: string;
  livekitUrl: string;
  roomId: string;
  identity: string;
}

export interface ScreenshareTokenResponseDto {
  token: string;
  livekitUrl: string;
  identity: string;
}

export async function fetchRooms(): Promise<RoomSummaryDto[]> {
  const raw = await apiRequest<RoomSummaryDto[] | { rooms: RoomSummaryDto[] }>(
    "/api/rooms",
    {
      method: "GET",
    }
  );
  return Array.isArray(raw) ? raw : raw.rooms;
}

export async function issueRoomVoiceToken(
  roomId: string
): Promise<JoinRoomTokenResponseDto> {
  return apiRequest<JoinRoomTokenResponseDto>(
    `/api/rooms/${roomId}/voice-token`,
    {
      method: "POST",
    }
  );
}

export async function issueRoomScreenshareToken(
  roomId: string,
  preset: StreamPreset,
  audioMode: StreamAudioMode
): Promise<ScreenshareTokenResponseDto> {
  return apiRequest<ScreenshareTokenResponseDto>(
    `/api/rooms/${roomId}/screenshare-token`,
    {
      method: "POST",
      body: JSON.stringify({ preset, audioMode }),
    }
  );
}

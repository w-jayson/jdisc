import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import { useDesktopSettingsStore } from "../../stores/desktopSettingsStore";
import { useRoomStore } from "../../stores/roomStore";
import { getApiBaseUrl } from "../api/httpClient";
import type { RoomSummaryDto } from "../api/roomsApi";

export interface ParticipantAudioStateChangedPayload {
  roomId: string;
  userId: string;
  isMuted: boolean;
  isDeafened: boolean;
}

class SignalRPresenceService {
  private connection: HubConnection | null = null;

  public async connect(): Promise<void> {
    const token =
      useDesktopSettingsStore.getState().settings.authSession?.accessToken;
    if (!token) {
      return;
    }

    if (
      this.connection &&
      this.connection.state !== HubConnectionState.Disconnected
    ) {
      return;
    }

    const hubUrl = `${getApiBaseUrl()}/hubs/presence`;
    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () =>
          useDesktopSettingsStore.getState().settings.authSession
            ?.accessToken ?? "",
      })
      .withAutomaticReconnect([0, 1000, 2000, 5000, 10000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on(
      "RoomsSnapshotUpdated",
      (payload: RoomSummaryDto[] | { rooms?: RoomSummaryDto[] }) => {
        if (Array.isArray(payload)) {
          useRoomStore.getState().setRooms(payload);
        } else if (payload && Array.isArray(payload.rooms)) {
          useRoomStore.getState().setRooms(payload.rooms);
        }
      }
    );

    this.connection.on(
      "ParticipantAudioStateChanged",
      (payload: ParticipantAudioStateChangedPayload) => {
        if (payload?.roomId && payload?.userId) {
          useRoomStore
            .getState()
            .updateParticipantAudioState(
              payload.roomId,
              payload.userId,
              Boolean(payload.isMuted),
              Boolean(payload.isDeafened)
            );
        }
      }
    );

    await this.connection.start();
  }

  public async reportLocalAudioState(
    roomId: string,
    isMuted: boolean,
    isDeafened: boolean
  ): Promise<void> {
    if (
      !this.connection ||
      this.connection.state !== HubConnectionState.Connected
    ) {
      return;
    }

    try {
      await this.connection.invoke("ReportLocalAudioState", {
        roomId,
        isMuted,
        isDeafened,
      });
    } catch {
      // Non-fatal if hub is reconnecting
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.connection) {
      return;
    }
    try {
      await this.connection.stop();
    } finally {
      this.connection = null;
    }
  }
}

export const signalrService = new SignalRPresenceService();

import { useCallback, useEffect, useState } from "react";
import { fetchRooms } from "../services/api/roomsApi";
import { signalrService } from "../services/realtime/signalrService";
import { useAuthStore } from "../stores/authStore";
import { useRoomStore } from "../stores/roomStore";

export function usePresenceHub() {
  const session = useAuthStore((s) => s.session);
  const setRooms = useRoomStore((s) => s.setRooms);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const refreshRooms = useCallback(async () => {
    if (!session) return;
    setLoadingRooms(true);
    setRoomsError(null);
    try {
      const rooms = await fetchRooms();
      setRooms(rooms);
    } catch (err) {
      setRoomsError(
        err instanceof Error
          ? err.message
          : "Falha ao carregar lista de salas de voz."
      );
    } finally {
      setLoadingRooms(false);
    }
  }, [session, setRooms]);

  useEffect(() => {
    if (!session) {
      void signalrService.disconnect();
      setRooms([]);
      return;
    }

    void refreshRooms();
    void signalrService.connect().catch(() => {
      // Initial HTTP snapshot already covers room state if hub takes time
    });

    return () => {
      void signalrService.disconnect();
    };
  }, [session, refreshRooms, setRooms]);

  return {
    loadingRooms,
    roomsError,
    refreshRooms,
  };
}

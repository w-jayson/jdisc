# Contrato Backend: Minimal APIs, SignalR Hub & LiveKit Tokens/Webhooks

**Feature**: `001-jdisc-mvp` | **Date**: 2026-11-13

## 1. Endpoints Minimal API (ASP.NET Core .NET 10)

### 1.1 Autenticação (`/api/auth`)
- `POST /api/auth/register` (Público):
  - Body: `{ displayName, email, password, inviteCode }`
  - Valida `inviteCode` contra variável de ambiente `INVITE_CODE` (erro `403` se inválido/ausente), unicidade de `email` (`409`), cria `User` no PostgreSQL e retorna `{ accessToken, expiresAt, user: { id, displayName, email } }`.
- `POST /api/auth/login` (Público):
  - Body: `{ email, password }`
  - Valida hash de senha e retorna `{ accessToken, expiresAt, user }` (`401` se inválido).
- `GET /api/auth/me` (Requer JWT): retorna dados do usuário autenticado.

### 1.2 Salas e Tokens LiveKit (`/api/rooms`, Requer JWT)
- `GET /api/rooms`:
  - Retorna lista fixa de salas (`Geral`, `Jogatina`, `AFK`) combinando metadados do PostgreSQL + lista atual de participantes lida do Redis (`ParticipantPresence[]`).
- `POST /api/rooms/{roomId}/voice-token`:
  - Verifica se `roomId` existe (`404`).
  - Verifica capacidade atual no Redis (`< 10`, ou se usuário já está nessa mesma sala). Se `>= 10` e usuário não está na sala, retorna `409 Conflict` com `{ code: "ROOM_FULL", message: "Sala cheia — máximo 10 participantes" }`.
  - Emite JWT LiveKit (`HS256` via `System.IdentityModel.Tokens.Jwt`) para `identity = userId` com `canPublish: true`, `canSubscribe: true`, `canPublishSources: ["microphone"]`, `room: roomId`.
  - Retorna `{ token, livekitUrl, roomId }`.
- `POST /api/rooms/{roomId}/screenshare-token`:
  - Verifica se `roomId` existe (`404`) e se `userId` está conectado na sala `roomId` no Redis (`403` se não estiver).
  - Emite JWT LiveKit (`HS256`) para `identity = "<userId>:screenshare"`, `metadata = {"parentUserId":"<userId>","kind":"screenshare"}`, `canPublish: true`, `canSubscribe: false`, `canPublishSources: ["screen_share", "screen_share_audio"]`.
  - Retorna `{ token, livekitUrl, identity: "<userId>:screenshare" }`.

### 1.3 Webhooks & Health
- `POST /api/webhooks/livekit` (Autenticado via assinatura JWT/HMAC-SHA256 no header `Authorization` usando `LIVEKIT_API_SECRET`):
  - Único autor de escrita de presença de mídia no Redis.
  - Trata `participant_joined`, `participant_left`, `track_published`, `track_unpublished` com normalização de `{userId}:screenshare` -> `parentUserId`.
  - Dispara broadcast SignalR `RoomsSnapshotUpdated` para todos os clientes autenticados conectados.
- `GET /health`: Health check cobrindo API, PostgreSQL, Redis e conectividade HTTP com o LiveKit.

## 2. SignalR Hub (`/hubs/presence`, Requer JWT)

- **Server → Client (Broadcast)**:
  - `RoomsSnapshotUpdated(rooms: RoomPresenceDto[])`: enviado ao conectar e após cada processamento de webhook no Redis.
  - `ParticipantAudioStateChanged({ roomId, userId, isMuted, isDeafened })`: sinalização leve de UI em tempo real.
- **Client → Server (UI Signaling apenas — PROIBIDO escrever presença de mídia no Redis)**:
  - `ReportLocalAudioState({ roomId, isMuted, isDeafened })`: retransmite estado visual de mute/deafen aos participantes conectados.

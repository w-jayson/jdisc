# Data Model: jdisc MVP Unificado

**Feature**: `001-jdisc-mvp` | **Date**: 2026-11-13

## 1. Dados Persistentes no PostgreSQL (Entity Framework Core)

### 1.1 `User`
| Campo | Tipo | Regras |
|---|---|---|
| `Id` | `Guid` (PK) | Identificador único usado como `identity` no LiveKit (`userId`) |
| `DisplayName` | `string` (max 50) | Obrigatório, não vazio |
| `Email` | `string` (max 255) | Obrigatório, único (índice `UNIQUE`), normalizado em lowercase |
| `PasswordHash` | `string` | Hash seguro via `PasswordHasher<User>` / PBKDF2/Argon2 |
| `CreatedAtUtc` | `DateTimeOffset` | Timestamp UTC de criação |

### 1.2 `VoiceRoom` (Pré-seeded: "Geral", "Jogatina", "AFK")
| Campo | Tipo | Regras |
|---|---|---|
| `Id` | `string` (PK, slug) | Ex.: `"geral"`, `"jogatina"`, `"afk"` |
| `Name` | `string` (max 50) | Nome exibido na UI (`"Geral"`, `"Jogatina"`, `"AFK"`) |
| `DisplayOrder` | `int` | Ordem fixa de exibição (1, 2, 3) |
| `MaxParticipants` | `int` | Constante de domínio `10` |

## 2. Estado Efêmero no Redis (Escrito exclusivamente via Webhooks LiveKit)

### 2.1 Chave `jdisc:room:{roomId}:participants` (Hash `userId -> JSON`)
| Campo (`ParticipantPresence`) | Tipo | Descrição |
|---|---|---|
| `userId` | `string` | ID do usuário (`parentUserId`) |
| `displayName` | `string` | Nome de exibição |
| `isMuted` | `bool` | Estado de mute do microfone |
| `isDeafened` | `bool` | Estado de ensurdecimento (sinalizado via UI/SignalR em campo transitório ou metadata) |
| `isScreenSharing` | `bool` | `true` quando `<userId>:screenshare` possui track `SCREEN_SHARE` ativa |
| `screenShareIdentity` | `string?` | `"<userId>:screenshare"` quando ativo |
| `screenShareHasAudio` | `bool` | Indica se `SCREEN_SHARE_AUDIO` está publicada |
| `joinedAtUtc` | `string` | ISO-8601 |

- **Regra de Capacidade**: Contagem da sala = `HLEN jdisc:room:{roomId}:participants` (apenas identidades principais `<userId>`, nunca `<userId>:screenshare`). Máximo `10`.
- **Normalização de Webhook**: Eventos de `<userId>:screenshare` (`metadata.kind == "screenshare"`) atualizam `isScreenSharing`, `screenShareIdentity` e `screenShareHasAudio` no registro de `parentUserId`. Se `participant_left` chegar para `<userId>`, remove a entrada do usuário (e limpa eventual estado de screenshare).

## 3. Entidades Locais do Cliente Desktop (Tauri / Rust)

### 3.1 `AppSettings` (Persistido via `tauri-plugin-store` em `settings.json`)
| Campo | Tipo | Padrão | Validação |
|---|---|---|---|
| `serverUrl` | `string` | `VITE_DEFAULT_SERVER_URL` (`http://localhost:5000`) | URL HTTP/HTTPS válida normalizada |
| `authSession` | `AuthSession?` | `null` | `{ accessToken, expiresAt, userId, displayName }` |
| `participantVolumes` | `Record<string, number>` | `{}` | Mapa `userId -> volume` no intervalo `[0, 200]` (%) |
| `streamAudioMix` | `AudioMixConfig` | `{ volume: 100, muted: false }` | `volume` em `[0, 100]` (%) |
| `globalShortcut` | `GlobalShortcutConfig` | `{ enabled: false, mode: "toggle", accelerator: null }` | `mode` ∈ `{"toggle", "push_to_talk"}` |

### 3.2 `CaptureSource` & `ActiveStreamState` (Em memória no Rust `AppState`)
- **`CaptureSource`**: `id` (`"window:<hwnd>"` | `"monitor:<hmonitor>"`), `kind`, `title`, `processId`, `processName`, `iconBase64`, `width`, `height`, `supportsProcessAudioIsolation`.
- **`ActiveStreamState`**: `roomId`, `sourceId`, `preset` (`"720p30"` | `"1080p60"`), `audioMode` (`"process_tree"` | `"system_global"` | `"none"`), `status` (`"idle"` | `"starting"` | `"streaming"` | `"stopping"` | `"error"`), `mix` (`AtomicU32` + `AtomicBool`).

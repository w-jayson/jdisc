# Tasks: jdisc MVP Unificado (Backend .NET 10 + LiveKit SFU + Desktop Windows Tauri v2)

**Input**: Design documents from `/specs/001-jdisc-mvp/`
**Prerequisites**: [plan.md](file:///c:/Users/weslley%20jayson/Documents/jdisc/specs/001-jdisc-mvp/plan.md), [spec.md](file:///c:/Users/weslley%20jayson/Documents/jdisc/specs/001-jdisc-mvp/spec.md), [research.md](file:///c:/Users/weslley%20jayson/Documents/jdisc/specs/001-jdisc-mvp/research.md), [data-model.md](file:///c:/Users/weslley%20jayson/Documents/jdisc/specs/001-jdisc-mvp/data-model.md), [contracts/](file:///c:/Users/weslley%20jayson/Documents/jdisc/specs/001-jdisc-mvp/contracts)

**Tests**: Conforme Constitution `v1.1.0` (Princípio VII), testes unitários obrigatórios cobrem `Jdisc.Domain` e `Jdisc.Application` (.NET), lógica pura em Rust (`state.rs`, `mixer.rs`) e utilitários/hooks frontend (`vitest`).

**Organization**: Tarefas organizadas por fases de infraestrutura, fundação compartilhada e cada User Story (`US1` a `US9`) do `spec.md` unificado, sem bloqueios externos.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (`US1`..`US9`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Infraestrutura & Estrutura Monorepo)

**Purpose**: Inicialização da solução .NET 10, Tauri v2 + React TypeScript (`strict: true`) e Docker Compose com portas UDP restritas

- [x] T001 Create monorepo directories (`infra/`, `src/backend/`, `src/frontend/`, `src/frontend/src-tauri/`), `.gitignore`, and `.env.example` (with `INVITE_CODE`, `JWT_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD`) at repository root
- [x] T002 Create .NET 10 Clean Architecture solution (`Jdisc.Domain`, `Jdisc.Application`, `Jdisc.Infrastructure`, `Jdisc.Presentation`, `Jdisc.Domain.UnitTests`, `Jdisc.Application.UnitTests`) and project references enforcing Clean Architecture dependency boundaries in `src/backend/Jdisc.sln`
- [x] T003 [P] Initialize React + TypeScript (`"strict": true`) + Vite + `vitest` (with `test` script) and install `livekit-client`, `@microsoft/signalr`, `zustand`, `@tanstack/react-query`, `@tauri-apps/api`, `@tauri-apps/plugin-global-shortcut`, and `@tauri-apps/plugin-store` in `src/frontend/package.json` and `src/frontend/tsconfig.json`
- [x] T004 [P] Configure Rust dependencies (`tauri` v2, `tauri-build`, `tauri-plugin-global-shortcut`, `tauri-plugin-store`, `livekit`, `windows`, `yuv` with SIMD features, `tokio`, `tokio-util`, `png`, `base64`) in `src/frontend/src-tauri/Cargo.toml`
- [x] T005 [P] Configure Tauri v2 capabilities (`core:default`, `global-shortcut:allow-register`, `global-shortcut:allow-unregister`, `global-shortcut:allow-is-registered`, `store:default`) in `src/frontend/src-tauri/capabilities/default.json`
- [x] T006 [P] Configure Windows NSIS installer bundle (`targets: ["nsis"]`, `webviewInstallMode: embedBootstrapper`, `installMode: perUser`, icons, CSP) in `src/frontend/src-tauri/tauri.conf.json`
- [x] T007 [P] Configure Docker Compose stack (API .NET 10 `Dockerfile`, PostgreSQL, Redis, LiveKit SFU with restricted `50000-50100:50000-50100/udp` range) in `infra/docker-compose.yml`, `infra/livekit.yaml`, and `src/backend/Dockerfile`

---

## Phase 2: Foundational (Núcleo Backend, LiveKit Nativo, Redis & Runtime Tauri)

**Purpose**: Infraestrutura compartilhada obrigatória antes de iniciar qualquer User Story

**⚠️ CRITICAL**: Nenhuma User Story começa antes desta fase estar concluída

- [x] T008 Implement Domain entities (`User`, `VoiceRoom` with fixed capacity `10`) and domain invariants in `src/backend/src/Jdisc.Domain/Entities/User.cs` and `src/backend/src/Jdisc.Domain/Entities/VoiceRoom.cs`
- [x] T009 [P] Configure PostgreSQL `AppDbContext` with EF Core migrations and seed data for fixed rooms (`Geral`, `Jogatina`, `AFK`) in `src/backend/src/Jdisc.Infrastructure/Persistence/AppDbContext.cs` and `src/backend/src/Jdisc.Infrastructure/Persistence/Migrations/`
- [x] T010 [P] Implement `RedisPresenceStore` (`jdisc:room:{roomId}:participants` read/write operations using `StackExchange.Redis`) in `src/backend/src/Jdisc.Infrastructure/Redis/RedisPresenceStore.cs`
- [x] T011 [P] Implement native LiveKit JWT `HS256` generator (`System.IdentityModel.Tokens.Jwt`) for voice and scoped screenshare tokens (`{userId}:screenshare`) and manual `HMAC-SHA256`/JWT webhook signature validator in `src/backend/src/Jdisc.Infrastructure/LiveKit/NativeLiveKitJwtService.cs` and `src/backend/src/Jdisc.Infrastructure/LiveKit/LiveKitWebhookValidator.cs`
- [x] T012 Configure ASP.NET Core `Program.cs` with JWT Bearer authentication (HTTP + SignalR query token), Serilog structured logging, and `/health` checks (API, PostgreSQL, Redis, LiveKit HTTP) in `src/backend/src/Jdisc.Presentation/Program.cs`
- [x] T013 [P] Implement Rust state models (`AppSettings`, `AuthSession`, `AudioMixConfig`, `GlobalShortcutConfig`, `CaptureSource`, `ActiveStreamState`, `AudioMixState`) in `src/frontend/src-tauri/src/state.rs`
- [x] T014 [P] Define shared TypeScript desktop IPC and settings interfaces matching `data-model.md` and `contracts/tauri-ipc-contract.md` in `src/frontend/src/services/desktop/types.ts`
- [x] T015 [P] Implement `get_app_settings` and `save_app_settings` Tauri commands backed by `tauri-plugin-store` (`settings.json`) in `src/frontend/src-tauri/src/commands/settings_commands.rs`
- [x] T016 [P] Implement `desktopSettingsStore` (Zustand) and dynamic `serverUrl` HTTP/SignalR base-URL resolver in `src/frontend/src/stores/desktopSettingsStore.ts` and `src/frontend/src/services/api/httpClient.ts`
- [x] T017 Wire Tauri builder, plugins (`tauri_plugin_store`, `tauri_plugin_global_shortcut`), `AppState`, initial `settings_commands` in `tauri::generate_handler![]`, and clean shutdown hooks in `src/frontend/src-tauri/src/lib.rs` and `src/frontend/src-tauri/src/main.rs`

**Checkpoint**: Fundação pronta — User Stories podem avançar

---

## Phase 3: User Story 1 — Executável Desktop Windows 10/11 e Servidor Configurável (Priority: P1) 🎯

**Goal**: Executar o cliente **jdisc** como janela desktop standalone sem navegador externo, permitindo configurar e persistir URL do servidor e preferências locais.

**Independent Test**: Executar o app desktop, configurar `serverUrl`, fechar e reabrir verificando persistência de `settings.json`.

- [x] T018 [P] [US1] Add Rust unit tests for `AppSettings` normalization (`serverUrl` trimming/validation, `participantVolumes` clamping `0..200`) in `src/frontend/src-tauri/src/state.rs`
- [x] T019 [P] [US1] Implement `settingsService` desktop facade wrapping `get_app_settings` and `save_app_settings` in `src/frontend/src/services/desktop/settingsService.ts`
- [x] T020 [US1] Build configurable `ServerConnectionForm` and desktop bootstrap flow (loading `AppSettings` on startup) in `src/frontend/src/components/ServerConnectionForm.tsx` and `src/frontend/src/App.tsx`

---

## Phase 4: User Story 2 — Autenticação com Código de Convite e Sessão Persistente (Priority: P1) 🎯

**Goal**: Cadastro protegido por `INVITE_CODE`, login com JWT próprio e persistência de sessão no cliente desktop, bloqueando acessos não autenticados.

**Independent Test**: Testar recusa de código de convite inválido, cadastro válido, login, reinício do app com sessão preservada e bloqueio de endpoints/Hub sem JWT.

- [x] T021 [P] [US2] Write backend unit tests for invite code validation, duplicate email rejection, password hashing, and JWT issuance in `src/backend/tests/Jdisc.Application.UnitTests/AuthHandlersTests.cs`
- [x] T022 [US2] Implement `RegisterUserHandler`, `LoginUserHandler`, `GetCurrentUserHandler`, and Minimal API endpoints (`/api/auth/register`, `/api/auth/login`, `/api/auth/me`) in `src/backend/src/Jdisc.Application/Auth/` and `src/backend/src/Jdisc.Presentation/Endpoints/AuthEndpoints.cs`
- [x] T023 [P] [US2] Implement `authApi`, `authStore` (persisting `authSession` via `settingsService`), and `AuthScreen` (Login + Registro com campo de Código de Convite) in `src/frontend/src/services/api/authApi.ts`, `src/frontend/src/stores/authStore.ts`, and `src/frontend/src/components/AuthScreen.tsx`

---

## Phase 5: User Story 3 — Salas de Voz Fixas e Presença em Tempo Real (Priority: P1) 🎯

**Goal**: Exibir salas fixas ("Geral", "Jogatina", "AFK") com participantes conectados e indicador "Ao Vivo" atualizados em tempo real via Webhooks → Redis → SignalR.

**Independent Test**: Conectar 2 usuários autenticados; verificar que alterações de presença/screen share em uma sala atualizam instantaneamente a UI de quem não está em chamada.

- [x] T024 [P] [US3] Write backend unit tests for `NormalizeLiveKitWebhookHandler` (participant_joined/left, track_published/unpublished, companion `{userId}:screenshare` mapping to `parentUserId` without incrementing room count) in `src/backend/tests/Jdisc.Application.UnitTests/NormalizeLiveKitWebhookTests.cs`
- [x] T025 [US3] Implement `GetRoomsHandler`, `NormalizeLiveKitWebhookHandler` (single Redis writer), `PresenceHub` (broadcast-only SignalR Hub), and `/api/rooms` + `/api/webhooks/livekit` endpoints in `src/backend/src/Jdisc.Application/Rooms/`, `src/backend/src/Jdisc.Application/Webhooks/`, `src/backend/src/Jdisc.Presentation/Hubs/PresenceHub.cs`, and `src/backend/src/Jdisc.Presentation/Endpoints/RoomEndpoints.cs`
- [x] T026 [P] [US3] Implement `roomsApi`, `signalrService`, `usePresenceHub` hook, `roomStore`, and `RoomSidebar` (displaying fixed rooms, connected participants, and "Ao Vivo" badges) in `src/frontend/src/services/api/roomsApi.ts`, `src/frontend/src/services/realtime/signalrService.ts`, `src/frontend/src/hooks/usePresenceHub.ts`, `src/frontend/src/stores/roomStore.ts`, and `src/frontend/src/components/RoomSidebar.tsx`

---

## Phase 6: User Story 4 — Conexão em Call, Troca Automática, Capacidade e Alertas (Priority: P1) 🎯

**Goal**: Entrar em sala de voz com 1 clique, trocar automaticamente de sala (encerrando eventual stream ativo), respeitar limite de 10 participantes (`"Sala cheia — máximo 10 participantes"`), tocar alertas sonoros e limpar desconexões abruptas em < 15 s.

**Independent Test**: Entrar em "Geral", conversar, clicar em "Jogatina" para troca automática com alertas sonoros, validar bloqueio do 11º participante preservando sala anterior e validar remoção automática ao fechar processo abruptamente.

- [x] T027 [P] [US4] Write backend unit tests for room capacity enforcement (max 10 participants, `ROOM_FULL` error, companion identity excluded from count) and voice token claims in `src/backend/tests/Jdisc.Domain.UnitTests/VoiceRoomTests.cs` and `src/backend/tests/Jdisc.Application.UnitTests/IssueLiveKitTokensTests.cs`
- [x] T028 [US4] Implement `IssueLiveKitVoiceTokenHandler` and `POST /api/rooms/{roomId}/voice-token` endpoint returning `409 Conflict` (`"Sala cheia — máximo 10 participantes"`) when full in `src/backend/src/Jdisc.Application/Rooms/IssueLiveKitVoiceTokenHandler.cs` and `src/backend/src/Jdisc.Presentation/Endpoints/RoomEndpoints.cs`
- [x] T029 [US4] Implement `livekitService` voice room connection/switching (disconnecting cleanly before joining new room, preserving current room on `ROOM_FULL`) and discrete join/leave audio cues in `src/frontend/src/services/realtime/livekitService.ts`, `src/frontend/src/hooks/useVoiceCall.ts`, and `src/frontend/src/utils/soundEffects.ts`

---

## Phase 7: User Story 5 — Controles de Áudio da Chamada e Volume Individual (Priority: P2)

**Goal**: Mute, Deafen (silenciando áudio recebido + auto-mute do microfone), borda iluminada de quem está falando e volume individual 0%–200% salvo localmente.

**Independent Test**: Testar Mute, Deafen, indicador de fala ativa e volume 150% em um participante mantendo persistência após reiniciar o `.exe`.

- [x] T030 [P] [US5] Implement Mute, Deafen (WebAudio/remote track mute + automatic mic mute, auto-undeafen when unmuting mic), active-speaker border detection (`ActiveSpeakersChanged`), and per-participant WebAudio gain (`0..200%`) in `src/frontend/src/services/realtime/livekitService.ts` and `src/frontend/src/hooks/useVoiceCall.ts`
- [x] T031 [US5] Build `VoiceControlsBar` (Mute, Deafen, Disconnect) and per-participant volume slider (`0%–200%`) persisted in `settingsService` in `src/frontend/src/components/VoiceControlsBar.tsx` and `src/frontend/src/components/RoomSidebar.tsx`

---

## Phase 8: User Story 6 — Seletor de Aplicativo/Jogo e Monitor Inteiro (Priority: P1) 🎯

**Goal**: Enumerar janelas abertas (`HWND`, título, ícone PNG Base64, `PID`, `processName`) e monitores disponíveis, exibindo presets `720p30`/`1080p60`, e capturar vídeo via WGC com conversão SIMD BGRA → I420.

**Independent Test**: Abrir múltiplas instâncias/jogos, abrir seletor em < 1 s verificando título, ícone, `processName`/`PID`, monitores e presets, e validar captura WGC.

- [x] T032 [P] [US6] Implement Win32 window enumeration (`EnumWindows`, `IsWindowVisible`, `DWMWA_CLOAKED`, `GetWindowThreadProcessId`, executable name, `HICON` to PNG Base64) and monitor enumeration (`EnumDisplayMonitors`) in `src/frontend/src-tauri/src/capture/enumerate.rs`
- [x] T033 [P] [US6] Implement `list_capture_sources` Tauri command, Windows build detection (`RtlGetVersion` for `processAudioSupported`), and register command in `src/frontend/src-tauri/src/commands/capture_commands.rs` and `src/frontend/src-tauri/src/lib.rs`
- [x] T034 [P] [US6] Implement `captureService` desktop facade for `list_capture_sources` in `src/frontend/src/services/desktop/captureService.ts`
- [x] T035 [US6] Build decoupled `ScreenSharePickerModal` showing window title, icon, `processName`/`PID` (disambiguating multiple instances), monitors, quality preset (`720p30`/`1080p60`), and echo-risk warning banner for monitors or `processAudioSupported === false` in `src/frontend/src/components/ScreenSharePickerModal.tsx`
- [x] T036 [US6] Implement Windows Graphics Capture (`GraphicsCaptureItem` for `HWND`/`HMONITOR`, `Direct3D11CaptureFramePool`, scaling `720p30`/`1080p60`, `Closed` callback, plus graceful handling of minimized windows and DRM-protected frames without dropping voice) using the `yuv` crate with SIMD for `BGRA -> I420` conversion in `src/frontend/src-tauri/src/capture/video_wgc.rs`

---

## Phase 9: User Story 7 — Isolamento de Áudio por Processo (Anti-Eco) e Transmissão Nativa (Priority: P1) 🎯

**Goal**: Capturar áudio exclusivamente da árvore de processos via WASAPI Process Loopback (com fallback seguro), publicar diretamente pelo LiveKit Rust SDK como `{userId}:screenshare` e bloquear auto-subscribe/reprodução da própria track no React.

**Independent Test**: Transmitir jogo com amigo falando e música no navegador; confirmar 0% eco/música nos espectadores, zero retorno de áudio próprio no transmissor e parada automática ao fechar o jogo ou trocar de sala.

- [x] T037 [P] [US7] Implement `IssueLiveKitScreenshareTokenHandler` (HS256 token for `{userId}:screenshare` with `canSubscribe: false`, `canPublishSources: ["screen_share", "screen_share_audio"]`) and `POST /api/rooms/{roomId}/screenshare-token` endpoint in `src/backend/src/Jdisc.Application/Rooms/IssueLiveKitScreenshareTokenHandler.cs` and `src/backend/src/Jdisc.Presentation/Endpoints/RoomEndpoints.cs`
- [x] T038 [P] [US7] Implement WASAPI Process Loopback capture in COM MTA (`ActivateAudioInterfaceAsync` + `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`, 48 kHz stereo `i16` 10 ms frames with silence padding) and safe fallback (`system_global` / `none` emitting `desktop://audio-warning`) in `src/frontend/src-tauri/src/capture/audio_wasapi.rs`
- [x] T039 [US7] Implement LiveKit Rust SDK publisher (`Room::connect` with `auto_subscribe: false`, `NativeVideoSource` -> `TrackSource::Screenshare`, `NativeAudioSource` with AEC/NS/AGC disabled -> `TrackSource::ScreenshareAudio`, `CancellationToken` shutdown) in `src/frontend/src-tauri/src/media/livekit_publisher.rs`
- [x] T040 [US7] Implement `start_screen_stream` and `stop_screen_stream` Tauri commands (registering them in `src/frontend/src-tauri/src/lib.rs`) emitting `desktop://stream-state-changed` on start, error, DRM/unavailable source, or `source_closed` in `src/frontend/src-tauri/src/commands/capture_commands.rs`
- [x] T041 [US7] Implement self-screenshare suppression in the React LiveKit client wrapper to explicitly prevent auto-subscribe and playback of tracks belonging to the local user's companion identity (`{userId}:screenshare`) in `src/frontend/src/services/realtime/livekitService.ts`
- [x] T042 [US7] Implement `useDesktopStreaming` hook to request `/screenshare-token`, enforce max 1 active stream per user, map `{userId}:screenshare` to `parentUserId` in UI, and auto-call `stop_screen_stream` on room switch or disconnect in `src/frontend/src/hooks/useDesktopStreaming.ts` and `src/frontend/src/hooks/useVoiceCall.ts`

---

## Phase 10: User Story 8 — Visualização Multi-Stream e Mixagem Independente (Priority: P2)

**Goal**: Assistir múltiplas transmissões simultâneas em modo padrão, teatro ou tela cheia alternando destaque, e controlar volume (0%–100%) / mute do áudio do jogo no transmissor sem afetar o microfone.

**Independent Test**: Com 2 transmissões simultâneas na sala, alternar destaque em modo teatro e tela cheia; no transmissor, ajustar slider/mute do jogo sem alterar o microfone.

- [x] T043 [P] [US8] Add Rust unit tests for lock-free PCM gain scaling (`0..100%`), mute zeroing, and `i16` clamping in `src/frontend/src-tauri/src/audio/mixer.rs`
- [x] T044 [US8] Implement lock-free `AudioMixState` (`AtomicU32` + `AtomicBool`) PCM processor (after `T043` test setup) and attach it to the WASAPI capture loop in `src/frontend/src-tauri/src/audio/mixer.rs` and `src/frontend/src-tauri/src/capture/audio_wasapi.rs`
- [x] T045 [P] [US8] Implement `set_stream_audio_mix` Tauri command (registering it in `src/frontend/src-tauri/src/lib.rs`) persisting `streamAudioMix` in `src/frontend/src-tauri/src/commands/audio_commands.rs`
- [x] T046 [P] [US8] Build `StreamStageViewer` (default, theater, and fullscreen modes with switcher for multiple concurrent `{userId}:screenshare` streams) and `StreamAudioMixerControl` (0%–100% + mute independent of mic) in `src/frontend/src/components/StreamStageViewer.tsx` and `src/frontend/src/components/StreamAudioMixerControl.tsx`

---

## Phase 11: User Story 9 — Atalho Global de Teclado em Tela Cheia (Priority: P2)

**Goal**: Configurar e persistir atalho global (Toggle Mute ou Push-to-Talk) via `tauri-plugin-global-shortcut` operacional durante jogos em tela cheia.

**Independent Test**: Configurar atalho, colocar jogo em tela cheia em primeiro plano e alternar mute do microfone em < 200 ms.

- [x] T047 [P] [US9] Implement global shortcut manager using `tauri-plugin-global-shortcut` (Toggle Mute `Pressed`, Push-to-Talk `Pressed`/`Released`, startup registration, `SHORTCUT_CONFLICT` handling) in `src/frontend/src-tauri/src/shortcuts/global_shortcut.rs`
- [x] T048 [P] [US9] Implement `register_global_shortcut` and `unregister_global_shortcut` Tauri commands and register them in `src/frontend/src-tauri/src/lib.rs` and `src/frontend/src-tauri/src/commands/shortcut_commands.rs`
- [x] T049 [US9] Implement `useGlobalShortcutSync` hook and `GlobalShortcutSettings` UI (key recorder, Toggle/Push-to-Talk mode selector, conflict and elevated-game UIPI notice) in `src/frontend/src/hooks/useGlobalShortcutSync.ts` and `src/frontend/src/components/GlobalShortcutSettings.tsx`

---

## Phase 12: Polish, Testes & Validação do Executável NSIS (`.exe`)

**Purpose**: Execução dos quality gates unitários, checagem estrita TypeScript, build do instalador NSIS `.exe` e validação ponta a ponta

- [x] T050 [P] Run backend unit tests (`dotnet test src/backend/Jdisc.sln`) and Rust unit tests (`cargo test --manifest-path src/frontend/src-tauri/Cargo.toml`)
- [x] T051 [P] Run TypeScript strict type-check (`npx tsc --noEmit`) and frontend unit tests (`npm test`) in `src/frontend/`
- [x] T052 Execute Docker Compose stack verification (`docker compose -f infra/docker-compose.yml up -d --build` + `/health`) and Windows NSIS release build (`npm run tauri build` in `src/frontend/`) validating `src/frontend/src-tauri/target/release/bundle/nsis/jdisc_*_x64-setup.exe` and `src/frontend/src-tauri/target/release/jdisc.exe`
- [x] T053 Execute end-to-end validation scenarios from `specs/001-jdisc-mvp/quickstart.md`

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → **User Stories (`US1`..`US9`)** → **Phase 12 (Polish & NSIS `.exe` Validation)**
- **MVP Core P1 (`US1`–`US4`, `US6`, `US7`)**: entrega o `.exe` standalone, autenticação por convite, salas fixas com presença em tempo real, voz + alertas + limite 10, seletor WGC (`yuv` SIMD) e streaming anti-eco via WASAPI Process Loopback + LiveKit Rust SDK (sem auto-subscribe da própria track `{userId}:screenshare`).
- **Incremental P2 (`US5`, `US8`, `US9`)**: controles de áudio da chamada (Mute/Deafen/Speaking/0–200%), visualização multi-stream teatro/tela cheia + mixagem independente do jogo e atalhos globais em tela cheia.

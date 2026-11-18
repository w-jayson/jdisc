# Implementation Plan: jdisc MVP Unificado (Backend .NET 10 + LiveKit SFU + Desktop Windows Tauri v2)

**Branch**: `001-jdisc-mvp` | **Date**: 2026-11-13 | **Spec**: [spec.md](file:///c:/Users/weslley%20jayson/Documents/jdisc/specs/001-jdisc-mvp/spec.md)

**Input**: Feature specification from `/specs/001-jdisc-mvp/spec.md`

## Summary

Construir de ponta a ponta o MVP do **jdisc**: uma solução completa composta por (1) servidor orquestrado em **Docker Compose** com **ASP.NET Core (.NET 10)** em Clean Architecture (Minimal APIs + CQRS leve + SignalR broadcast + geração nativa de JWT HS256 do LiveKit + validação manual de webhooks), **PostgreSQL** (EF Core), **Redis** (estado efêmero gravado exclusivamente via webhooks) e **LiveKit SFU** (`50000-50100/udp`), e (2) cliente desktop standalone para Windows 10/11 (`.exe` NSIS) em **Tauri v2 (Rust + WebView2)** envolvendo o frontend **React + TypeScript (`strict: true`)** com **LiveKit Client SDK**, **Zustand** e **TanStack Query**. A captura de janelas/monitores (WGC + `yuv` SIMD), o isolamento de áudio por árvore de processos (`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` via WASAPI Process Loopback com fallback seguro), a mixagem independente do jogo, os atalhos globais (`tauri-plugin-global-shortcut`) e a publicação direta via **LiveKit Rust SDK** (`{userId}:screenshare`) rodam nativamente em Rust sem trafegar frames brutos pelo IPC.

## Technical Context

**Language/Version**:
- **Backend**: C# / .NET 10 (ASP.NET Core Minimal APIs, EF Core, SignalR)
- **Desktop Native**: Rust (Edition 2021, `rustc >= 1.80`, target `x86_64-pc-windows-msvc`, Tauri v2)
- **Frontend UI**: TypeScript 5.x (`"strict": true`) + React 19 + Vite

**Primary Dependencies**:
- **Backend**: `Microsoft.EntityFrameworkCore`, `Npgsql.EntityFrameworkCore.PostgreSQL`, `StackExchange.Redis`, `System.IdentityModel.Tokens.Jwt`, `Serilog.AspNetCore`, `AspNetCore.HealthChecks.NpgSql`, `AspNetCore.HealthChecks.Redis`
- **Desktop Rust**: `tauri` v2, `tauri-build` v2, `tauri-plugin-global-shortcut` v2, `tauri-plugin-store` v2, `livekit` crate, `windows` crate (WGC + WASAPI Process Loopback + EnumWindows/DWM/GDI), `yuv` crate (com SIMD para `BGRA -> I420`), `tokio`, `tokio-util`, `png`, `base64`
- **Frontend**: `livekit-client`, `@microsoft/signalr`, `zustand`, `@tanstack/react-query`, `@tauri-apps/api`, `@tauri-apps/plugin-global-shortcut`, `@tauri-apps/plugin-store`

**Storage**:
- **PostgreSQL**: Entidades persistentes (`User`, `VoiceRoom` seeded: `Geral`, `Jogatina`, `AFK`) via migrations versionadas EF Core
- **Redis**: Presença efêmera das salas (`jdisc:room:{roomId}:participants`), escrita exclusivamente via handler de webhooks do LiveKit
- **Local Desktop (`tauri-plugin-store`)**: `%APPDATA%\com.jdisc.desktop\settings.json` (`serverUrl`, `authSession`, `participantVolumes`, `streamAudioMix`, `globalShortcut`)

**Testing**:
- **Backend (Constitution v1.1.0 MVP)**: `xUnit` + `FluentAssertions` nas camadas `Jdisc.Domain.UnitTests` e `Jdisc.Application.UnitTests` (invariantes de capacidade, código de convite, geração de claims JWT HS256 para voz e `{userId}:screenshare`, e normalização de webhooks no Redis)
- **Desktop Rust**: `cargo test` (mixagem PCM atômica `0..100%`, clamping `i16`, normalização de `AppSettings`)
- **Frontend**: `vitest` + `tsc --noEmit`

**Target Platform**: Servidor Linux/Docker Compose (`.NET 10` + PostgreSQL + Redis + LiveKit SFU); Cliente Desktop Windows 10 (build 2004+/20348+ para Process Loopback, com fallback em builds anteriores) e Windows 11 (`.exe` NSIS)

**Project Type**: Full-stack Desktop + Backend Monorepo (`infra/`, `src/backend/`, `src/frontend/` + `src/frontend/src-tauri/`)

**Performance Goals**:
- Inicialização do `.exe` até UI pronta: `< 5 s` (`SC-001`)
- Atualização de presença nas salas em tempo real: `< 2 s` (`SC-002`)
- Listagem de janelas/monitores com ícones: `< 1 s` (`SC-003`)
- Remoção de participante fantasma após queda abrupta: `< 15 s` (`SC-006`)
- Mixagem do jogo: `< 500 ms` (`SC-005`, meta `< 20 ms` via DSP atômico)
- Atalho global em tela cheia: `< 200 ms` (`SC-005`)

**Constraints**:
- Proibido WebRTC P2P Mesh manual; mídia 100% via LiveKit SFU
- Proibido SDKs LiveKit C# não oficiais no backend (geração nativa HS256 + validação manual de webhook)
- Proibido Hubs SignalR escreverem ou removerem presença de mídia no Redis
- Proibido mapear ranges amplos UDP no Docker Compose (restringir a `50000-50100:50000-50100/udp`)
- Proibido trafegar frames crus de vídeo ou áudio PCM pelo IPC do WebView2

**Scale/Scope**: Grupo privado de até 10 amigos simultâneos por sala; 3 salas fixas; até 10 transmissões simultâneas na mesma sala (1 ativa por participante).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio (Constitution v1.1.0) | Status | Evidência / Conformidade |
|---|---|---|
| **I. Clean Architecture, Minimal APIs e SignalR** | PASS | Solução `.NET 10` em `Domain`, `Application`, `Infrastructure`, `Presentation`; Minimal APIs + handlers CQRS explícitos; SignalR apenas para broadcast e sinalização leve de UI. |
| **II. Mídia via LiveKit SFU (NON-NEGOTIABLE)** | PASS | Voz no `livekit-client` e screen share no `livekit` Rust SDK conectados ao LiveKit SFU em Docker; webhooks como fonte única da verdade. |
| **III. Separação PostgreSQL vs Redis** | PASS | PostgreSQL guarda `User` e `VoiceRoom`; Redis guarda presença efêmera gravada exclusivamente pelo handler de webhooks (normalizando `{userId}:screenshare`). |
| **IV. Frontend React + TS + Tauri v2** | PASS | React + TS `"strict": true`, Zustand + TanStack Query, UI desacoplada dos SDKs/IPC, empacotamento Windows `.exe` via Tauri v2, WGC e WASAPI Process Loopback em Rust. |
| **V. Autenticação JWT Própria e Tokens Seguros** | PASS | JWT próprio protegendo API e SignalR; cadastro exige `INVITE_CODE`; tokens LiveKit gerados exclusivamente no backend com `System.IdentityModel.Tokens.Jwt`. |
| **VI. Infraestrutura Docker Compose e Observabilidade** | PASS | `docker-compose.yml` com range `50000-50100/udp`, `.env` sem segredos hardcoded, Serilog estruturado e `/health`. |
| **VII. Estratégia de Testes (MVP)** | PASS | Unitários obrigatórios em `Domain` e `Application` (.NET) + unitários Rust (`mixer.rs`, `state.rs`) + `vitest`; testes de integração pesados mantidos fora do MVP conforme emenda planejada `v1.2.0`. |

## Project Structure

### Documentation (this feature)

```text
specs/001-jdisc-mvp/
├── spec.md                                      # Especificação unificada (US1..US9, FR-001..FR-016)
├── plan.md                                      # Este plano técnico completo
├── research.md                                  # Decisões arquiteturais (Backend + Rust + LiveKit + Docker)
├── data-model.md                                # PostgreSQL + Redis + AppSettings/CaptureSource
├── quickstart.md                                # Guia de execução Docker + Tauri + validação E2E
├── checklists/requirements.md
└── contracts/
    ├── backend-api-and-realtime.md              # Minimal APIs, SignalR Hub, JWT/LiveKit Claims e Webhooks
    └── tauri-ipc-contract.md                    # Tauri Commands & Events React ↔ Rust
```

### Source Code (repository root)

```text
.env.example
.gitignore
infra/
├── docker-compose.yml                           # API .NET 10, PostgreSQL, Redis, LiveKit SFU (50000-50100/udp)
└── livekit.yaml                                 # Config LiveKit SFU (port_range 50000-50100 + webhook endpoint)

src/
├── backend/
│   ├── Jdisc.sln
│   ├── Dockerfile
│   ├── src/
│   │   ├── Jdisc.Domain/                        # User, VoiceRoom, RoomCapacityPolicy (max 10)
│   │   ├── Jdisc.Application/                   # Auth handlers, Room handlers, LiveKit token & webhook handlers
│   │   ├── Jdisc.Infrastructure/                # AppDbContext (EF Core), RedisPresenceStore, NativeLiveKitJwtService, WebhookSignatureValidator
│   │   └── Jdisc.Presentation/                  # Program.cs, Minimal APIs, PresenceHub (SignalR), /health, Serilog
│   └── tests/
│       ├── Jdisc.Domain.UnitTests/              # Regras de capacidade, validação de salas/usuário
│       └── Jdisc.Application.UnitTests/         # Convite, auth, tokens LiveKit voz/screenshare, normalização de webhook
│
└── frontend/
    ├── package.json                             # React, TS strict, Vite, Vitest, Tauri CLI/plugins, LiveKit, SignalR, Zustand, TanStack Query
    ├── tsconfig.json                            # "strict": true
    ├── src/
    │   ├── App.tsx                              # Bootstrap desktop (AppSettings, Auth, Salas, Chamada, Viewer)
    │   ├── components/                          # AuthScreen, ServerConnectionForm, RoomSidebar, VoiceControlsBar, ScreenSharePickerModal, StreamStageViewer, StreamAudioMixerControl, GlobalShortcutSettings
    │   ├── hooks/                               # usePresenceHub, useVoiceCall, useDesktopStreaming, useGlobalShortcutSync
    │   ├── services/
    │   │   ├── api/                             # httpClient com serverUrl dinâmico, authApi, roomsApi
    │   │   ├── realtime/                        # signalrService, livekitService (voz + bloqueio de autoSubscribe em {userId}:screenshare)
    │   │   └── desktop/                         # types.ts, settingsService, captureService, shortcutService
    │   ├── stores/                              # desktopSettingsStore, authStore, roomStore (Zustand)
    │   └── utils/                               # soundEffects.ts (alertas sonoros discretos entrada/saída)
    └── src-tauri/
        ├── Cargo.toml                           # tauri v2, global-shortcut, store, livekit, windows, yuv (SIMD), tokio, tokio-util, png, base64
        ├── tauri.conf.json                      # Bundle Windows NSIS (.exe), embedBootstrapper WebView2, perUser, CSP
        ├── capabilities/default.json            # core:default, global-shortcut, store
        └── src/
            ├── main.rs
            ├── lib.rs                           # Builder Tauri, plugins, AppState, registro de comandos e shutdown
            ├── state.rs                         # AppSettings, CaptureSource, ActiveStreamState, AudioMixState
            ├── commands/
            │   ├── settings_commands.rs
            │   ├── capture_commands.rs
            │   ├── audio_commands.rs
            │   └── shortcut_commands.rs
            ├── capture/
            │   ├── enumerate.rs                 # Módulo 1: EnumWindows (HWND, título, HICON->PNG, PID) + EnumDisplayMonitors + RtlGetVersion
            │   ├── video_wgc.rs                 # Módulo 2: WGC + crate yuv (SIMD BGRA->I420) + minimizada/DRM + Closed
            │   └── audio_wasapi.rs              # Módulo 3: WASAPI Process Loopback (árvore PID) + silêncio 10ms + fallback
            ├── audio/mixer.rs                   # Módulo 4a: Ganho/Mute atômico PCM i16
            ├── shortcuts/global_shortcut.rs     # Módulo 4b: tauri-plugin-global-shortcut Toggle/PTT + conflitos
            └── media/livekit_publisher.rs       # Módulo 5: LiveKit Rust SDK NativeVideoSource + NativeAudioSource
```

**Structure Decision**: Monorepo unificado (`infra/`, `src/backend/`, `src/frontend/` + `src/frontend/src-tauri/`), permitindo subir toda a stack servidora com `docker compose up` e gerar o aplicativo desktop standalone Windows `.exe` via `npm run tauri build`, sem dependências externas entre features separadas.

## Detalhamento Técnico dos Módulos Desktop Rust

1. **Enumeração (`capture/enumerate.rs`)**: `EnumWindows` (filtrando `IsWindowVisible`, `WS_EX_TOOLWINDOW`, título não vazio, exclusão do próprio PID e `DWMWA_CLOAKED == 0`), extração de `PID`, `processName` e `HICON` -> PNG 32×32 Base64; `EnumDisplayMonitors` para monitores; `RtlGetVersion` para `processAudioSupported`.
2. **Vídeo WGC (`capture/video_wgc.rs`)**: `GraphicsCaptureItem::CreateForWindow` / `CreateForMonitor`, `Direct3D11CaptureFramePool`, scaling proporcional para `720p30` (`1280x720`) ou `1080p60` (`1920x1080`), conversão `BGRA -> I420` usando a crate **`yuv`** com aceleração **SIMD**, callback `Closed` (`source_closed`), e tratamento gracioso de janelas minimizadas ou protegidas por DRM sem derrubar a chamada de voz.
3. **Áudio WASAPI (`capture/audio_wasapi.rs`)**: COM MTA dedicado + `ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK)` com `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`, leitura via `IAudioCaptureClient` emitindo frames contínuos de 10 ms (48 kHz, 2 canais, `i16`, com silêncio quando o jogo está mudo), e fallback seguro (`system_global` ou `none` + `desktop://audio-warning`) em Windows antigo ou monitor inteiro.
4. **Mixagem & Atalhos (`audio/mixer.rs`, `shortcuts/global_shortcut.rs`)**: DSP lock-free (`AtomicU32` + `AtomicBool`) independente do microfone; `tauri-plugin-global-shortcut` com Toggle Mute (`Pressed`) e Push-to-Talk (`Pressed`/`Released`), tratamento de `SHORTCUT_CONFLICT` e aviso de UIPI em jogos como Administrador.
5. **Publicação LiveKit (`media/livekit_publisher.rs`)**: Conexão `Room::connect` (`auto_subscribe: false`) com token scoped `{userId}:screenshare`, `NativeVideoSource` (`TrackSource::Screenshare`) e `NativeAudioSource` (`TrackSource::ScreenshareAudio`, AEC/NS/AGC desabilitados), encerramento coordenado por `CancellationToken` ao parar stream, fechar jogo, trocar de sala ou fechar app.

## Complexity Tracking

> Nenhuma violação da Constitution v1.1.0 foi identificada. Nenhuma entrada necessária.

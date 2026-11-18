# Phase 0 Research: jdisc MVP Unificado (Backend .NET 10 + LiveKit SFU + Desktop Tauri v2)

**Feature**: `001-jdisc-mvp` | **Date**: 2026-11-13

## 1. Backend ASP.NET Core (.NET 10), Clean Architecture & LiveKit Nativo

- **Decision**: Estruturar o backend em 4 projetos (`Jdisc.Domain`, `Jdisc.Application`, `Jdisc.Infrastructure`, `Jdisc.Presentation`) usando Minimal APIs + handlers CQRS explícitos (sem MediatR). Implementar geração nativa de Access Tokens JWT `HS256` do LiveKit via `System.IdentityModel.Tokens.Jwt` e validação manual da assinatura JWT/HMAC-SHA256 dos webhooks do LiveKit no header `Authorization`.
- **Rationale**: Atende diretamente aos Princípios I e V e às Restrições de Stack da Constitution `v1.1.0`, evitando pacotes C# não oficiais da comunidade LiveKit e mantendo domínio isolado de infraestrutura.
- **Alternatives considered**: Pacotes comunitários `Livekit.Server.Sdk.Dotnet` ou MediatR — descartados conforme Constitution `v1.1.0`.

## 2. Fronteira SignalR vs LiveKit Webhooks no Redis (Zero Race Conditions)

- **Decision**:
  - **LiveKit Webhooks (`POST /api/webhooks/livekit`)** são o único ponto autorizado a escrever/remover presença de mídia no Redis (`participant_joined`, `participant_left`, `track_published`, `track_unpublished`).
  - **SignalR (`/hubs/presence`)** atua exclusivamente como canal de notificação broadcast (disparado após atualização do Redis pelo webhook ou na sincronização inicial de estado lido do Redis) e sinalização leve de UI (como estado local de mute/deafen).
  - **Desconexão abrupta**: LiveKit SFU dispara `participant_left` após expiração de heartbeat/ICE (~5–10 s), garantindo limpeza automática no Redis e broadcast via SignalR em < 15 s (`SC-006`).
- **Rationale**: Elimina condições de corrida entre `OnDisconnectedAsync` do SignalR e eventos reais do SFU, conforme Princípios II e III da Constitution `v1.1.0`.

## 3. Estratégia de Publicação LiveKit Rust SDK mantendo Identidade Unificada

- **Decision**: WebView2 (`livekit-client` JS) conecta na sala com `identity = "<userId>"` (voz + assinatura). A camada nativa Rust (`livekit` crate) conecta apenas durante compartilhamento ativo com `identity = "<userId>:screenshare"`, metadata `{"parentUserId":"<userId>","kind":"screenshare"}` e permissões `canPublish: true`, `canSubscribe: false`, `canPublishSources: ["screen_share", "screen_share_audio"]`.
- **Rationale**:
  - Evita desconexão `DUPLICATE_IDENTITY` no LiveKit quando dois pipelines publicam pelo mesmo usuário.
  - `canSubscribe: false` no Rust evita consumo duplicado de banda/CPU.
  - O frontend React suprime explicitamente auto-assinatura e reprodução de `{userId}:screenshare` do próprio usuário local (evitando eco próprio).
  - O processador de webhooks no backend normaliza `{userId}:screenshare` para `parentUserId` no Redis, não contabilizando a conexão companion no limite de 10 participantes por sala.

## 4. Docker Compose com Range UDP Restrito

- **Decision**: Configurar `infra/docker-compose.yml` com PostgreSQL, Redis, API `.NET 10` e LiveKit Server expondo `7880:7880/tcp`, `7881:7881/tcp` e range restrito **`50000-50100:50000-50100/udp`** (configurado em `infra/livekit.yaml` como `port_range_start: 50000` e `port_range_end: 50100`).
- **Rationale**: Evita o esgotamento de memória/travamento de `docker-proxy` no Docker Desktop / WSL2 ao mapear `50000-60000/udp`, atendendo ao Princípio VI e comportando folgadamente até 10 amigos simultâneos.

## 5. Captura Nativa Windows (Enumeração, WGC + `yuv` SIMD, WASAPI Process Loopback)

- **Decision**:
  - **Enumeração (`enumerate.rs`)**: `EnumWindows` filtrando `IsWindowVisible`, `WS_EX_TOOLWINDOW`, título não vazio, exclusão do próprio PID e `DwmGetWindowAttribute(DWMWA_CLOAKED) == 0`; extração de `PID`, nome do `.exe` e `HICON` convertido para PNG Base64; `EnumDisplayMonitors` para monitores; `RtlGetVersion` para detectar suporte a Process Loopback.
  - **Vídeo WGC (`video_wgc.rs`)**: `GraphicsCaptureItem` (`CreateForWindow`/`CreateForMonitor`) + `Direct3D11CaptureFramePool`, scaling proporcional para `1280x720@30fps` ou `1920x1080@60fps`, conversão `BGRA -> I420` usando a crate **`yuv`** com aceleração **SIMD**, observação de `GraphicsCaptureItem::Closed` e tratamento gracioso de janelas minimizadas/DRM.
  - **Áudio WASAPI (`audio_wasapi.rs`)**: Thread COM MTA (`COINIT_MULTITHREADED`) chamando `ActivateAudioInterfaceAsync` com `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` e `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` (captura processo + subprocessos filhos), gerando frames PCM 48 kHz estéreo `i16` de 10 ms contínuos (com preenchimento de silêncio quando ocioso). Fallback seguro para áudio global (`system_global`) ou `none` com evento `desktop://audio-warning` em builds Windows antigos ou monitores inteiros.
  - **Mixagem & Atalhos (`mixer.rs`, `global_shortcut.rs`)**: Ganho/mute via `AtomicU32`/`AtomicBool` no loop PCM sem afetar microfone; `tauri-plugin-global-shortcut` com Toggle Mute / Push-to-Talk e tratamento de conflitos/UIPI.
  - **Empacotamento & Persistência**: Tauri v2 bundle `nsis` (`perUser`, `embedBootstrapper` WebView2) gerando `.exe`, e `tauri-plugin-store` gravando `settings.json` em `%APPDATA%`.

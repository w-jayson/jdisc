# Quickstart & Guia de Validação: jdisc MVP Unificado

**Feature**: `001-jdisc-mvp` | **Date**: 2026-11-13

## 1. Pré-requisitos
- Windows 10 (build 2004+ / 20348+ recomendado) ou Windows 11
- .NET 10 SDK, Rust toolchain (`x86_64-pc-windows-msvc`), Visual Studio Build Tools C++, Node.js 20 LTS+, Docker Desktop

## 2. Subir Infraestrutura e Backend (Docker Compose)
1. Configurar `.env` (derivado de `.env.example`) com `INVITE_CODE`, `JWT_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD`.
2. Subir stack:
   ```powershell
   docker compose -f infra/docker-compose.yml up -d --build
   ```
3. Verificar saúde: `curl http://localhost:5000/health` (API, PostgreSQL, Redis e LiveKit saudáveis).

## 3. Executar Testes Unitários (Constitution v1.1.0 MVP)
- Backend (`Domain` e `Application`): `dotnet test src/backend/Jdisc.sln`
- Desktop Rust: `cargo test --manifest-path src/frontend/src-tauri/Cargo.toml`
- Frontend TS: `npm --prefix src/frontend test` e `npm --prefix src/frontend exec tsc -- --noEmit`

## 4. Executar Cliente Desktop & Gerar `.exe` (NSIS)
- Modo desenvolvimento: `npm --prefix src/frontend run tauri dev`
- Build final `.exe`: `npm --prefix src/frontend run tauri build`
- Artefatos esperados: `src/frontend/src-tauri/target/release/bundle/nsis/jdisc_*_x64-setup.exe` e `src/frontend/src-tauri/target/release/jdisc.exe`

## 5. Validação Ponta a Ponta
1. **Auth & URL**: Informar URL do servidor, tentar registrar com código errado (recusado), registrar com código válido, reiniciar o `.exe` e validar sessão persistida.
2. **Salas & Capacidade**: Visualizar "Geral", "Jogatina", "AFK", entrar com 1 clique, trocar de sala (alerta sonoro), validar bloqueio do 11º participante e remoção automática < 15 s ao fechar app abruptamente.
3. **Controles de Voz**: Mute, Deafen (auto-mute), borda iluminada ao falar, volume individual 0%–200% persistido após reiniciar.
4. **Transmissão Anti-Eco & Mixagem**: Abrir jogo + música no navegador + amigo falando; selecionar janela (`720p30` ou `1080p60`), validar 0% eco/música no stream, zero retorno da própria track `{userId}:screenshare` no transmissor, slider/mute do jogo independente do mic, modo teatro/tela cheia com 2 streams simultâneos e encerramento automático ao fechar o jogo.
5. **Atalho Global**: Configurar Toggle Mute / Push-to-Talk e testar com jogo em tela cheia em primeiro plano (< 200 ms).

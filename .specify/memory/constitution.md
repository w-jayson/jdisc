<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0 (MINOR: material expansion of Principle IV for Tauri v2 desktop packaging & native Rust WASAPI capture)
- Modified principles:
  - IV. Frontend React + TypeScript Desacoplado -> IV. Frontend React + TypeScript Desacoplado e Empacotamento Desktop
  - VI. Infraestrutura Orquestrada via Docker Compose e Observabilidade (clarified Docker Compose services vs Tauri desktop client)
- Modified sections:
  - Restrições de Stack Tecnológica e Segurança (added Tauri v2, Rust + WebView2, and WASAPI Process Loopback for Windows)
- Added sections: None
- Removed sections: None
- Follow-up TODOs:
  - TODO(v1.2.0): Expandir Princípio VII com testes de integração (PostgreSQL, Redis, SignalR e Webhooks) após validação ponta a ponta de áudio e screen sharing.
-->
# jdisc Constitution

## Core Principles

### I. Clean Architecture, Minimal APIs e SignalR no Backend

O backend DEVE ser construído em ASP.NET Core (.NET 10) seguindo estritamente os limites de dependência da Clean Architecture (Domain, Application, Infrastructure e Presentation). A camada de Presentation DEVE expor endpoints HTTP usando Minimal APIs e adotar CQRS leve com handlers explícitos na camada Application (sem dependência obrigatória de MediatR), garantindo que regras de negócio permaneçam isoladas de detalhes de transporte. O SignalR DEVE atuar exclusivamente como canal de notificação broadcast para o frontend (reagindo ao processamento de webhooks ou lendo do Redis) e para sinalização de UI e chat em tempo real (como status de mute local e mensagens).

### II. Mídia via LiveKit SFU (Proibição de P2P Mesh Manual) (NON-NEGOTIABLE)

Todo tráfego de mídia em tempo real (áudio e screen sharing) DEVE ser roteado exclusivamente através de uma instância self-hosted do LiveKit (SFU) executada em Docker. É terminantemente PROIBIDO implementar conexões WebRTC P2P Mesh manuais, gerenciar ICE/SDP diretamente no código de aplicação ou criar servidores de sinalização WebRTC customizados. Os webhooks do LiveKit (`participant_joined`, `participant_left`, `track_published`, `track_unpublished`) SÃO a única fonte da verdade para presença na mídia (quem está conectado na sala de voz ou transmitindo tela).

### III. Separação entre Dados Persistentes (PostgreSQL) e Estado Efêmero (Redis)

Dados persistentes de domínio (usuários, servidores/comunidades, canais, permissões e histórico) DEVEM ser armazenados em PostgreSQL via Entity Framework Core. Estados efêmeros e voláteis das salas (usuários conectados em voz, status de transmissão de tela, presença ativa e metadados transitórios) DEVEM ser mantidos exclusivamente no Redis. Para evitar condições de corrida (race conditions), apenas o fluxo de processamento de webhooks do LiveKit PODE gravar ou remover estado de presença de mídia no Redis; Hubs SignalR NÃO PODEM escrever nem remover presença de mídia no Redis, devendo apenas ler ou repassar notificações. É PROIBIDO persistir estado efêmero de sessão de voz no PostgreSQL ou manter estado compartilhado de salas apenas em memória local do processo da API.

### IV. Frontend React + TypeScript Desacoplado e Empacotamento Desktop

O frontend DEVE ser desenvolvido em React com TypeScript em modo `strict` habilitado (`"strict": true` no `tsconfig.json`), empacotado para Windows como executável standalone (`.exe`) via **Tauri v2** (Rust + WebView2). Toda captura de tela por janela e isolamento de áudio por processo (**WASAPI Process Loopback** por PID) DEVE ser executada na camada nativa Rust do Tauri, mantendo os componentes React desacoplados de chamadas de sistema operacional. A camada React DEVE utilizar o LiveKit Client SDK oficial para conexão e controle de mídia, Zustand para estado de cliente/UI e TanStack Query para estado de servidor/cache HTTP, mantendo componentes de apresentação (UI) desacoplados da lógica direta do LiveKit Client SDK, do cliente SignalR e dos comandos nativos Tauri (via hooks, serviços ou stores dedicados).

### V. Autenticação JWT Própria e Emissão Segura de Tokens

A autenticação de usuários DEVE utilizar tokens JWT próprios emitidos e validados pelo backend ASP.NET Core, protegendo tanto endpoints HTTP quanto conexões de Hubs SignalR. Os tokens de acesso às salas do LiveKit DEVEM ser gerados exclusivamente no servidor (backend) após validação de autenticação e autorização do usuário para o canal solicitado. O frontend NUNCA DEVE possuir a chave secreta da API do LiveKit nem gerar tokens localmente.

### VI. Infraestrutura Orquestrada via Docker Compose e Observabilidade

Todo o ambiente servidor de desenvolvimento e execução (API ASP.NET Core, PostgreSQL, Redis e LiveKit Server) DEVE ser orquestrado via Docker Compose, enquanto o cliente desktop Windows (`.exe`) é empacotado via Tauri v2. No ambiente local via Docker Compose, o LiveKit DEVE operar com um range restrito de portas UDP mapeadas (ex.: `50000-50100:50000-50100/udp`, suficiente para dezenas de conexões simultâneas sem sobrecarregar o `docker-proxy` no Docker Desktop / WSL2) ou utilizar `network_mode: host` em ambientes Linux; é PROIBIDO mapear ranges amplos de portas UDP (como `50000-60000/udp`) no `docker-compose.yml`. Segredos e credenciais NÃO PODEM ser hardcoded no código-fonte ou em arquivos versionados, devendo usar variáveis de ambiente, `.env` (ignorado pelo Git) ou User Secrets. A API DEVE implementar logging estruturado e endpoints de health check (`/health`) cobrindo API, PostgreSQL, Redis e conectividade com o LiveKit.

### VII. Estratégia de Testes e Quality Gates (MVP v1.0.0)

Para a versão `1.0.0` (MVP), os testes obrigatórios SÃO restritos a testes unitários nas camadas Domain e Application, cobrindo invariantes de domínio, validação de permissões de sala e geração/validação dos claims do token LiveKit. Nenhuma funcionalidade que altere regras de permissão, contratos de sala ou emissão de tokens PODE ser considerada concluída sem que os testes unitários correspondentes da camada Domain/Application passem integralmente. Testes de integração completos de infraestrutura (Testcontainers para PostgreSQL/Redis, harnesses de SignalR Hubs e simulação de webhooks do LiveKit) ficam planejados para uma emenda `MINOR` (`1.1.0`) após a validação ponta a ponta do fluxo de áudio e screen sharing.

## Restrições de Stack Tecnológica e Segurança

- **Backend**: ASP.NET Core (.NET 10), Minimal APIs, SignalR, Entity Framework Core (PostgreSQL), driver/abstração oficial de Redis.
- **Integração Server-Side LiveKit (.NET)**: Como a LiveKit não mantém SDK oficial para C#/.NET, o backend DEVE implementar geração nativa de Access Tokens JWT (`HS256`) seguindo o schema de claims do LiveKit com `System.IdentityModel.Tokens.Jwt` (ou `Microsoft.IdentityModel.JsonWebTokens`), além de validação manual de assinatura nos webhooks do LiveKit (`HMAC-SHA256` / JWT no header `Authorization`), sem depender de SDKs server-side não oficiais mantidos por terceiros.
- **Mídia**: LiveKit Server (SFU) self-hosted em container Docker, com configuração explícita de rede e range restrito de portas UDP (`50000-50100/udp` no Docker Compose ou `network_mode: host` em Linux).
- **Frontend & Desktop**: React + TypeScript (`strict: true`), empacotado para Windows (`.exe`) via **Tauri v2** (Rust + WebView2), com captura de janela e isolamento de áudio por processo (**WASAPI Process Loopback** por PID) na camada nativa Rust; LiveKit Client SDK, cliente oficial `@microsoft/signalr`, Zustand e TanStack Query.
- **Segurança**:
  - Validação obrigatória da assinatura dos webhooks enviados pelo LiveKit antes de atualizar o Redis ou disparar notificações broadcast via SignalR.
  - Proibição absoluta de chaves de API, senhas de banco, secrets JWT ou credenciais do LiveKit versionadas no repositório.
  - Endpoints de emissão de token LiveKit DEVEM verificar se o usuário autenticado possui permissão de ingresso na sala/canal antes de assinar o JWT do LiveKit.

## Fluxo de Desenvolvimento e Portões de Qualidade

1. **Conformidade Arquitetural**: Toda nova especificação (`/speckit-specify`), plano (`/speckit-plan`) e implementação (`/speckit-implement`) DEVE ser verificada contra os 7 princípios desta Constitution antes de avançar.
2. **Isolamento de Dependências**: Pull requests ou alterações que introduzam dependências proibidas (ex.: bibliotecas P2P WebRTC manuais, pacotes não oficiais de SDK server-side LiveKit em .NET, chamadas do Domain para Infrastructure, escrita de presença de mídia no Redis via Hub SignalR, ou geração de token LiveKit no frontend) DEVEM ser rejeitadas.
3. **Verificação Local Reproduzível**: Alterações de infraestrutura DEVEM manter o `docker compose up` funcional e leve (sem mapeamento de milhares de portas UDP), com health checks saudáveis em `/health`.
4. **Cobertura Obrigatória (MVP)**: Novos handlers na Application e regras de domínio/permissão DEVEM incluir os respectivos testes unitários passando antes da conclusão da tarefa.

## Governança

Esta Constitution prevalece sobre quaisquer preferências ad-hoc de implementação, guias informais ou convenções implícitas no repositório `jdisc`. Emendas a este documento exigem: (1) descrição clara da motivação técnica, (2) atualização da versão seguindo Versionamento Semântico (`MAJOR` para remoção ou alteração incompatível de princípio, `MINOR` para adição ou expansão material de princípio/seção — como a futura inclusão dos testes de integração na `1.1.0`, `PATCH` para ajustes editoriais ou clarificações sem mudança de regra), e (3) atualização da data `Last Amended`. Toda exceção temporária a qualquer regra (especialmente ao Princípio II ou V) DEVE ser documentada explicitamente com justificativa técnica e plano de remoção.

**Version**: 1.1.0 | **Ratified**: 2026-11-13 | **Last Amended**: 2026-11-13

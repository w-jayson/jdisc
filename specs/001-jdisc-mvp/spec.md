# Feature Specification: jdisc MVP — Cliente Desktop Windows de Voz e Transmissão de Jogos

**Feature Branch**: `001-jdisc-mvp`

**Created**: 2026-11-13

**Status**: Clarified

**Input**: Especificação unificada do MVP do **jdisc**, combinando autenticação, salas de voz fixas, presença em tempo real, controles de áudio, visualização multi-stream e empacotamento desktop standalone para Windows 10/11 (`.exe`) com captura por janela/monitor, isolamento de áudio por árvore de processos e atalhos globais.

## Clarifications

### Session 2026-11-13 (Unificada — precedência para decisões desktop `002`)

- Q: Como impedir que desconhecidos criem conta na instância privada? → A: Código de convite compartilhado configurado no servidor/ambiente, obrigatório no formulário de cadastro.
- Q: Qual deve ser o comportamento ao tentar entrar em uma sala já com 10 participantes? → A: Bloquear entrada com notificação visual clara ("Sala cheia — máximo 10 participantes") e manter o usuário conectado na sala anterior (se houver).
- Q: Quais limites de resolução e FPS devem existir para a transmissão de tela? → A: Seleção de preset pelo transmissor (`720p@30fps` para economia ou `1080p@60fps` para jogos), com áudio isolado opcional.
- Q: Como a captura nativa de vídeo/áudio do aplicativo desktop deve ser publicada na sala de mídia? → A: Publicar os streams capturados diretamente a partir da camada nativa sem trafegar frames brutos pelo canal da interface, mantendo a identidade unificada do participante e sincronizando o estado via comandos/eventos locais.
- Q: Como lidar com jogos ou aplicativos em que o áudio é emitido por um processo filho da janela selecionada? → A: Capturar a árvore de processos (processo selecionado + processos filhos) no modo inclusivo, evitando perda de som em jogos com launcher/subprocessos.
- Q: O que deve acontecer em versão antiga do Windows sem suporte a isolamento por processo? → A: Exigir Windows 10 2004+ / Windows 11 para isolamento por processo; em builds antigas sem suporte, bloquear o isolamento com aviso claro e oferecer fallback para captura sem áudio ou áudio global do sistema.
- Q: Quantas transmissões simultâneas um mesmo usuário pode iniciar e o que acontece ao trocar de sala? → A: Máximo de 1 transmissão de tela ativa por usuário simultaneamente (até 10 transmissões na sala), encerrando automaticamente a transmissão atual ao trocar de sala.
- Q: Como o aplicativo desktop `.exe` descobre o endereço do servidor do grupo? → A: Tela inicial/configurações permite informar ou salvar a URL do servidor `jdisc` (com valor padrão configurável via build), permitindo apontar para `localhost` ou domínio/IP do host do grupo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Executável Desktop para Windows 10/11 e Servidor Configurável (Priority: P1)

Um usuário do grupo instala ou executa o aplicativo **jdisc** diretamente no Windows 10 ou Windows 11 por meio de um binário/instalador `.exe` standalone, informando (ou usando o padrão) o endereço do servidor do grupo, sem depender de navegador externo e preservando suas preferências localmente.

**Why this priority**: O cliente desktop standalone é o ponto de entrada único da aplicação e habilita os recursos nativos de captura, isolamento de áudio e atalhos globais.

**Independent Test**: Executar o `.exe` gerado em máquina Windows 10/11 limpa (sem navegador aberto), configurar a URL do servidor, fechar e reabrir o app confirmando a persistência das preferências locais.

**Acceptance Scenarios**:

1. **Given** um usuário no Windows 10 ou Windows 11 com o arquivo `.exe` do jdisc, **When** inicia o aplicativo, **Then** a janela desktop abre com a tela de conexão/autenticação (permitindo usar a URL padrão configurada ou informar o endereço do servidor do grupo) sem abrir ou exigir navegador externo.
2. **Given** um usuário autenticado no aplicativo desktop, **When** fecha e reabre o aplicativo, **Then** suas preferências locais (URL do servidor, sessão ativa, volumes individuais, mixagem da transmissão e atalho global) permanecem preservadas.

---

### User Story 2 - Autenticação com Código de Convite e Sessão Persistente (Priority: P1)

Um membro do grupo cria sua conta informando nome de exibição, e-mail, senha e o código de convite compartilhado, faz login e mantém sua sessão ativa entre reinicializações do aplicativo desktop, impedindo qualquer acesso não autenticado.

**Why this priority**: Garante privacidade ao grupo fechado de amigos e fornece a identidade única necessária para presença em sala, chamadas de voz e transmissões.

**Independent Test**: Tentar cadastrar com código de convite inválido (recusado), cadastrar com código válido, fazer logout, realizar login, reiniciar o aplicativo desktop para validar sessão persistida e confirmar que requisições sem credencial são bloqueadas.

**Acceptance Scenarios**:

1. **Given** um visitante não autenticado na tela de cadastro, **When** preenche nome de exibição, e-mail válido, senha e código de convite válido e confirma o registro, **Then** a conta é criada e o usuário é autenticado na aplicação.
2. **Given** um visitante não autenticado na tela de cadastro, **When** informa código de convite inválido ou ausente, **Then** o cadastro é recusado com mensagem de erro clara e nenhuma conta é criada.
3. **Given** um usuário já cadastrado na tela de login, **When** informa e-mail e senha corretos, **Then** a sessão é iniciada e permanece ativa mesmo após reiniciar o aplicativo.
4. **Given** um visitante não autenticado, **When** tenta acessar diretamente a lista de salas, a visualização de presença ou uma chamada, **Then** o acesso é negado e o visitante é direcionado para autenticação.

---

### User Story 3 - Salas de Voz Fixas e Presença em Tempo Real (Priority: P1)

Ao entrar autenticado no aplicativo, o usuário visualiza a lista fixa de salas de voz ("Geral", "Jogatina", "AFK") e acompanha em tempo real quais amigos estão conectados em cada sala e quem está transmitindo tela ("Ao Vivo"), mesmo antes de ingressar em qualquer chamada.

**Why this priority**: A visibilidade imediata da disponibilidade dos amigos nas salas é o ponto central de navegação da experiência diária.

**Independent Test**: Conectar dois usuários autenticados onde o Usuário A observa o painel de salas enquanto o Usuário B entra, troca ou sai de uma sala, verificando atualização instantânea sem recarregar o app.

**Acceptance Scenarios**:

1. **Given** um usuário autenticado na tela principal, **When** a aplicação carrega, **Then** todas as salas de voz fixas são exibidas com a lista atual de participantes conectados em cada uma.
2. **Given** um usuário observando a lista de salas fora de chamada, **When** outro usuário entra, sai ou inicia/encerra transmissão de tela, **Then** a lista de participantes e o indicador "Ao Vivo" são atualizados em tempo real na tela do observador.

---

### User Story 4 - Conexão em Call, Troca Automática de Sala e Alertas (Priority: P1)

Com um clique, o usuário entra em uma sala de voz. Se já estiver em outra sala, sua eventual transmissão ativa é encerrada e ele é movido automaticamente para a nova sala. Ao entrar ou sair, todos os participantes da sala ouvem um alerta sonoro discreto e veem a lista atualizar instantaneamente, respeitando o limite de 10 participantes por sala e removendo usuários em caso de desconexão abrupta.

**Why this priority**: Entrar, trocar de sala com segurança e conversar por voz forma o núcleo funcional indispensável do MVP.

**Independent Test**: Entrar em "Geral", conversar com um segundo participante, clicar em "Jogatina" para validar transferência automática e alertas sonoros, testar bloqueio na 11ª conexão e fechar abruptamente a janela de um cliente para validar limpeza automática em poucos segundos.

**Acceptance Scenarios**:

1. **Given** um usuário autenticado fora de chamada, **When** clica em uma sala de voz com menos de 10 participantes, **Then** conecta à chamada de áudio, aparece na lista da sala e os demais participantes ouvem o alerta sonoro de entrada.
2. **Given** um usuário conectado na sala "Geral", **When** clica na sala "Jogatina" (com vaga disponível), **Then** é desconectado de "Geral" (encerrando eventual transmissão ativa e tocando alerta de saída para quem ficou em "Geral") e conectado em "Jogatina" (com alerta de entrada para quem está lá).
3. **Given** uma sala já com 10 participantes conectados, **When** um 11º usuário tenta entrar nessa sala, **Then** a entrada é bloqueada com a notificação `"Sala cheia — máximo 10 participantes"`; se já estava em outra sala, permanece conectado na sala anterior sem interrupção.

---

### User Story 5 - Controles de Áudio da Chamada e Volume Individual (Priority: P2)

Durante a chamada, o usuário pode mutar/desmutar o próprio microfone (Mute), ensurdecer a si mesmo (Deafen — silenciando todo o áudio recebido e mutando automaticamente o próprio microfone), visualizar uma borda iluminada ao redor do avatar de quem está falando e ajustar o volume individual (0% a 200%) de cada participante com persistência local.

**Why this priority**: Controles de privacidade do microfone, feedback visual de fala e equilíbrio de volume entre amigos são essenciais para conforto contínuo em chamadas de grupo.

**Independent Test**: Em chamada com 2+ participantes, acionar Mute e Deafen, falar para verificar borda iluminada, ajustar volume de um amigo para 150%, reiniciar o app e confirmar que o ganho 150% permanece aplicado.

**Acceptance Scenarios**:

1. **Given** um usuário em chamada com microfone ativo, **When** ativa o Mute, **Then** sua captura de áudio é interrompida para os demais participantes e seu estado mutado é refletido visualmente.
2. **Given** um usuário em chamada, **When** ativa o Deafen, **Then** todo áudio recebido dos demais participantes é silenciado e seu próprio microfone é mutado automaticamente.
3. **Given** participantes em chamada, **When** um participante fala no microfone (não mutado), **Then** uma borda iluminada aparece ao redor do seu avatar para os participantes da sala enquanto houver fala ativa.
4. **Given** um usuário ajustando o volume de outro participante entre 0% e 200%, **When** define 150% e reinicia o aplicativo desktop no mesmo computador, **Then** o volume 150% permanece salvo e aplicado.

---

### User Story 6 - Seletor de Aplicativo/Jogo e Monitor Inteiro (Priority: P1)

Ao clicar em "Transmitir Tela" dentro de uma sala de voz, o usuário visualiza um seletor com a lista de janelas/aplicativos abertos no Windows — exibindo título da janela, ícone e identificação do processo — além das opções de monitor inteiro e escolha de preset de qualidade (`720p@30fps` ou `1080p@60fps`).

**Why this priority**: Permite selecionar exatamente o jogo ou janela desejada (diferenciando inclusive múltiplas instâncias) antes de iniciar a captura.

**Independent Test**: Abrir múltiplos aplicativos/jogos (incluindo duas instâncias do mesmo app), clicar em "Transmitir Tela" e verificar exibição de títulos, ícones, identificadores de processo, monitores e presets em menos de 1 segundo.

**Acceptance Scenarios**:

1. **Given** um participante conectado em uma sala de voz com jogos e aplicativos abertos no Windows, **When** clica em "Transmitir Tela", **Then** um seletor exibe as janelas/aplicativos elegíveis com título, ícone e nome/ID do processo, as opções de monitores disponíveis e os presets `720p@30fps` e `1080p@60fps`.
2. **Given** o seletor aberto, **When** o usuário escolhe uma janela específica ou monitor inteiro e confirma, **Then** a captura e transmissão iniciam apenas da fonte selecionada no perfil de qualidade escolhido.

---

### User Story 7 - Isolamento de Áudio por Processo (Anti-Eco) e Transmissão Nativa (Priority: P1)

Ao transmitir uma janela de jogo ou aplicativo específico com áudio habilitado, o sistema captura exclusivamente o áudio gerado pela árvore de processos do aplicativo selecionado (processo principal e subprocessos), bloqueando retorno da voz dos amigos e sons de outros programas, publicando o stream diretamente com identidade unificada do participante e sem reproduzir a própria transmissão de volta para o transmissor.

**Why this priority**: Evita eco da chamada de voz e vazamento de som de outros aplicativos durante partidas, garantindo latência mínima e fidelidade de jogo.

**Independent Test**: Transmitir um jogo enquanto outro participante fala na sala e música toca em segundo plano; confirmar que espectadores ouvem apenas o áudio do jogo (0% eco/terceiros), que o transmissor não recebe retorno da própria track e que fechar o jogo encerra a transmissão mantendo a voz ativa.

**Acceptance Scenarios**:

1. **Given** um participante transmitindo a janela de um jogo enquanto amigos falam na sala e outro app toca música em segundo plano, **When** o jogo emite efeitos sonoros, **Then** os espectadores recebem apenas o áudio da árvore de processos do jogo, sem eco da chamada nem som de outros programas, e o transmissor não ouve a própria transmissão de volta.
2. **Given** o usuário escolhendo transmitir um monitor inteiro ou executando em build antigo do Windows sem suporte a isolamento por processo, **When** inicia a transmissão, **Then** o sistema informa claramente a limitação/risco de eco e permite continuar sem áudio ou com áudio global do sistema.
3. **Given** um participante com transmissão de tela ativa, **When** o jogo/janela transmitida é fechada no Windows ou o participante encerra manualmente o compartilhamento, **Then** a transmissão de tela é finalizada e o selo "Ao Vivo" desaparece, mantendo-o conectado na chamada de voz.

---

### User Story 8 - Visualização Multi-Stream e Mixagem Independente do Transmissor (Priority: P2)

Múltiplos usuários podem transmitir tela simultaneamente na mesma sala (máximo 1 transmissão ativa por participante). Os espectadores veem o indicador "Ao Vivo", assistem ao stream escolhido em visualização padrão, modo teatro ou tela cheia e alternam qual transmissão está em destaque, enquanto o transmissor pode mutar ou ajustar o volume do áudio do jogo (0%–100%) de forma independente do microfone.

**Why this priority**: Completa a experiência colaborativa de assistir aos jogos de vários amigos na mesma sala com controle confortável de áudio tanto para quem assiste quanto para quem transmite.

**Independent Test**: Com 2 participantes transmitindo na mesma sala, alternar entre os streams nos modos teatro e tela cheia e ajustar o volume/mute do áudio do jogo no transmissor sem afetar o microfone.

**Acceptance Scenarios**:

1. **Given** dois participantes transmitindo tela simultaneamente na mesma sala, **When** um espectador seleciona a primeira e depois alterna para a segunda transmissão, **Then** o destaque principal troca instantaneamente e pode ser exibido em modo padrão, teatro ou tela cheia sem interromper a chamada de voz.
2. **Given** um participante transmitindo um jogo com áudio, **When** ajusta o controle de volume (0%–100%) ou ativa o mute do áudio da transmissão, **Then** os espectadores ouvem a alteração sem afetar o volume ou o estado de mute do microfone do transmissor.

---

### User Story 9 - Atalho Global de Teclado (Mute / Push-to-Talk) em Tela Cheia (Priority: P2)

O usuário pode configurar uma combinação global de teclas nas configurações do aplicativo desktop para alternar o mute do microfone (Toggle Mute) ou operar em modo Push-to-Talk, funcionando mesmo com um jogo em tela cheia em primeiro plano.

**Why this priority**: Evita que jogadores precisem sair do foco de jogos em tela cheia para mutar ou falar na chamada.

**Independent Test**: Configurar um atalho global, abrir um jogo em tela cheia com foco exclusivo e pressionar o atalho para confirmar alternância imediata do microfone na sala.

**Acceptance Scenarios**:

1. **Given** um usuário autenticado nas configurações de áudio do aplicativo desktop, **When** define uma combinação de teclas (modo Toggle Mute ou Push-to-Talk) e salva, **Then** o atalho é persistido localmente e passa a valer imediatamente.
2. **Given** um jogo em execução em tela cheia com foco ativo no Windows, **When** o usuário aciona o atalho global configurado, **Then** o microfone é mutado/desmutado (ou ativado enquanto pressionado no modo Push-to-Talk) sem tirar o foco da janela do jogo.

---

### Edge Cases

- **Capacidade máxima da sala (10 participantes)**: O sistema impede o ingresso de um 11º participante exibindo `"Sala cheia — máximo 10 participantes"` e preservando a conexão caso ele estivesse tentando migrar de outra sala; a transmissão de tela do participante não pode contar como 2º ocupante da sala.
- **Desconexão abrupta (queda de rede ou fechamento do `.exe`)**: O participante e sua eventual transmissão de tela devem ser removidos automaticamente da sala em poucos segundos, notificando os demais.
- **Código de convite inválido no cadastro**: Tentativas de registro sem código válido devem ser rejeitadas sem criar conta.
- **Aplicativo transmitido fechado inesperadamente**: Encerra automaticamente apenas a transmissão de tela com aviso discreto ao transmissor, mantendo a chamada de voz ativa.
- **Janela minimizada ou protegida (conteúdo DRM / tela preta)**: Caso uma janela seja minimizada ou bloqueie captura gráfica, o sistema deve lidar graciosamente sem travar a chamada de voz nem encerrar o aplicativo, notificando quando a fonte estiver indisponível.
- **Múltiplas instâncias do mesmo aplicativo/jogo**: O seletor deve diferenciar janelas com títulos similares exibindo nome e identificador do processo.
- **Aplicativo sem saída de áudio no momento da seleção**: Jogos silenciosos ou mutados localmente não devem gerar erro nem travar a publicação de áudio ao ativar o isolamento por processo.
- **Versão do Windows sem suporte a isolamento por processo**: Em builds do Windows 10 anteriores à 2004, o aplicativo informa claramente a limitação e oferece continuar sem áudio ou com áudio global do sistema.
- **Troca de sala durante transmissão ativa**: Ao clicar em outra sala de voz enquanto transmite tela, a transmissão ativa na sala anterior é encerrada automaticamente antes da entrada na nova sala.
- **Conflito de atalho global ou jogo como Administrador**: Se o atalho estiver reservado pelo Windows/outro app, a interface informa o conflito; se o jogo rodar com privilégios elevados, a interface orienta o usuário sobre a limitação de interceptação do sistema operacional.
- **Interação entre Deafen e Mute**: Ao desativar o Deafen, o áudio recebido é restaurado; se o usuário tentar desmutar o microfone enquanto está em Deafen, o Deafen é desativado automaticamente para evitar estado inconsistente de "falando sem ouvir".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE gerar um pacote executável/instalador standalone (`.exe`) compatível com Windows 10 e Windows 11 que execute o cliente completo do **jdisc** sem depender de navegador externo, permitindo informar e salvar a URL do servidor do grupo (com valor padrão configurável no build).
- **FR-002**: O aplicativo desktop DEVE preservar localmente preferências do usuário entre reinicializações (URL do servidor, sessão autenticada, volumes individuais de 0% a 200%, mixagem da transmissão e atalho global configurado).
- **FR-003**: O sistema DEVE permitir o registro de novos usuários mediante nome de exibição, e-mail único, senha e código de convite compartilhado válido configurado no servidor.
- **FR-004**: O sistema DEVE autenticar usuários por e-mail e senha, manter a sessão ativa e bloquear qualquer acesso não autenticado à listagem de salas, presença online, chamadas ou transmissões.
- **FR-005**: O sistema DEVE disponibilizar uma lista fixa de salas de voz pré-configuradas ("Geral", "Jogatina", "AFK") e atualizar em tempo real os participantes conectados e indicadores "Ao Vivo" para todos os usuários autenticados.
- **FR-006**: O sistema DEVE permitir entrar em uma sala de voz com um clique e mover automaticamente o usuário caso já esteja em outra sala (encerrando eventual transmissão ativa na sala anterior).
- **FR-007**: O sistema DEVE limitar cada sala de voz a no máximo 10 participantes simultâneos (sem contabilizar transmissões de tela como participantes extras), bloqueando a entrada do 11º participante com `"Sala cheia — máximo 10 participantes"` e mantendo-o conectado em eventual sala anterior.
- **FR-008**: O sistema DEVE reproduzir alerta sonoro discreto na entrada/saída de participantes e remover automaticamente participantes e transmissões em poucos segundos em caso de desconexão abrupta.
- **FR-009**: O sistema DEVE oferecer controles de Mute, Deafen (silenciando áudio recebido e mutando microfone automaticamente), indicador visual de fala ativa (borda iluminada no avatar) e ajuste de volume individual por participante (0% a 200%) persistido localmente.
- **FR-010**: Ao acionar "Transmitir Tela", o sistema DEVE listar dinamicamente janelas/aplicativos abertos elegíveis no Windows (exibindo título, ícone e nome/identificador do processo) e monitores disponíveis, permitindo escolher o preset `720p@30fps` ou `1080p@60fps`.
- **FR-011**: Ao transmitir uma janela/aplicativo específico com áudio habilitado, o sistema DEVE capturar e transmitir exclusivamente o áudio gerado pela árvore de processos do aplicativo selecionado (processo principal e subprocessos), bloqueando áudio da chamada de voz e de outros aplicativos.
- **FR-012**: Ao transmitir um monitor inteiro (ou em builds do Windows sem suporte a isolamento por processo), o sistema DEVE permitir captura sem áudio ou captura de áudio global do sistema com aviso claro sobre possível eco/ausência de isolamento.
- **FR-013**: Os streams capturados nativamente devem ser publicados sob identidade unificada do participante (máximo 1 transmissão ativa por participante, até 10 na sala) e o aplicativo local do transmissor NÃO DEVE auto-assinar nem reproduzir o próprio áudio/vídeo transmitido.
- **FR-014**: O transmissor DEVE poder mutar, desmutar e ajustar continuamente o volume do áudio do aplicativo transmitido (0% a 100%) independentemente do microfone, além de poder encerrar a transmissão sem sair da chamada de voz (ou tê-la encerrada automaticamente se a janela fechar).
- **FR-015**: Os espectadores na sala DEVEM visualizar o selo "Ao Vivo", poder assistir às transmissões em visualização padrão, modo teatro ou tela cheia e alternar qual transmissão está em destaque quando houver múltiplas transmissões simultâneas.
- **FR-016**: O sistema DEVE permitir configurar atalho global de teclado (Toggle Mute e Push-to-Talk) funcional em segundo plano mesmo com jogos em tela cheia, exibindo feedback claro em caso de conflito de atalho ou falha de captura.

### Key Entities *(include if feature involves data)*

- **Usuário**: Membro do grupo fechado com identificador único, nome de exibição, e-mail, hash de credencial e data de criação.
- **Sala de Voz**: Canal fixo pré-configurado ("Geral", "Jogatina", "AFK") com identificador, nome, ordem de exibição e capacidade máxima fixa de 10 participantes.
- **Participação Ativa em Sala**: Presença efêmera de um usuário autenticado em uma sala de voz, contendo estado de microfone, Deafen e flag/referência de transmissão de tela ativa ("Ao Vivo").
- **Fonte de Captura**: Alvo selecionável para transmissão (janela com identificador, título, ícone e processo/PID, ou monitor inteiro com resolução).
- **Configuração Local do Cliente (`AppSettings`)**: Preferências persistidas localmente contendo URL do servidor, sessão autenticada, volumes individuais de participantes (0%–200%), mixagem da transmissão (0%–100% e mute) e configuração de atalho global (modo e teclas).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O aplicativo desktop `.exe` inicia e apresenta a interface pronta em até 5 segundos em máquinas Windows 10/11 padrão, permitindo login e ingresso em sala em menos de 1 minuto.
- **SC-002**: Alterações de entrada, saída, troca de sala e início/fim de transmissão são refletidas na lista de presença de todos os usuários autenticados em até 2 segundos.
- **SC-003**: O seletor de transmissão lista janelas abertas e monitores em até 1 segundo após o clique em "Transmitir Tela".
- **SC-004**: Durante transmissão de jogo com isolamento de áudio ativo, 0% do áudio de voz dos participantes da chamada e de aplicativos não selecionados é retransmitido na trilha de áudio do stream.
- **SC-005**: Alterações no volume/mute da transmissão refletem para os espectadores em menos de 500 ms sem afetar o microfone; o atalho global altera o estado do microfone em menos de 200 ms mesmo com jogo em tela cheia.
- **SC-006**: Em desconexão abrupta, o participante fantasma e sua transmissão são removidos automaticamente da sala em até 15 segundos.
- **SC-007**: Preferências locais (URL do servidor, volumes individuais 0%–200%, mixagem e atalho global) permanecem preservadas após reiniciar o aplicativo desktop.

## Assumptions

- O grupo fechado de até 10 amigos utiliza uma instância privada protegida por código de convite compartilhado configurado no servidor.
- As salas de voz ("Geral", "Jogatina", "AFK") são fixas e pré-definidas no MVP (sem criação/edição dinâmica de salas).
- O cliente alvo desta entrega é o aplicativo desktop para **Windows 10 (2004+ para isolamento por processo, com fallback em builds anteriores) e Windows 11**.
- A publicação nativa de vídeo/áudio evita tráfego de frames brutos pelo canal da interface, mantendo identidade unificada do participante na sala.

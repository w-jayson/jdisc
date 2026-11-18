## Resumo

<!-- Descreva brevemente o que foi alterado e o motivo -->

## Tipo de mudança

- [ ] Correção de bug (`fix`)
- [ ] Nova funcionalidade (`feat`)
- [ ] Refatoração / melhoria (`refactor`)
- [ ] Infraestrutura / CI / Docs (`chore`, `ci`, `docs`)

## Checklist

- [ ] `dotnet test src/backend/Jdisc.sln` passa sem erros (se alterou o backend)
- [ ] `npm test` e `npm run build` em `src/frontend` passam sem erros (se alterou o frontend)
- [ ] `cargo check` em `src/frontend/src-tauri` passa sem erros (se alterou o cliente Tauri/Rust)
- [ ] Nenhum segredo ou arquivo `.env` real foi incluído no commit

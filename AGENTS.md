# AGENTS.md — crisp-conversation-export

CLI Node.js operacional que exportou o histórico de conversas do Crisp para JSONL, para a migração do atendimento para a Intercom. O repositório é o registro de como a exportação foi feita. Contexto de negócio: [docs/migracao-crisp-intercom.md](docs/migracao-crisp-intercom.md). Uso e dicionário dos arquivos gerados: [README.md](README.md).

## Stack

- Node.js >= 18 (CommonJS, só `node:` built-ins + `crisp-api` + `dotenv`). Sem build, sem TypeScript.
- Testes: `node --test` (sem framework externo).

## Comandos

| Comando | O que faz | Gasta cota da API? |
| --- | --- | --- |
| `npm test` | roda `test/` | não |
| `npm run forecast` / `forecast:30d` | estima volume e dias de cota | sim (poucas requests) |
| `npm run export` / `export:resume` | dump completo em `export/` | sim (dias de cota) |
| `npm run remains` | continua o export remanescente ativo | sim |
| `npm run remains -- --new <corte ISO>` | arquiva o export ativo e começa outro | sim |

## Estrutura

```
src/cli/      entradas dos scripts npm (orquestração e argumentos)
src/crisp/    toda chamada HTTP ao Crisp (cliente com retry, cota, listagem, meta, eventos, mensagens)
src/storage/  leitura/escrita de arquivos (checkpoint, manifest, índice do export conhecido)
src/core/     regras sem acesso direto à API ou a arquivos (normalização, patch, datas, previsão)
test/         espelha src/
```

Toda chamada `client.website.*` fica em `src/crisp/`. Leitura e escrita de arquivos de export ficam em `src/storage/`.

## Limites

- **Sempre:** rode `npm test` depois de mudar código. Mantenha mudanças pequenas e no padrão das pastas acima.
- **Pergunte antes:** de rodar qualquer comando que gaste cota (tabela acima), de usar `--new` (arquiva o export ativo) e de apagar ou mover qualquer coisa em `export/`.
- **Nunca:** leia, imprima ou commite `.env` e credenciais. Não use `POST .../transcript` (envia e-mail). Não use dados reais de `export/` em testes, exemplos ou respostas: veja [.claude/rules/export-data.md](.claude/rules/export-data.md).

## Regras e skills

| Arquivo | Quando carrega |
| --- | --- |
| [.claude/rules/export-data.md](.claude/rules/export-data.md) | sempre |
| [.claude/rules/crisp-api.md](.claude/rules/crisp-api.md) | ao mexer em `src/crisp/**` ou `src/core/forecast.js` |
| [.claude/skills/export-crisp-conversations/](.claude/skills/export-crisp-conversations/SKILL.md) | ao pedir para exportar, retomar ou estimar a exportação |

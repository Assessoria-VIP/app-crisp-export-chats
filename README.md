# Exportação de conversas do Crisp

CLI Node.js que extrai conversas e mensagens da API REST do Crisp para JSONL. A API não oferece dump em lote: a extração pagina listagens e, por conversa, busca meta e histórico de mensagens.

A tarefa de migração para a Intercom (motivação, processo, limitações e prazo) está em [docs/migracao-crisp-intercom.md](docs/migracao-crisp-intercom.md).

## Estrutura

```
src/
  cli/       pontos de entrada dos scripts npm (export-conversations, export-remaining)
  crisp/     tudo que faz HTTP para a API do Crisp: cliente com retry, cota, listagem, meta, eventos e mensagens
  storage/   leitura e escrita de arquivos: checkpoint.json, manifest.json e índice do conversations.jsonl já exportado
  core/      regras sem acesso direto à API ou a arquivos: normalização, patch de delta, janela de datas, previsão
test/        testes (node --test), espelhando as pastas de src/
```

Para agentes de IA: [AGENTS.md](AGENTS.md) (carregado pelo Claude Code via `CLAUDE.md`), regras em `.claude/rules/` e a skill `export-crisp-conversations` em `.claude/skills/`.

## Configuração

1. Gere um **Website Token** no Crisp: Settings → Workspace Settings (cota de 10.000 requests/dia). Alternativa: Plugin Token no Marketplace.
2. Copie o `website_id` em Settings → Workspace Settings → Setup Instructions.
3. Crie o `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Preencha:

```
CRISP_WEBSITE_ID=...
CRISP_IDENTIFIER=...
CRISP_KEY=...
CRISP_TIER=website
```

`CRISP_TIER` é `website` ou `plugin`. O header `Authorization` Basic é montado pela lib; não grave o Base64 no `.env`. Cota customizada: `CRISP_DAILY_LIMIT`.

```bash
npm install
```

## Uso

```bash
npm run forecast
npm run forecast:30d
npm run export
npm run export:resume
npm run export:30d
npm run export:30d:resume
```

`npm run forecast` conta as conversas (a API não devolve um total; o CLI acha a última página por busca exponencial) e estima quantos dias a extração leva na cota diária. Amostra 8 conversas por padrão para calibrar lotes de mensagens.

O dump **completo** e o de `--days` listam todas as páginas (a API devolve a mais recente primeiro) e **reordenam por `created_at` crescente** antes de gravar. Assim conversas novas do dia não entram no começo do JSONL nem deslocam o restante; o `--resume` só acrescenta o que ainda falta, do mais antigo para o mais novo.

`--days 30` limita à janela dos últimos 30 dias (filtro da API pela data de **atualização**), grava em `export/last-30d/` (não mistura com o dump completo). O intervalo fica congelado no checkpoint para o `--resume` não deslocar a janela.

Opções:

```bash
node src/cli/export-conversations.js --out ./export/completed-exports/full-export \
  [--forecast] \
  [--days 30] \
  [--sample 8] \
  [--daily-limit 10000] \
  [--resume] \
  [--include-empty] \
  [--include-events] \
  [--date-start 2018-03-01T17:00:00.000Z] \
  [--date-end 2018-04-01T10:30:00.000Z] \
  [--max-conversations 10]
```

Não combine `--days` com `--date-start` / `--date-end`. Sem `--out`, `--days N` usa `./export/last-Nd`.

Saída em `--out` (default `./export/completed-exports/full-export`):

- `conversations.jsonl` — uma conversa por linha
- `checkpoint.json` — progresso para `--resume` (cota diária)
- `manifest.json` — contagens e erros
- `forecast.json` — previsão de volume e dias (quando `--forecast`)

Campos e uso de cada arquivo: [Dicionário dos arquivos gerados](#dicionário-dos-arquivos-gerados).

Em HTTP 429/420 o script espera e tenta de novo; se a cota do dia acabar, grave o checkpoint e rode `npm run export:resume` depois.

Não use `POST .../transcript` em massa: isso envia e-mail, não devolve o histórico.

## Exportação remanescente (pós-corte)

Depois de uma exportação completa (em `./export/completed-exports/full-export`), pega as conversas **criadas ou atualizadas** depois de um corte, sem reprocessar o que já foi exportado.

### Onde os dados ficam

```
export/
  active-export-chats/              export remanescente ATIVO: toda execução de `npm run remains` grava ou continua aqui
  completed-exports/                exportações encerradas
    full-export/                    exportação completa (`npm run export`) — referência do remanescente
    archived-export-chats/          export remanescente anterior, arquivado quando um novo é iniciado com `--new`
```

A exportação completa **não é alterada** pelo remanescente: o `conversations.jsonl` dela só é lido (`--known-dir ./export/completed-exports/full-export`) para montar um índice `session_id` → timestamp da última mensagem. Esse índice decide o que é conversa nova (exportada inteira) e o que é conhecida (só o delta). **Ele é obrigatório:** sem esse arquivo o `npm run remains` aborta antes de mover ou gravar qualquer coisa. Um arquivo parcial faria toda conversa ausente ser reexportada inteira. O remanescente tem **um único export ativo**, sempre no mesmo caminho.

Os arquivos de cada pasta estão descritos em [Dicionário dos arquivos gerados](#dicionário-dos-arquivos-gerados). Os dois `.jsonl` crescem por append a cada execução. Consolidado final: `export/completed-exports/full-export/conversations.jsonl` + `conversations.jsonl` do export ativo + mensagens de `conversations-updated.jsonl` acrescentadas à conversa original (deduplicando por `fingerprint`).

### Comandos

```bash
npm run remains -- --new <corte ISO>   # inicia um novo export ativo
npm run remains                        # continua o export ativo (quantas vezes a cota exigir)
```

- `--new <corte ISO>`: data em UTC (ISO 8601) a partir da qual listar conversas por `updated_at`. Cobre conversas novas e antigas reabertas. O corte fica gravado no `checkpoint.json` do export ativo, e as execuções seguintes usam esse valor. Se já existir um export ativo, ele é movido para `export/completed-exports/archived-export-chats/` antes de começar. Se essa pasta de arquivo já existir, o comando aborta sem alterar nada: mova ou apague o arquivo anterior primeiro.
- Sem argumentos: continua o export ativo. Pula as conversas já processadas, continua o append nos mesmos arquivos e lista até o momento da execução, então conversas atualizadas entre as execuções também entram. Se não houver export ativo, o comando avisa e pede `--new`.
- Um corte passado sem `--new` dá erro, porque o export ativo sempre usa o corte do checkpoint. `--resume`, `--out`, `--known-dir` e `--date-start` são controlados pelo wrapper e também são recusados. Outras opções (ex.: `--max-conversations`, `--daily-limit`, `--include-events`) são repassadas ao CLI.

Por baixo, o wrapper ([src/cli/export-remaining.js](src/cli/export-remaining.js)) roda:

```bash
node src/cli/export-conversations.js \
  --out ./export/active-export-chats \
  --known-dir ./export/completed-exports/full-export \
  [--date-start <corte ISO>   # só com --new]
  [--resume                   # sem --new]
```

**Como escolher o corte:** use o **início** da exportação completa, não o fim. Ela durou vários dias (por causa da cota), e uma conversa exportada no começo e atualizada no meio só é capturada com um corte anterior a essa atualização. Na dúvida, recue um pouco (ex.: meia-noite do dia de início). Sobreposição não gera duplicata: conversas já conhecidas só buscam o delta e, sem mensagens novas, não gravam patch. O custo é só mais chamadas à API.

O fim da exportação completa está em `exported_at` do `export/completed-exports/full-export/manifest.json`. O início pode ser estimado pela data de **criação** do `export/completed-exports/full-export/checkpoint.json` (a de modificação não serve, porque ele é regravado a cada conversa):

```bash
stat -f %SB export/completed-exports/full-export/checkpoint.json   # macOS
stat -c %w export/completed-exports/full-export/checkpoint.json    # Linux (mostra "-" se o filesystem não registra criação)
```

### Passo a passo (exemplo)

1. **Primeiro dia**: inicia o export ativo.

   ```bash
   npm run remains -- --new 2026-09-22T00:00:00.000Z
   ```

2. **Se a cota acabar** (o script grava o checkpoint, avisa e sai com código 2), nos dias seguintes:

   ```bash
   npm run remains
   ```

   Repita até o `manifest.json` do export ativo indicar `status: "complete"`. Rodar de novo depois disso traz o que mudou desde a última execução.

3. **Rodada final perto do cutover**: em geral basta `npm run remains`. Só use `--new` se quiser recomeçar do zero (o ativo atual é arquivado).

Limitação conhecida (a mesma da exportação completa): uma conversa já processada no export ativo não é revisitada. As mensagens que ela receber depois disso só entram num novo export (`--new`).

## Dicionário dos arquivos gerados

Valem para a exportação completa (`export/completed-exports/full-export/`, `export/last-30d/`) e para o export remanescente (`export/active-export-chats/`), com as diferenças indicadas.

### `conversations.jsonl`

Uma conversa por linha (JSON). É o dado principal da exportação.

- **Exportação completa:** todas as conversas da janela, em ordem crescente de `created_at`.
- **Remanescente:** só as conversas **novas** (que não existem na exportação completa). Também inclui, completas, as conversas conhecidas que não tinham nenhuma mensagem na exportação completa (sem base para delta). Nesse caso, a linha nova **substitui** a da exportação completa com o mesmo `session_id`.

| Campo | Conteúdo |
| --- | --- |
| `session_id` | ID da conversa no Crisp (chave para cruzar arquivos) |
| `website_id` | workspace do Crisp |
| `people_id`, `inbox_id` | contato e inbox no Crisp (`null` se ausentes) |
| `state` | estado da conversa (`pending`, `unresolved`, `resolved`) |
| `created_at`, `updated_at` | timestamps em milissegundos (epoch) |
| `assigned` | `{ user_id }` do agente atribuído ou `null` |
| `contact` | dados do visitante: `nickname`, `email`, `phone`, `address`, `subject`, `origin`, `avatar`, `segments`, `data`, `ip`, `device` |
| `messages[]` | histórico: `fingerprint` (ID da mensagem, usado para deduplicar), `timestamp`, `type`, `from` (`user` ou `operator`), `origin`, `content`, `automated`, `user` (agente: `type`, `user_id`, `nickname`) |
| `events[]` | só com `--include-events`: `text`, `data`, `color`, `timestamp` |

### `conversations-updated.jsonl`

Só no remanescente. Um **patch** por linha, para cada conversa que já estava na exportação completa e recebeu mensagens novas:

```json
{ "session_id": "...", "since_timestamp": 1758500000000, "conversation": { "...": "mesmos campos de conversations.jsonl, sem messages" }, "messages": [ "só as mensagens novas" ] }
```

- `since_timestamp`: timestamp da última mensagem que a conversa tinha na exportação completa. O delta são as mensagens posteriores a ele.
- `conversation`: estado atual da conversa (`state`, `assigned`, `contact`, `updated_at`…). Prevalece sobre o da exportação completa.
- Para consolidar: localizar a conversa pelo `session_id` e acrescentar `messages`, ignorando os `fingerprint` que já existirem.
- Conversas conhecidas sem mensagens novas não geram linha.

### `checkpoint.json`

Estado interno usado para continuar de onde parou quando a cota acaba. É regravado a cada conversa. **Não edite à mão.**

| Campo | Conteúdo |
| --- | --- |
| `exported_session_ids` | conversas já gravadas em `conversations.jsonl` |
| `updated_session_ids` | conversas conhecidas já verificadas para delta (com ou sem patch) |
| `conversation_count`, `message_count` | totais gravados em `conversations.jsonl` |
| `updated_conversation_count`, `updated_message_count` | patches e mensagens gravados em `conversations-updated.jsonl` |
| `date_start`, `date_end`, `days` | janela congelada na primeira execução (no remanescente, `date_start` é o corte) |
| `errors`, `quota_errors` | erros por conversa e quantas vezes a cota ou o rate limit foi atingido |
| `last_completed_page`, `in_progress_page`, `order` | controle de paginação e ordenação |
| `website_id`, `updated_at` | workspace e última gravação |

### `manifest.json`

Resumo da última execução, para conferência humana. Gravado ao final e quando a cota acaba.

| Campo | Conteúdo |
| --- | --- |
| `status` | `complete` (terminou a janela), `quota_exhausted` (cota acabou: rode de novo depois), `partial_limit` (parou no `--max-conversations`) ou `failed` |
| `exported_at` | quando o manifest foi gravado |
| `conversation_count`, `message_count` | totais acumulados em `conversations.jsonl` |
| `updated_conversation_count`, `updated_message_count` | totais acumulados em `conversations-updated.jsonl` (remanescente) |
| `window_conversations` | quantas conversas a listagem retornou na última execução |
| `error_count`, `errors` | total de erros e os últimos 50 (`session_id`, `code`, `message`, `at`) |
| `quota_errors`, `elapsed_ms` | ocorrências de cota/rate limit e duração da execução |
| `date_start`, `date_end`, `days`, `order`, `include_events`, `include_empty` | parâmetros efetivos da janela |

### `forecast.json`

Gerado só por `npm run forecast` / `forecast:30d` (não pelo remanescente). É a previsão de volume e de dias de cota, feita antes de exportar.

| Campo | Conteúdo |
| --- | --- |
| `conversations`, `pages` | total estimado de conversas e de páginas da listagem |
| `already_exported`, `remaining_conversations` | quanto já existe no checkpoint da pasta e quanto falta |
| `sample` | amostra usada para estimar mensagens por conversa |
| `requests` | requests estimadas por tipo (`list`, `meta`, `messages`, `events`) e `export_total` |
| `quota` | `daily_limit`, `days` estimados, `approx_conversations_per_day` |
| `filters`, `generated_at` | filtros aplicados e quando foi gerado |

## Referência

https://docs.crisp.chat/references/rest-api/v1/

---
name: export-crisp-conversations
description: Exports Crisp workspace conversations and messages via the REST API to JSONL (full dump and post-cutoff remaining export), and forecasts export duration from conversation count vs daily API quota. Use when the user asks to exportar conversas do Crisp, estimar tempo, previsão de extração, dump chat history, migrate from Crisp, or run the conversation export CLI.
---

# Exportar conversas do Crisp

A API do Crisp **não tem dump em lote**. Não reimplemente as chamadas HTTP: rode o CLI deste repositório.

`POST /conversation/{session_id}/transcript` envia um e-mail; não devolve o histórico. Não use em massa.

## Pré-requisitos

Credenciais só em `.env` (nunca logar identifier, key ou Authorization):

```
CRISP_WEBSITE_ID
CRISP_IDENTIFIER
CRISP_KEY
CRISP_TIER=website
```

Se `.env` não existir, copiar de `.env.example` e pedir os valores ao usuário. Website token: ~10k req/dia. Plugin token: ~5k/dia.

## Fluxo

1. Conferir se `.env` tem as quatro variáveis (sem imprimir os valores).
2. `npm install` na raiz do repo se `node_modules` não existir.
3. Janela de 30 dias (pasta `export/last-30d/`, ordem antiga → nova):

```bash
npm run forecast:30d
npm run export:30d
npm run export:30d:resume
```

O checkpoint congela a janela. Não misturar com `export/` do dump completo.

4. Dump completo (também antiga → nova; pasta `export/`):

```bash
npm run forecast
npm run export
npm run export:resume
```

Opções extras: `--days N`, `--include-empty`, `--include-events`, `--date-start ISO`, `--date-end ISO`, `--max-conversations N`, `--sample N`, `--daily-limit N`.

5. Export remanescente (pós-corte), depois do dump completo. Há um único export ativo em `export/app-crisp-export-chats/`:

```bash
npm run remains -- --new <corte ISO>   # inicia (arquiva o ativo anterior em export/app-crisp-exported-chats/)
npm run remains                        # continua o ativo; o corte vem do checkpoint
```

Nunca usar `--new` só para continuar: ele arquiva o export ativo. Se `export/app-crisp-exported-chats/` já existir, o `--new` aborta; não apagar essa pasta sem confirmação do usuário.

6. Ao terminar, resumir `manifest.json` (contagens, `status`, erros). Não colar conversas inteiras no chat.

Em exit code 2 ou `status: quota_exhausted`, informar que a cota diária acabou e que `--resume` continua depois.

## Endpoints usados pelo CLI

- `GET /v1/website/{website_id}/conversations/{page_number}` (`per_page=50`)
- `GET /v1/website/{website_id}/conversation/{session_id}/meta`
- `GET /v1/website/{website_id}/conversation/{session_id}/messages` (histórico: `timestamp_before`; delta do remanescente: `timestamp_after`)
- `GET /v1/website/{website_id}/conversation/{session_id}/events/{page_number}` (só com `--include-events`)

A API não expõe um total de conversas. O forecast acha a última página por busca exponencial + binária e amostra mensagens para estimar requests.

Detalhes de campos: [reference.md](reference.md). Dicionário dos arquivos gerados (`conversations.jsonl`, `conversations-updated.jsonl`, `checkpoint.json`, `manifest.json`, `forecast.json`): seção correspondente do `README.md` na raiz. Docs: https://docs.crisp.chat/references/rest-api/v1/

# Referência da extração Crisp

## Auth

- Base: `https://api.crisp.chat/v1/`
- HTTP Basic `identifier:key`
- Header `X-Crisp-Tier: website` ou `plugin`
- Erros de cota: HTTP `429` ou `420`

A lib `crisp-api` monta o Basic Auth. Não guardar o header Base64.

## Listagem

`GET /v1/website/{website_id}/conversations/{page_number}`

Páginas começam em 1 e a API devolve a mais recente primeiro. O CLI lista todas as páginas e reordena por `created_at` crescente (dump completo e `--days`). Filtros úteis: `include_empty`, `filter_date_start`, `filter_date_end` (ISO 8601, relativos à data de **update**). `--days N` preenche essa janela.

Cada item já traz `session_id`, `state`, `assigned`, timestamps e `meta` parcial.

Não há endpoint de total. A previsão acha a última página (`O(log páginas)`) e estima requests: 1 listagem por página + 1 meta + N lotes de mensagens por conversa. Cota padrão: 10.000/dia (`website`) ou 5.000/dia (`plugin`).

## Mensagens

`GET /v1/website/{website_id}/conversation/{session_id}/messages`

Sem query: último lote. Para o restante, `timestamp_before` = timestamp mais antigo do lote atual até o array vir vazio.

Delta (export remanescente): `timestamp_after` = última mensagem já exportada, avançando para o timestamp mais novo de cada lote até vir vazio ([src/crisp/messages.js](../../../src/crisp/messages.js)).

Campos relevantes: `fingerprint`, `timestamp`, `type`, `from` (`user`|`operator`), `origin`, `content`, `user` (agente).

## Meta e eventos

- Meta: nickname, email, phone, origin, `data` custom, device.
- Eventos: texto, `data`, cor, timestamp; paginados por `page_number`.

## Saída JSONL

Uma linha por conversa, na ordem **mais antiga → mais nova** (`created_at`): `session_id`, `website_id`, `people_id`, `inbox_id`, `state`, `created_at`, `updated_at`, `assigned`, `contact`, `messages`, e `events` se pedido.

Campos de cada arquivo gerado (`conversations.jsonl`, `conversations-updated.jsonl`, `checkpoint.json`, `manifest.json`, `forecast.json`): seção "Dicionário dos arquivos gerados" do `README.md`.

Arquivos de mídia não são baixados; mensagens `file` conservam a URL em `content`.

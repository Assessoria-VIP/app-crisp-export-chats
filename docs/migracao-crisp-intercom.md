# Migração do histórico de atendimento: Crisp → Intercom

Documento de tarefa: motivação, processo de extração, solução implementada, limitações e justificativa de prazo.

**Data da estimativa:** 8 de setembro de 2026  
**Escopo deste documento:** extração do histórico no Crisp e geração do arquivo para ingestão na Intercom. A carga na Intercom é etapa seguinte, a cargo da plataforma de destino.

---

## 1. Motivação

O Crisp é hoje o canal de atendimento (WhatsApp e chat). Na avaliação e adoção da Intercom como nova plataforma, o histórico de conversas precisa ser preservado: contexto de tickets anteriores, continuidade do relacionamento com o contato e rastreabilidade operacional.

O entregável combinado com a Intercom é um **arquivo estruturado (JSON)** com as conversas e mensagens. Com esse arquivo, a Intercom consegue inserir os registros na base deles e o histórico feito no Crisp não se perde na troca de ferramenta.

Não há outro caminho nativo no Crisp que gere esse arquivo em lote.

---

## 2. Por que não é um export “de um clique”

A API REST do Crisp **não oferece exportação em massa** de todas as conversas em um único download.

O recurso mais próximo, o *transcript*, funciona **por conversa** e **envia o histórico por e-mail**. Não devolve um arquivo para migração e não escala para dezenas de milhares de sessões.

A recuperação precisa combinar vários endpoints, de forma paginada, conversa a conversa.

---

## 3. Solução criada

Foi desenvolvido um **CLI em Node.js** (`crisp-api`) que autentica no workspace, percorre a API, normaliza os dados e gera o arquivo final.

### O que o script faz

1. **Lista conversas** em páginas de até 50 (`GET /v1/website/{website_id}/conversations/{page}`). A API entrega a página mais recente primeiro; o CLI **reordena por `created_at` crescente** e grava da mais antiga para a mais nova, para o JSONL não se deslocar com atendimentos novos no dia a dia.
2. Para cada `session_id`, **busca metadados** do contato (nome, e-mail, telefone, origem, atributos).
3. **Busca o histórico de mensagens**, paginando para trás no tempo (`timestamp_before`) até esgotar a sessão.
4. **Normaliza** o conteúdo num schema estável (identificador da conversa, contato, agente, timestamps, mensagens enviadas e recebidas).
5. **Grava** uma conversa por linha em `export/conversations.jsonl` (JSON Lines: cada linha é um JSON válido; o conjunto é o arquivo de exportação).

Também existem:

- **Previsão (`npm run forecast`)** — conta o volume real e estima requests/dias na cota da API.
- **Retomada (`npm run export:resume`)** — continua de onde parou via `checkpoint.json`, sem recomeçar do zero quando a cota do dia acaba.

O arquivo gerado é o insumo para a Intercom fazer o insert na base deles, garantindo a migração e a preservação do histórico de atendimento.

### Conteúdo de cada conversa no JSON

- `session_id`, `website_id`, `people_id`, `inbox_id`, `state`
- `created_at` / `updated_at`
- `assigned` (agente responsável, quando houver)
- `contact` (nickname, e-mail, telefone, origem, atributos)
- `messages[]` (tipo, origem, conteúdo, timestamp, operador/visitante)

Arquivos de mídia não são baixados; mensagens do tipo arquivo conservam a URL devolvida pela API.

---

## 4. Volume e restrições da API

Levantamento feito no workspace em 8/9/2026:

| Indicador | Valor |
| --- | --- |
| Conversas | **21.354** |
| Páginas de listagem | 428 |
| Média de lotes de mensagens por conversa (amostra de 8) | 5,5 (mín. 2 / máx. 12) |
| Requests estimados para a extração completa | **~139.000** |
| Cota do token *website* | **10.000 requests/dia** |
| Ritmo estimado | ~1.500 conversas/dia |

Cada conversa exige vários requests (listagem compartilhada + meta + vários lotes de mensagens). Não é 1 request = 1 conversa.

A API responde **429 / 420** ao estourar cota ou rate limit. O script espera, retenta e, se a cota diária acabar, persiste o checkpoint para retomar no dia seguinte.

Na primeira execução real a cota do dia foi atingida após **1.227 conversas** (~274 mil mensagens), com erros `rate_limited`. Isso confirma na prática o teto diário e que a extração **não cabe em um único dia**.

---

## 5. Limitações conhecidas

- **Sem dump nativo** — não existe endpoint de exportação completa.
- **Paginação obrigatória** — listagem e mensagens vêm em lotes; conversas longas consomem mais cota.
- **Transcript por e-mail** — inutilizável como via de migração em massa.
- **Cota diária rígida** — ~10 mil requests/dia no token de workspace (plugin token costuma ser ainda menor, ~5 mil, salvo aumento no Marketplace).
- **Retries consomem cota** — cada 429 também conta; o ritmo real pode ficar abaixo da conta teórica.
- **Volume vivo** — novas conversas podem surgir durante os dias de extração; o arquivo reflete o que a API devolver até o fim da corrida (com resume).
- **Mídia** — URLs, não o binário dos arquivos.
- **Eventos extras** — não entram no export padrão; incluir eventos aumenta o número de requests e o prazo.
- **Fora deste prazo** — mapeamento/carga na Intercom, validação de insert e cutover operacional.

---

## 6. Justificativa de prazo

### Extração (esta tarefa)

```
~139.000 requests ÷ 10.000 requests/dia ≈ 14 dias corridos de API
```

O prazo **não é escolha de calendário**: é o teto da própria API. Com 21 mil conversas e ~6,5 requests médios por conversa (meta + mensagens), a conta fecha em **cerca de duas semanas** de extração contínua, retomando todo dia após o reset de cota.

Recomenda-se tratar **14 dias úteis de janela de API** como o mínimo, com **margem de 16–18 dias corridos**, por:

- variação no tamanho das conversas (a amostra foi de 2 a 12 lotes);
- 429 reais já observados, que reduzem o aproveitamento da cota;
- necessidade de validar o JSONL ao final (contagem vs. previsão, sessões com erro);
- possível inclusão pontual de conversas novas no fim da janela.

Na prática: **~3 semanas de calendário** para entregar o arquivo completo com segurança, sem pressionar a API além do permitido.

### Depois do arquivo

A Intercom ainda precisa **ingerir** o JSON na base. Esse prazo é da Intercom / do processo de importação e **não está incluído** nos 14–18 dias acima.

---

## 7. Processo operacional (resumo)

```text
Autenticar no Crisp (token de workspace)
        ↓
Previsão de volume e cota
        ↓
Exportação paginada (lista → meta → mensagens)
        ↓
Checkpoint diário quando a cota acaba
        ↓
Resume no dia seguinte
        ↓
Arquivo JSONL consolidado
        ↓
Entrega à Intercom para insert na base
```

Comandos:

- `npm run forecast` — atualizar estimativa
- `npm run forecast:30d` — estimativa só da janela de 30 dias
- `npm run export` — dump completo (não usar de novo no meio do processo: recomeça e apaga o JSONL)
- `npm run export:resume` — continuar o dump completo
- `npm run export:30d` — últimos 30 dias, pasta `export/last-30d/`, ordem antiga → nova
- `npm run export:30d:resume` — continuar a janela de 30 dias

---

## 8. Resultado esperado

Ao final da extração, um conjunto estruturado de conversas e mensagens do Crisp, em JSONL, apto para a Intercom carregar o histórico de atendimento na nova plataforma.

Referência da API: [https://docs.crisp.chat/references/rest-api/v1/](https://docs.crisp.chat/references/rest-api/v1/)

---

## 9. Fase incremental: conversas remanescentes

A exportação completa (seção 8) fica desatualizada assim que novas conversas chegam ou conversas antigas são reabertas no Crisp. Para cobrir o período entre o corte da exportação completa e o cutover real para a Intercom, o CLI suporta uma segunda fase, com `--known-dir` apontando para a pasta da exportação completa (`export/completed-exports/full-export/`) (ver seção "Exportação remanescente (pós-corte)" no [README.md](../README.md)).

Essa fase produz **dois arquivos**, em vez de um só, numa pasta separada e fixa, `export/active-export-chats/` (o export remanescente ativo, continuado a cada `npm run remains`; ao iniciar outro com `--new`, o anterior é arquivado em `export/completed-exports/archived-export-chats/`):

- `conversations.jsonl` — conversas inteiramente novas desde o corte. Mesmo schema da exportação completa; pode ser concatenado direto ao `conversations.jsonl` original.
- `conversations-updated.jsonl` — **patches**, um por conversa já existente que recebeu mensagens novas: `{ session_id, since_timestamp, conversation, messages: [só as mensagens novas] }`. Quem for inserir isso na Intercom precisa tratar esse arquivo à parte: localizar a conversa já importada pelo `session_id` e fazer o append de `messages`, deduplicando por `fingerprint` caso a conversa já tenha alguma dessas mensagens.

Dimensionamento feito em 05/11/2026 (corte de 21/09/2026): das 3.883 conversas com atividade desde o corte, 497 eram novas e 3.386 só precisavam do delta — volume pequeno o bastante para caber em menos de um dia da cota do tier `website` (10.000 requests/dia), diferente da extração completa original (seção 6). Por isso, a decisão foi **não** rodar essa fase logo em seguida: ela é executada mais perto do rollout real para a Intercom, minimizando a janela de conversas remanescentes até o cutover — a correção do resultado não depende de quando a fase incremental é rodada.

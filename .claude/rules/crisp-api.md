---
paths:
  - "src/crisp/**"
  - "src/core/forecast.js"
---

# API do Crisp

- Cota diária: 10.000 requests (tier `website`) ou 5.000 (`plugin`). HTTP 429/420 = cota ou rate limit. Envolva toda chamada em `withRetry` ([src/crisp/client.js](../../src/crisp/client.js)) e deixe o erro de cota subir para o CLI gravar o checkpoint e sair com código 2.
- Não há endpoint de total nem dump em lote. A listagem pagina (`per_page=50`, mais recente primeiro) e o CLI reordena por `created_at`.
- Mensagens: o histórico completo pagina para trás com `timestamp_before`; o delta pagina para frente com `timestamp_after`. Deduplique por `fingerprint`.
- Não use `POST /conversation/{session_id}/transcript`: envia e-mail e não devolve o histórico.
- Teste funções HTTP com um cliente stub (veja `test/crisp/messages.test.js`), nunca contra a API real.
- Referência: https://docs.crisp.chat/references/rest-api/v1/

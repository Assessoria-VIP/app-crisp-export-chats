# Dados exportados

`export/` (no `.gitignore`) contém conversas reais de clientes: nomes, e-mails, telefones, IPs e conteúdo de mensagens.

- Não cole conversas, contatos ou trechos de mensagens em respostas, commits, issues ou PRs. Para conferir um export, resuma o `manifest.json` (contagens, `status`, erros).
- Ao inspecionar `.jsonl`, imprima só os campos estruturais necessários (`session_id`, `state`, timestamps, contagens), nunca `contact` ou `content`.
- Testes e exemplos usam dados sintéticos (`session_a`, timestamps fictícios), como em `test/`.
- Pastas em `export/`:
  - `export/completed-exports/full-export/`: dump completo. Só leitura. O `conversations.jsonl` dele é a referência obrigatória do remanescente (`--known-dir`).
  - `export/active-export-chats/`: export remanescente ativo.
  - `export/completed-exports/archived-export-chats/`: export remanescente anterior, arquivado pelo `--new`.

  Não mova nem apague nenhuma dessas pastas sem confirmação explícita.
- `checkpoint.json` é estado interno do `--resume`; não edite à mão.

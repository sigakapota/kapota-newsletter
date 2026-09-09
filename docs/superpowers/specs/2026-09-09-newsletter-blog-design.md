# Newsletter do blog kapota.com.br — design

Data: 2026-09-09
Status: aprovado por seção em chat, aguardando revisão final do Klysman antes do plano de implementação.

## Objetivo

Deixar quem quiser se cadastrar num formulário e receber por email um
aviso sempre que sair um post novo em `kapota.com.br/blog/`. O RSS em si
não precisa existir como arquivo público — é só mecanismo interno.

Fora de escopo (explicitamente decidido): materiais completos hospedados
em `conteudos.kapota.com.br` (ex: Direito Autoral x Direito Conexo) não
disparam esse aviso — só posts do blog de notícias.

## Arquitetura

- **Site** (`sigakapota/kapota-site`, GitHub Pages): estático, sem mudança
  na hospedagem. Ganha um formulário de cadastro em `blog/index.html`
  (rodapé) e no template de cada post individual.
- **Worker** (`sigakapota/kapota-newsletter`, Cloudflare Workers, novo
  repositório): função serverless grátis, exposta em
  `https://<nome>.<conta>.workers.dev` — sem precisar de domínio próprio
  nem mudança de DNS. Chamado via `fetch()` pelo formulário (CORS restrito
  a `https://kapota.com.br`).
- **Banco D1** (Cloudflare, grátis, ligado ao Worker): tabelas
  `subscribers` e `sent_campaigns`.
- **Resend**: envio dos emails. Precisa de domínio verificado
  (`kapota.com.br`) via registros DNS (SPF/DKIM) adicionados no
  registro.br — não afeta o MX existente do Google Workspace.
- **GitHub Action** (já existe em `kapota-site`, `.github/workflows/sitemap.yml`):
  ganha um passo novo que chama `/admin/send` do Worker pra cada post,
  depois de regenerar sitemap/listagens. O Worker decide o que é
  realmente novo.

## Modelo de dados (D1)

```sql
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE sent_campaigns (
  slug TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL
);
```

## Endpoints do Worker

- `POST /subscribe` — público. Body `{email}`. Valida formato, grava como
  `pending` (ou reabre se `unsubscribed`, ou avisa se já `confirmed`),
  manda email de confirmação via Resend com link
  `/confirm?token=...`.
- `GET /confirm?token=...` — público. Marca `confirmed`, mostra página de
  sucesso.
- `GET /unsubscribe?token=...` — público. Marca `unsubscribed`, mostra
  confirmação. Link presente em todo email enviado (obrigatório LGPD).
- `POST /admin/send` — protegido por header `Authorization: Bearer
  <ADMIN_SECRET>`. Body `{slug, title, url, excerpt, dateISO}`. Se `slug`
  já está em `sent_campaigns`, não faz nada (idempotente). Senão, busca
  todos os `subscribers` com `status = 'confirmed'`, envia um email por
  destinatário via Resend (com link de descadastro individual), grava em
  `sent_campaigns`.

## Fluxo ponta a ponta

1. Visitante cadastra o email no formulário (blog ou post) → `POST
   /subscribe` → Worker grava `pending` → Resend manda confirmação.
2. Visitante clica no link de confirmação → `GET /confirm` → status vira
   `confirmed`.
3. Post novo é publicado em `kapota-site` (push em `blog/**`) → Action
   roda `generate-site.mjs` (já existe) → novo passo chama `/admin/send`
   pra cada post do repositório → Worker ignora os que já estão em
   `sent_campaigns`, dispara aviso pro post genuinamente novo.
4. Destinatário pode se descadastrar a qualquer momento pelo link no
   rodapé do email → `GET /unsubscribe` → status vira `unsubscribed`,
   passa a ser ignorado nos próximos envios.

## Erros e resiliência

- Cadastro duplicado: `pending` → reenvia confirmação; `confirmed` →
  avisa "já inscrito"; `unsubscribed` → reabre como `pending`.
- Falha ao enviar um destinatário específico via Resend: loga o erro,
  não interrompe os demais destinatários daquele envio.
- Idempotência do aviso de post novo garantida pela tabela
  `sent_campaigns` — a Action pode rodar de novo sem duplicar emails.

## Contas e segredos necessários

- Cloudflare (Workers + D1) — token já fornecido pelo Klysman, escopo
  `Account:Workers Scripts:Edit` + `Account:D1:Edit`.
- Resend — API key já fornecida pelo Klysman.
- `ADMIN_SECRET` — gerado por mim, guardado como secret do Worker e como
  secret da GitHub Action em `kapota-site` (nunca em texto plano em
  arquivo versionado).
- Ambas as chaves (Cloudflare, Resend) ficam só como secrets do Worker
  (`wrangler secret put`), nunca commitadas.

## Teste antes de considerar pronto

Cadastro com email real → confirmar → forçar `/admin/send` pra um post
existente → confirmar que o email chega, com link de descadastro
funcional → descadastrar → confirmar que reprocessar não manda de novo
pra esse email.

## Fora de escopo (YAGNI, pode virar pedido futuro)

- Feed RSS público de verdade (arquivo `.xml` assinável por leitores).
- Aviso de material completo em `conteudos.kapota.com.br`.
- Painel administrativo visual pra ver/gerenciar assinantes (por ora,
  consulta direta via D1/wrangler quando precisar).

# Resumo das alterações — Integração Shopify ↔ Bling

**Data:** 19/06/2026

Este documento explica, em linguagem acessível, os problemas que existiam na integração
entre a loja Shopify e o ERP Bling e o que foi feito para resolvê-los. O objetivo é que
qualquer pessoa da equipe (técnica ou não) entenda o que mudou e por quê.

---

## Contexto: como a integração funciona

O aplicativo conecta a loja Shopify ao Bling em duas direções:

- **Shopify → Bling:** quando um pedido é criado ou atualizado na loja, o app recebe um aviso
  (chamado *webhook*) e atualiza o pedido correspondente no Bling — escrevendo a referência do
  pedido da loja e, quando é o caso, cancelando pedidos com PIX vencido.
- **Bling → Shopify:** quando um pedido avança no Bling (é verificado/atendido), o Bling avisa o
  app, que então leva de volta à loja o **código de rastreio** e o **link da nota fiscal**, além
  de marcar o pedido como enviado.

Esses "avisos automáticos" (webhooks) são o coração da integração.

---

## Problema 1 — O webhook do Bling vivia sendo desativado

### O que acontecia
O Bling tem uma regra de proteção: se ele envia muitos avisos e recebe respostas de erro (ou
respostas muito demoradas), ele **desativa o webhook automaticamente**. A equipe precisava ficar
reativando manualmente toda hora.

### Por que acontecia
Quando o Bling avisava o app, o app tentava fazer **todo o trabalho pesado na mesma hora** —
várias consultas ao Bling e à Shopify, criação de envio, etc. Isso demorava. Para o Bling, uma
resposta lenta conta como falha. Acumulando falhas, ele desligava o webhook.

### Como tratamos
Mudamos a lógica para o modelo de **"receber rápido, processar depois"**:

1. Quando um aviso chega, o app **apenas registra o pedido numa fila** e responde **imediatamente
   com sucesso** ao Bling (em milissegundos). Assim o Bling nunca mais vê lentidão ou erro.
2. Um **processador em segundo plano** vai pegando os itens dessa fila e fazendo o trabalho
   pesado no seu próprio ritmo, sem pressa e sem afetar a resposta ao Bling.
3. Se algo falhar no processamento (por exemplo, o pedido ainda não chegou no Bling), o item
   **volta para a fila e é tentado de novo automaticamente**, com intervalos crescentes, até dar
   certo. Nada se perde.

**Resultado:** o Bling sempre recebe uma resposta de sucesso e não tem mais motivo para desativar
o webhook. O trabalho continua sendo feito, só que de forma organizada e resiliente.

---

## Problema 2 — Voltou a aparecer o "note_attributes" no pedido do Bling

### O que acontecia
No campo **Observações** do pedido no Bling, voltou a aparecer um texto técnico indesejado
(o "note_attributes"), que vinha da integração nativa do Bling com a Shopify.

### Por que acontecia
A "limpeza" desse campo era feita justamente pelo passo em que o app **reescreve as Observações**
com a referência correta do pedido. Acontece que esse passo fazia parte do mesmo fluxo do
Problema 1 — e quando o fluxo falhava ou desistia (por exemplo, porque o pedido ainda não tinha
sido importado no Bling no momento do aviso), a limpeza **simplesmente não rodava**, e o texto
indesejado permanecia.

### Como tratamos
Com a nova fila e as tentativas automáticas, esse passo de reescrever as Observações **deixou de
desistir**. Se o pedido ainda não está no Bling, o item aguarda e tenta novamente até o pedido
existir — e então a limpeza é aplicada. Ou seja: o conserto do "note_attributes" passou a ser
**garantido**, porque agora sempre acaba rodando.

---

## Problema 3 (descoberto durante a validação) — A Bling trocou o endereço da API

### O que acontecia
Logo após colocar tudo no ar, **todos os pedidos começaram a falhar** no processamento.

### Por que acontecia
A Bling passou a **bloquear o endereço antigo** que o app usava para conversar com a API
(`www.bling.com.br`), exigindo o endereço oficial novo (`api.bling.com.br`). Era uma mudança
externa, do lado da Bling — nada a ver com o nosso código, mas que travava todas as chamadas.

### Como tratamos
Atualizamos o app para usar o **novo endereço oficial da API da Bling** em todas as chamadas de
dados e na renovação de acesso (apenas a tela de autorização, que o lojista abre no navegador,
permaneceu no endereço antigo, pois não é afetada pelo bloqueio).

**Detalhe importante:** graças à fila do Problema 1, **nenhum pedido foi perdido** durante esse
episódio. Todos os avisos ficaram guardados aguardando, e assim que o endereço foi corrigido,
o sistema **reprocessou tudo sozinho**.

---

## Pontos extras de robustez que ficaram embutidos

- **Sem duplicidade:** se o mesmo aviso chega mais de uma vez (Bling e Shopify costumam reenviar),
  o sistema reconhece e não processa duas vezes.
- **À prova de reinício:** se o servidor reiniciar no meio de um processamento, o item não fica
  preso — ele volta para a fila e é retomado.
- **Tentativas com limite:** itens são tentados várias vezes com intervalos crescentes; se mesmo
  assim não derem certo, ficam marcados para inspeção, sem travar o restante da fila.
- **Histórico consultável:** dá para acompanhar a saúde do sistema vendo quantos itens estão
  "concluídos", "aguardando" ou "com falha".

---

## Como validamos que está funcionando

1. **Resposta rápida ao Bling:** confirmado que o app responde com sucesso imediatamente ao
   receber os avisos.
2. **Fila escoando:** acompanhamos a fila esvaziar — itens saindo de "aguardando" para
   "concluído", sem novas falhas.
3. **Registros novos no app:** a tela de logs do app, que estava parada em **09/06**, voltou a
   registrar pedidos com data de **hoje (19/06)**.
4. **Recuperação automática:** os pedidos que tinham falhado durante o bloqueio da Bling foram
   reprocessados automaticamente após a correção do endereço, sem intervenção manual.

---

## O que a equipe precisa saber no dia a dia

- **Webhook do Bling:** não deve mais ser desativado. Se algum dia for, basta reativar uma vez —
  mas a expectativa é que isso não volte a acontecer.
- **Acompanhamento:** a tela de logs do app deve continuar ganhando entradas novas conforme os
  pedidos são atualizados. No Bling, o campo Observações dos pedidos deve aparecer limpo, só com
  a referência do pedido da loja.
- **Se algo parecer parado:** o primeiro sinal de problema externo (como foi o caso do endereço
  da Bling) é a fila acumular itens "com falha". Nesse caso, vale verificar a mensagem de erro
  registrada antes de qualquer ação.

---

## Segurança — Proteção dos dados no banco de dados

### O que foi feito
O banco de dados do app ficou por um tempo com as tabelas **abertas para acesso externo** —
qualquer pessoa que soubesse a chave pública do projeto poderia, em tese, consultar ou alterar
os dados diretamente, sem passar pelo app.

### Por que isso era um risco
As tabelas armazenam informações sensíveis: **tokens de acesso da Shopify e do Bling** (que são
as "chaves" que permitem ao app agir em nome da loja), além de logs de pedidos e fila de
processamento. Com o acesso aberto, esses dados ficavam expostos.

### Como tratamos
Ativamos o **controle de acesso por linha** (RLS — Row Level Security) em todas as tabelas.
Com isso, o acesso externo direto às tabelas passa a ser bloqueado por padrão. O app em si
continua funcionando normalmente, pois ele se conecta ao banco por um canal privilegiado que
não é afetado por essa restrição.

**Resultado:** os dados da integração estão protegidos e a superfície de exposição foi eliminada.

---

## Problema 4 — A Bling mudou o formato do sistema de acesso (autenticação JWT)

**Data:** 25/06/2026

### O que acontecia
A Bling anunciou que o sistema antigo de "senha de acesso" (chamado tecnicamente de *token opaco*)
está sendo descontinuado. A partir de um prazo ainda a ser definido, o sistema antigo será
**bloqueado**, e qualquer app que ainda o use deixará de conseguir conversar com o Bling.

### Por que acontecia
É uma evolução interna da Bling: eles trocaram o formato da "chave de acesso" que o app usa para
se identificar nas chamadas à API. O formato novo (chamado *JWT*) carrega mais informações dentro
da própria chave, o que é mais seguro e eficiente para o sistema deles. Nossa integração não
acompanhou essa mudança automaticamente — precisava ser ajustada.

### Como tratamos
Atualizamos o app para solicitar explicitamente o novo formato de chave ao Bling, tanto na
primeira vez que o acesso é autorizado quanto nas renovações automáticas. Também garantimos que
todas as chamadas feitas ao Bling já sinalizem que estão usando o novo formato.

Após a atualização, foi necessário **re-autorizar o acesso** uma única vez — entrando na conta
Bling da woodbull e confirmando a permissão novamente. A partir daí, o sistema passou a emitir e
renovar chaves no novo formato automaticamente, sem necessidade de intervenção.

**Resultado:** a integração está atualizada para o novo sistema de acesso da Bling e não corre
risco de ser bloqueada quando o formato antigo for desativado definitivamente.

### Como validamos
- A nova chave de acesso ficou com tamanho muito maior que a antiga (de ~40 para ~950 caracteres),
  confirmando que é o novo formato JWT.
- O registro de operações no banco (logs) continuou crescendo normalmente após a troca, com
  pedidos sendo atualizados no Bling sem erros de autenticação.

---

## Em resumo

| Problema | Causa | Solução |
|----------|-------|---------|
| Webhook do Bling era desativado | Processamento lento/com erros na resposta | Receber rápido e processar depois, via fila com tentativas automáticas |
| "note_attributes" reaparecia | A limpeza desistia quando o fluxo falhava | Fila garante que a limpeza sempre acaba rodando |
| Tudo falhou após publicar | Bling bloqueou o endereço antigo da API | Atualizado para o endereço oficial novo (api.bling.com.br) |
| Dados do banco expostos externamente | Tabelas sem controle de acesso ativado | Ativado RLS em todas as tabelas — acesso externo bloqueado |
| Sistema de acesso (token) descontinuado pelo Bling | Bling migrou para novo formato JWT | App atualizado para novo formato + re-autorização realizada |

A integração ficou mais **confiável** (não perde pedidos), mais **resistente a falhas
temporárias** (tenta de novo sozinha) e mais **transparente** (dá para acompanhar o estado de
cada aviso recebido).

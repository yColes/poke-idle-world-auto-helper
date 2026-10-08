# 🔴 Poke Idle World — Auto Helper

> Extensão para navegadores Chromium criada para automatizar tarefas repetitivas de captura no **Poke Idle World**, com foco em desempenho, controle rápido e acompanhamento de capturas.

![Versão](https://img.shields.io/badge/versão-1.4.0-2ea44f)
![Manifest](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)
![Navegadores](https://img.shields.io/badge/Opera%20GX%20%7C%20Chrome%20%7C%20Edge-compatível-8A2BE2)

## ✨ O que a extensão faz

O Auto Helper observa apenas as partes relevantes da interface do jogo e automatiza o fluxo de captura sem precisar manter a aba em primeiro plano.

Principais recursos:

- 🎯 **Auto Captura** quando o botão **Lançar** da janela de captura está disponível.
- ⏱️ Respeito ao **cooldown do jogo** para evitar cliques duplicados.
- 📚 **Histórico de capturas**, com total e contagem por espécie.
- ✨ Reconhecimento de capturas **Shiny** quando a mensagem do jogo permite identificar.
- 📦 **Gerenciador de Pokébolas** com leitura de estoque.
- 🔁 Troca automática de Pokébola quando a atual acaba, quando a interface permite identificar outra opção com segurança.
- ⚠️ Aviso de **estoque baixo** e alerta quando não restarem Pokébolas.
- 🧭 **HUD arrastável** dentro do jogo, com posição salva.
- ⚡ Liga/desliga instantâneo no jogo, no popup ou pelo atalho `Alt + Shift + P`.
- 🔌 Reconexão e recuperação automática em situações reconhecíveis de queda.
- 💾 Configurações e estatísticas armazenadas localmente no navegador.
- 📊 Exportação do histórico de capturas em **CSV**.

## 🚀 Instalação

### Opera GX / Chrome / Edge

1. Baixe o ZIP da versão mais recente em **Releases** ou use `dist/poke-idle-world-auto-helper-v1.4.0.zip`.
2. Extraia o ZIP em uma pasta permanente.
3. Abra a página de extensões do navegador:
   - Opera GX: `opera://extensions`
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Ative o **Modo do desenvolvedor**.
5. Clique em **Carregar sem compactação**.
6. Selecione a pasta extraída que contém `manifest.json`.
7. Abra ou recarregue `https://poke.idleworld.online/`.

## 🎮 Como funciona

O fluxo principal é simples:

```text
Janela CAPTURA disponível
          ↓
A extensão localiza o botão "Lançar"
          ↓
Confere se está visível e habilitado
          ↓
Realiza a ação de captura
          ↓
Aguarda o cooldown mínimo
          ↓
Repete somente quando houver nova oportunidade
```

A extensão foi otimizada para **não ficar varrendo o DOM inteiro continuamente**. Depois que encontra a área de captura, trabalha principalmente com referências diretas aos elementos necessários.

## 🟢 Controle rápido

Há três formas de pausar ou ativar o helper:

- botão **AUTO ON / AUTO OFF** dentro do jogo;
- botão no popup da extensão;
- atalho **`Alt + Shift + P`**.

Quando pausado, o helper deixa de executar as automações sem precisar desinstalar ou desabilitar a extensão.

## 📦 Gerenciamento de Pokébolas

Quando a interface disponibiliza os dados necessários, o helper identifica a Pokébola selecionada e acompanha o estoque.

O limite de aviso pode ser configurado pelo popup. Quando o estoque chega ao limite definido, a extensão exibe um alerta; ao zerar, tenta selecionar outra Pokébola disponível. A lógica prioriza preservar opções mais raras sempre que houver alternativas identificáveis.

> A leitura depende da estrutura atual da interface do jogo. Mudanças no site podem exigir uma atualização dos seletores.

## 📚 Histórico de capturas

O histórico é mantido em `chrome.storage.local` e pode registrar:

- nome do Pokémon;
- horário da captura;
- quantidade total;
- quantidade por espécie;
- indicação de Shiny quando detectável.

O popup também permite exportar os dados em CSV para análise externa.

## ⚙️ Permissões

A extensão solicita apenas o necessário para funcionar:

| Permissão | Uso |
|---|---|
| `storage` | Salvar configurações, posição do HUD e histórico |
| `tabs` | Trabalhar com a aba do jogo e reduzir descarte da aba |
| `notifications` | Alertas de estoque e eventos importantes |
| `https://poke.idleworld.online/*` | Executar apenas no site alvo |

## 🔐 Privacidade

A extensão não precisa de conta externa, API key ou servidor próprio. Os dados do helper permanecem no armazenamento local do navegador. Não há telemetria adicionada por este projeto.

## 🧩 Estrutura

```text
├── manifest.json
├── background.js
├── content.js
├── capture-parser.js
├── capture-events.js
├── capture-storage.js
├── popup.html
├── popup.css
├── popup.js
├── icons/
├── docs/
└── dist/
```

## 🛠️ Desenvolvimento

Depois de alterar os arquivos, abra a página de extensões do navegador e clique em **Atualizar/Recarregar** na extensão. Em seguida, recarregue o jogo.

Para problemas relacionados à captura, informe no issue:

- versão da extensão;
- navegador;
- o que era esperado;
- o que ocorreu;
- screenshot da janela **CAPTURA**, se possível.

## ⚠️ Aviso

Projeto independente e não oficial. Não possui vínculo com Poke Idle World, Pokémon, Nintendo, Game Freak ou The Pokémon Company. Marcas e nomes pertencem aos seus respectivos proprietários.

Automação pode ser tratada de formas diferentes por cada jogo ou serviço. Use por sua conta e verifique as regras aplicáveis à sua conta.

## 💬 Contribuições

Issues com bugs e sugestões são bem-vindas. Pull requests também podem ser enviados para melhorias de desempenho, compatibilidade e interface.

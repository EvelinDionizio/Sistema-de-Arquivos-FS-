# Simulador de Sistema de Arquivos e Alocação Física em Disco

> **Disciplina**: Sistemas Operacionais  
> **Tema**: Gerenciamento de Arquivos, Hierarquia em Árvore, Alocação de Blocos e Fragmentação

---

## 📌 Visão Geral do Projeto

Este projeto implementa um **Simulador de Sistema de Arquivos (File System)** completo e interativo, projetado para demonstrar os conceitos fundamentais de gerenciamento de armazenamento secundário em Sistemas Operacionais.

O simulador suporta:
1. **Hierarquia em Árvore**: Diretórios e arquivos navegáveis com caminhos absolutos (ex: `/sistema/logs/app.log`) e relativos (ex: `logs/app.log`, `../arquivo.txt`).
2. **Operações CRUD**: Criar, Ler, Atualizar e Deletar arquivos e diretórios (`mkdir`, `create`, `read`, `update`, `rm`).
3. **Mapeamento e Alocação Física de Blocos**:
   - **Alocação Indexada (i-node)**: Cada arquivo possui um bloco de índice que aponta para seus blocos de dados.
   - **Alocação Contígua**: Arquivos ocupam blocos estritamente sequenciais no disco.
   - **Alocação Encadeada (Linked / FAT)**: Cada bloco armazena ponteiro para o próximo bloco.
4. **Diagnóstico do Disco e Fragmentação**:
   - Mapa gráfico e detalhado da ocupação dos blocos.
   - Cálculo preciso de **Fragmentação Interna** (espaço desperdiçado no último bloco de cada arquivo).
   - Cálculo de **Fragmentação Externa** (blocos livres dispersos incapazes de abrigar arquivos de forma contígua).
   - Indicação da **Necessidade de Compactação** e comando `compact` para desfragmentação.

O projeto foi implementado em **Node.js** (`simulator.js`) e em **Python 3** (`simulator.py`), ambos sem dependências externas (usam apenas bibliotecas padrão da linguagem).

---

## 🚀 Como Executar

Você pode executar o simulador com qualquer um dos ambientes abaixo:

### Opção 1: Com Node.js (Recomendado se tiver Node instalado)
```bash
# Executar no modo interativo (Shell interativo)
node simulator.js

# Ou executar diretamente a demonstração do enunciado
node simulator.js demo
```

### Opção 2: Com Python 3
```bash
# Executar no modo interativo (Shell interativo)
python simulator.py

# Ou executar diretamente a demonstração do enunciado
python simulator.py demo
```

---

## 💻 Guia de Comandos do Simulador

Ao iniciar o simulador, você terá um terminal interativo com prompt dinâmico indicando o diretório de trabalho atual: `simulador:/caminho/atual>`.

| Comando | Descrição | Exemplo |
|---|---|---|
| `mkdir <caminho>` | Cria um diretório (absoluto ou relativo) | `mkdir /sistema/logs` |
| `create <caminho> --size <tam>` | Cria um arquivo com o tamanho especificado | `create /sistema/logs/app.log --size 10KB` |
| `read <caminho>` ou `cat <caminho>` | Lê metadados, conteúdo e blocos do arquivo | `read /sistema/logs/app.log` |
| `update <caminho> --size <novo_tam>` | Altera o tamanho de um arquivo e realoca blocos | `update /sistema/logs/app.log --size 14KB` |
| `rm <caminho>` ou `delete <caminho>` | Remove arquivo ou pasta (libera os blocos) | `rm /sistema/logs/app.log` |
| `cd <caminho>` | Navega para outro diretório | `cd /sistema/logs` ou `cd ..` |
| `pwd` | Exibe o caminho absoluto do diretório atual | `pwd` |
| `ls [caminho]` | Lista os arquivos e subpastas | `ls` |
| `tree` | Exibe graficamente a hierarquia de diretórios | `tree` |
| `fs_status [--details]` | Exibe o mapa físico do disco e relatório de fragmentação | `fs_status --details` |
| `strategy <tipo>` | Alterna a estratégia física (`INDEXED`, `CONTIGUOUS`, `LINKED`) | `strategy contiguous` |
| `compact` ou `defrag` | Executa a compactação do disco | `compact` |
| `demo` | Executa o cenário padrão do enunciado automaticamente | `demo` |
| `help` | Exibe o menu de ajuda | `help` |
| `exit` | Encerra o simulador | `exit` |

---

## 📊 Exemplos de Saída

### 1. Criação e Exibição da Árvore Hierárquica (`tree`)
```text
> mkdir /sistema
> mkdir /sistema/logs
> create /sistema/logs/app.log --size 10KB
> tree

[ÁRVORE DO SISTEMA DE ARQUIVOS]
/
├── sistema/ [DIR]
│   └── logs/ [DIR]
│       └── app.log (10 KB) [ARQ]
```

### 2. Mapa do Disco e Diagnóstico (`fs_status --details`)
```text
> fs_status --details

Tamanho do Bloco de Disco: 4 KB | Total de Blocos: 16 (64 KB)

[MAPA DE ALOCAÇÃO DO DISCO (Indexado)]
Bloco 00 [INODE_RAIZ]  : Diretório '/'
Bloco 01 [INODE_APP]   : Arquivo '/sistema/logs/app.log'
Bloco 02 [DADO]        : '/sistema/logs/app.log' (Bloco 1 - 4096 bytes ocupados)
Bloco 03 [DADO]        : '/sistema/logs/app.log' (Bloco 2 - 4096 bytes ocupados)
Bloco 04 [DADO]        : '/sistema/logs/app.log' (Bloco 3 - 2048 bytes ocupados)
Bloco 05..15           : [LIVRE]

--- RELATÓRIO DE FRAGMENTAÇÃO ---
Tamanho Real do Arquivo 'app.log': 10240 bytes (10 KB)
Espaço Alocado no Disco          : 12288 bytes (3 blocos de 4 KB)
Fragmentação Interna             : 2048 bytes (50% de desperdício no Bloco 04)
Fragmentação Externa             : 0 bytes
Necessidade de Compactação       : NÃO (Blocos alocados via i-node indexado)
```

---

## 🧠 Conceitos Teóricos Abordados

### Fragmentação Interna
Ocorre quando o tamanho do arquivo não é múltiplo exato do tamanho do bloco físico. Como o disco aloca blocos inteiros, o último bloco fica parcialmente preenchido.
$$\text{Fragmentação Interna} = (\lceil \text{Tamanho} / \text{Bloco} \rceil \times \text{Bloco}) - \text{Tamanho}$$
*Exemplo*: Arquivo de 10.240 bytes em blocos de 4.096 bytes requer 3 blocos (12.288 bytes). Sobra desperdiçada = $12.288 - 10.240 = 2.048\text{ bytes}$ (50% do bloco 04).

### Fragmentação Externa
Ocorre principalmente na **alocação contígua**. Ao criar e deletar arquivos ao longo do tempo, formam-se "buracos" livres espalhados pelo disco. Pode haver espaço total suficiente para um novo arquivo, mas não contíguo.

### Compactação (Desfragmentação)
Reorganiza os blocos alocados no início do disco para que todos os blocos livres fiquem contíguos no final, eliminando a fragmentação externa.

---

## 📁 Estrutura de Arquivos do Repositório

```text
├── simulator.js   # Implementação completa em JavaScript / Node.js
├── simulator.py   # Implementação completa em Python 3
├── test_all.js    # Bateria automatizada de testes
├── README.md      # Documentação e instruções de uso
└── .gitignore     # Arquivos ignorados pelo Git
```

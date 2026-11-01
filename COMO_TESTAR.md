# 📋 Guia de Testes do Simulador de Sistema de Arquivos

Este documento apresenta todas as formas de testar o simulador e validar os requisitos exigidos na atividade (Hierarquia em Árvore, Operações CRUD, Alocação Física de Blocos e Diagnóstico de Fragmentação).

---

## ⚡ 1. Teste Rápido (Demonstração do Enunciado)

Para gerar instantaneamente as saídas idênticas aos **Exemplos 1.1 e 1.2** do enunciado da disciplina:

### Com Node.js:
```bash
node simulator.js demo
```

### Com Python 3:
```bash
python simulator.py demo
```

---

## 🖥️ 2. Teste Interativo Passo a Passo (Manual)

Abra o simulador no terminal:
```bash
node simulator.js
```
*(ou `python simulator.py`)*

Copie e cole a sequência de comandos abaixo para testar cada requisito:

### Passo 2.1 — Criar Estrutura e Exibir Árvore (Exemplo 1.1)
```text
mkdir /sistema
mkdir /sistema/logs
create /sistema/logs/app.log --size 10KB
tree
```
**Resultado esperado:**
```text
[ÁRVORE DO SISTEMA DE ARQUIVOS]
/
├── sistema/ [DIR]
│   └── logs/ [DIR]
│       └── app.log (10 KB) [ARQ]
```

### Passo 2.2 — Diagnóstico do Disco e Fragmentação Interna (Exemplo 1.2)
```text
fs_status --details
```
**Resultado esperado:**
* Bloco 00: Inode da Raiz `/`
* Bloco 01: Inode do arquivo `app.log`
* Blocos 02, 03 e 04: Blocos de dados ocupados (4096B, 4096B e 2048B)
* Blocos 05..15: Livres
* Relatório apontando **2048 bytes de Fragmentação Interna (50% de desperdício no Bloco 04)**.

### Passo 2.3 — Testar Operações CRUD Restantes
```text
# Ler arquivo (Read)
read /sistema/logs/app.log

# Atualizar arquivo aumentando o tamanho (Update)
update /sistema/logs/app.log --size 14KB
fs_status --details

# Navegação e Caminhos Relativos
cd /sistema/logs
pwd
create relatorio.txt --size 2KB
cd ..
pwd
ls

# Deletar arquivo (Delete)
rm /sistema/logs/relatorio.txt
tree
```

### Passo 2.4 — Demonstrar Fragmentação Externa e Compactação
Para demonstrar a presença de **Fragmentação Externa** e a **Compactação**:
```text
# Alternar para Alocação Contígua
strategy contiguous

# Criar três arquivos contíguos
create /arqA.bin --size 4KB
create /arqB.bin --size 8KB
create /arqC.bin --size 4KB
fs_status --details

# Deletar o arquivo do meio (cria um "buraco" de blocos livres isolados)
rm /arqB.bin
fs_status --details
```
Observe no relatório:
* `Fragmentação Externa: 8192 bytes`
* `Necessidade de Compactação: SIM`

Agora execute a compactação para eliminar os buracos:
```text
compact
fs_status --details
```
Observe que os arquivos foram reorganizados no início do disco e a necessidade de compactação volta para `NÃO`.

---

## 🧪 3. Bateria Completa de Testes Automatizados

Para rodar uma bateria automatizada que valida caminhos relativos, CRUD, alocação contígua e desfragmentação:

```bash
node test_all.js
```

---

## 🖱️ 4. No Windows (Execução Rápida)
Basta dar dois cliques no arquivo `testar.bat` presente na raiz da pasta do projeto. Ele executará a demonstração e exibirá o relatório diretamente no prompt de comando.

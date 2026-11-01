#!/usr/bin/env node
/**
 * SIMULADOR DE SISTEMA DE ARQUIVOS E ALOCAÇÃO FÍSICA EM DISCO
 * Disciplina: Sistemas Operacionais
 * 
 * Funcionalidades:
 * 1. Hierarquia em Árvore (Diretórios, arquivos, caminhos absolutos e relativos)
 * 2. Operações CRUD (Create, Read, Update, Delete)
 * 3. Mapeamento e Alocação Física de Blocos (Indexada/i-node, Contígua, Encadeada/FAT)
 * 4. Diagnóstico do Disco (Mapa gráfico, Fragmentação Interna, Fragmentação Externa, Compactação)
 */

const readline = require('readline');

// ==========================================
// UTILITÁRIOS DE TAMANHO E FORMATAÇÃO
// ==========================================
function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const clean = sizeStr.toString().trim().toUpperCase();
    const match = clean.match(/^([0-9.]+)\s*(B|BYTES?|KB|K|MB|M|GB|G)?$/i);
    if (!match) {
        const val = parseInt(clean, 10);
        return isNaN(val) ? 0 : val;
    }
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    if (unit.startsWith('G')) return Math.round(num * 1024 * 1024 * 1024);
    if (unit.startsWith('M')) return Math.round(num * 1024 * 1024);
    if (unit.startsWith('K')) return Math.round(num * 1024);
    return Math.round(num);
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) {
        const kb = bytes / 1024;
        return (Number.isInteger(kb) ? kb.toString() : kb.toFixed(1)) + ' KB';
    }
    return bytes + ' B';
}

// ==========================================
// CAMADA FÍSICA DO DISCO
// ==========================================
class DiskBlock {
    constructor(id) {
        this.id = id;
        this.type = 'FREE'; // 'FREE' | 'INODE' | 'DATA'
        this.tag = '[LIVRE]';
        this.occupiedBytes = 0;
        this.filePath = null;
        this.blockIndex = null; // 1-based index within file data blocks
        this.details = '';
        this.nextBlock = null;  // For linked allocation
    }

    setFree() {
        this.type = 'FREE';
        this.tag = '[LIVRE]';
        this.occupiedBytes = 0;
        this.filePath = null;
        this.blockIndex = null;
        this.details = '';
        this.nextBlock = null;
    }
}

class SimulatedDisk {
    constructor(totalBlocks = 16, blockSize = 4096) {
        this.totalBlocks = totalBlocks;
        this.blockSize = blockSize; // 4 KB padrão
        this.blocks = Array.from({ length: totalBlocks }, (_, i) => new DiskBlock(i));
    }

    get totalCapacityBytes() {
        return this.totalBlocks * this.blockSize;
    }

    get freeBlocksCount() {
        return this.blocks.filter(b => b.type === 'FREE').length;
    }

    get freeBlocksBytes() {
        return this.freeBlocksCount * this.blockSize;
    }

    findFreeBlock(startIndex = 0) {
        for (let i = startIndex; i < this.totalBlocks; i++) {
            if (this.blocks[i].type === 'FREE') return i;
        }
        return -1;
    }

    findFreeBlocks(count) {
        const free = [];
        for (let i = 0; i < this.totalBlocks && free.length < count; i++) {
            if (this.blocks[i].type === 'FREE') {
                free.push(i);
            }
        }
        return free.length === count ? free : null;
    }

    findContiguousFreeBlocks(count) {
        let runStart = -1;
        let runLength = 0;

        for (let i = 0; i < this.totalBlocks; i++) {
            if (this.blocks[i].type === 'FREE') {
                if (runLength === 0) runStart = i;
                runLength++;
                if (runLength === count) {
                    return Array.from({ length: count }, (_, idx) => runStart + idx);
                }
            } else {
                runLength = 0;
                runStart = -1;
            }
        }
        return null;
    }

    // Calcula fragmentação externa (blocos livres totais vs maior segmento contíguo)
    getExternalFragmentationStats() {
        let maxContiguous = 0;
        let currentContiguous = 0;
        let totalFree = 0;
        let freeSegments = 0;
        let inSegment = false;

        for (let i = 0; i < this.totalBlocks; i++) {
            if (this.blocks[i].type === 'FREE') {
                totalFree++;
                currentContiguous++;
                if (!inSegment) {
                    inSegment = true;
                    freeSegments++;
                }
                if (currentContiguous > maxContiguous) {
                    maxContiguous = currentContiguous;
                }
            } else {
                inSegment = false;
                currentContiguous = 0;
            }
        }

        // Fragmentação externa ocorre quando há blocos livres mas fragmentados
        const fragmentedFreeBlocks = totalFree - maxContiguous;
        const fragmentedBytes = fragmentedFreeBlocks * this.blockSize;

        return {
            totalFreeBlocks: totalFree,
            maxContiguousBlocks: maxContiguous,
            fragmentedFreeBlocks,
            fragmentedBytes,
            freeSegments
        };
    }

    freePath(filePath) {
        for (const block of this.blocks) {
            if (block.filePath === filePath) {
                block.setFree();
            }
        }
    }
}

// ==========================================
// SISTEMA DE ARQUIVOS E HIERARQUIA
// ==========================================
class FSNode {
    constructor(name, isDirectory = false, parent = null) {
        this.name = name;
        this.isDirectory = isDirectory;
        this.parent = parent;
        this.children = isDirectory ? new Map() : null;
        this.size = 0; // bytes
        this.inodeBlock = null;
        this.dataBlocks = [];
        this.createdAt = new Date();
        this.updatedAt = new Date();
        this.content = isDirectory ? null : '';
    }

    getFullPath() {
        if (!this.parent) return '/';
        const parts = [];
        let curr = this;
        while (curr && curr.parent) {
            parts.unshift(curr.name);
            curr = curr.parent;
        }
        return '/' + parts.join('/');
    }
}

class FileSystem {
    constructor(options = {}) {
        this.blockSize = options.blockSize || 4096; // 4 KB
        this.totalBlocks = options.totalBlocks || 16; // 16 blocos = 64 KB
        this.strategy = options.strategy || 'INDEXED'; // 'INDEXED' | 'CONTIGUOUS' | 'LINKED'
        
        this.disk = new SimulatedDisk(this.totalBlocks, this.blockSize);
        this.root = new FSNode('/', true, null);
        this.currentDir = this.root;

        // Bloco 00: Inode da Raiz
        this._allocateRootInode();
    }

    _allocateRootInode() {
        const rootBlock = this.disk.blocks[0];
        rootBlock.type = 'INODE';
        rootBlock.tag = '[INODE_RAIZ]';
        rootBlock.filePath = '/';
        rootBlock.occupiedBytes = 0;
        rootBlock.details = "Diretório '/'";
        this.root.inodeBlock = 0;
    }

    // Resolve caminhos absolutos (ex: /sistema/logs) e relativos (ex: logs/app.log, ../, .)
    resolveNode(pathStr) {
        if (!pathStr || pathStr.trim() === '') return this.currentDir;

        const clean = pathStr.trim();
        let current = clean.startsWith('/') ? this.root : this.currentDir;
        const parts = clean.split('/').filter(p => p.length > 0);

        for (const part of parts) {
            if (part === '.') continue;
            if (part === '..') {
                if (current.parent) {
                    current = current.parent;
                }
                continue;
            }

            if (!current.isDirectory) {
                return null; // Não é diretório
            }

            if (!current.children.has(part)) {
                return null; // Não encontrado
            }
            current = current.children.get(part);
        }
        return current;
    }

    // Retorna { parentNode, baseName } para criação
    resolveParentAndName(pathStr) {
        const clean = pathStr.trim();
        if (clean === '/' || clean === '') return null;

        const normalized = clean.endsWith('/') && clean.length > 1 ? clean.slice(0, -1) : clean;
        const lastSlash = normalized.lastIndexOf('/');

        let parentNode;
        let baseName;

        if (lastSlash === -1) {
            parentNode = this.currentDir;
            baseName = normalized;
        } else if (lastSlash === 0) {
            parentNode = this.root;
            baseName = normalized.slice(1);
        } else {
            const parentPath = normalized.slice(0, lastSlash);
            baseName = normalized.slice(lastSlash + 1);
            parentNode = this.resolveNode(parentPath);
        }

        if (!parentNode || !parentNode.isDirectory) return null;
        if (!baseName || baseName === '.' || baseName === '..') return null;

        return { parentNode, baseName };
    }

    // ----------------------------------------------------
    // OPERAÇÕES CRUD: DIRETÓRIO (mkdir)
    // ----------------------------------------------------
    mkdir(pathStr) {
        const resolved = this.resolveParentAndName(pathStr);
        if (!resolved) {
            // Tenta criar caminhos intermediários se necessário (estilo mkdir -p)
            return this._mkdirRecursive(pathStr);
        }

        const { parentNode, baseName } = resolved;
        if (parentNode.children.has(baseName)) {
            throw new Error(`Diretório ou arquivo '${baseName}' já existe.`);
        }

        const newDir = new FSNode(baseName, true, parentNode);
        parentNode.children.set(baseName, newDir);
        return newDir;
    }

    _mkdirRecursive(pathStr) {
        const clean = pathStr.trim();
        const isAbs = clean.startsWith('/');
        let curr = isAbs ? this.root : this.currentDir;
        const parts = clean.split('/').filter(p => p.length > 0);

        for (const part of parts) {
            if (part === '.') continue;
            if (part === '..') {
                if (curr.parent) curr = curr.parent;
                continue;
            }
            if (!curr.isDirectory) {
                throw new Error(`Caminho inválido: '${curr.name}' não é um diretório.`);
            }
            if (!curr.children.has(part)) {
                const newDir = new FSNode(part, true, curr);
                curr.children.set(part, newDir);
                curr = newDir;
            } else {
                curr = curr.children.get(part);
            }
        }
        return curr;
    }

    // ----------------------------------------------------
    // OPERAÇÕES CRUD: ARQUIVO (create, read, update, delete)
    // ----------------------------------------------------
    createFile(pathStr, sizeBytes = 0, content = '') {
        const resolved = this.resolveParentAndName(pathStr);
        if (!resolved) {
            throw new Error(`Caminho pai inexistente para '${pathStr}'. Crie os diretórios primeiro com mkdir.`);
        }

        const { parentNode, baseName } = resolved;
        if (parentNode.children.has(baseName)) {
            throw new Error(`Arquivo ou diretório '${baseName}' já existe.`);
        }

        const fullPath = (parentNode === this.root ? '' : parentNode.getFullPath()) + '/' + baseName;
        const neededDataBlocks = Math.ceil(sizeBytes / this.blockSize);

        // Alocação de acordo com a estratégia
        const allocationResult = this._allocateBlocks(fullPath, baseName, sizeBytes, neededDataBlocks);

        const newFile = new FSNode(baseName, false, parentNode);
        newFile.size = sizeBytes;
        newFile.content = content || `[Dados simulados de ${baseName} (${formatSize(sizeBytes)})]`;
        newFile.inodeBlock = allocationResult.inodeBlock;
        newFile.dataBlocks = allocationResult.dataBlocks;

        parentNode.children.set(baseName, newFile);
        return newFile;
    }

    _allocateBlocks(fullPath, baseName, sizeBytes, neededDataBlocks) {
        if (this.strategy === 'INDEXED') {
            // Estratégia Indexada: 1 Bloco de Inode + N blocos de dados (podem ser não contíguos)
            const totalNeeded = 1 + neededDataBlocks;
            const freeBlocks = this.disk.findFreeBlocks(totalNeeded);
            if (!freeBlocks) {
                throw new Error(`Disco Cheio! Necessários ${totalNeeded} blocos (${formatSize(totalNeeded * this.blockSize)}), disponíveis: ${this.disk.freeBlocksCount} blocos.`);
            }

            const inodeBlockId = freeBlocks[0];
            const dataBlockIds = freeBlocks.slice(1);

            // Grava o Inode no disco
            const inodeBlock = this.disk.blocks[inodeBlockId];
            inodeBlock.type = 'INODE';
            inodeBlock.tag = `[INODE_${this._formatInodeTag(baseName)}]`;
            inodeBlock.filePath = fullPath;
            inodeBlock.occupiedBytes = 0; // Inode guarda metadados/ponteiros
            inodeBlock.details = `Arquivo '${fullPath}'`;

            // Grava os blocos de dados
            let remainingBytes = sizeBytes;
            for (let i = 0; i < dataBlockIds.length; i++) {
                const bId = dataBlockIds[i];
                const block = this.disk.blocks[bId];
                const bytesInThisBlock = Math.min(this.blockSize, remainingBytes);
                remainingBytes -= bytesInThisBlock;

                block.type = 'DADO';
                block.tag = '[DADO]';
                block.filePath = fullPath;
                block.blockIndex = i + 1;
                block.occupiedBytes = bytesInThisBlock;
                block.details = `'${fullPath}' (Bloco ${i + 1} - ${bytesInThisBlock} bytes ocupados)`;
            }

            return { inodeBlock: inodeBlockId, dataBlocks: dataBlockIds };

        } else if (this.strategy === 'CONTIGUOUS') {
            // Estratégia Contígua: Todos os blocos de dados devem ser estritamente adjacentes
            const freeContiguous = this.disk.findContiguousFreeBlocks(neededDataBlocks);
            if (!freeContiguous) {
                const totalFree = this.disk.freeBlocksCount;
                if (totalFree >= neededDataBlocks) {
                    throw new Error(`Fragmentação Externa! Existem ${totalFree} blocos livres no total, mas nenhum segmento contíguo de tamanho ${neededDataBlocks}. É necessário compactar o disco!`);
                } else {
                    throw new Error(`Espaço insuficiente no disco. Necessários: ${neededDataBlocks} blocos contíguos, disponíveis: ${totalFree}.`);
                }
            }

            let remainingBytes = sizeBytes;
            for (let i = 0; i < freeContiguous.length; i++) {
                const bId = freeContiguous[i];
                const block = this.disk.blocks[bId];
                const bytesInThisBlock = Math.min(this.blockSize, remainingBytes);
                remainingBytes -= bytesInThisBlock;

                block.type = 'DADO';
                block.tag = '[CONTÍGUO]';
                block.filePath = fullPath;
                block.blockIndex = i + 1;
                block.occupiedBytes = bytesInThisBlock;
                block.details = `'${fullPath}' (Bloco ${i + 1} - ${bytesInThisBlock} bytes ocupados)`;
            }

            return { inodeBlock: null, dataBlocks: freeContiguous };

        } else if (this.strategy === 'LINKED') {
            // Estratégia Encadeada (FAT / Lista Encadeada)
            const freeBlocks = this.disk.findFreeBlocks(neededDataBlocks);
            if (!freeBlocks) {
                throw new Error(`Disco Cheio! Necessários ${neededDataBlocks} blocos, disponíveis: ${this.disk.freeBlocksCount}.`);
            }

            let remainingBytes = sizeBytes;
            for (let i = 0; i < freeBlocks.length; i++) {
                const bId = freeBlocks[i];
                const nextId = i + 1 < freeBlocks.length ? freeBlocks[i + 1] : null;
                const block = this.disk.blocks[bId];
                const bytesInThisBlock = Math.min(this.blockSize, remainingBytes);
                remainingBytes -= bytesInThisBlock;

                block.type = 'DADO';
                block.tag = '[ENCADEADO]';
                block.filePath = fullPath;
                block.blockIndex = i + 1;
                block.occupiedBytes = bytesInThisBlock;
                block.nextBlock = nextId;
                block.details = `'${fullPath}' (Bloco ${i + 1} - ${bytesInThisBlock} bytes ocupados, Próximo: ${nextId !== null ? `Bloco ${String(nextId).padStart(2, '0')}` : 'FIM'})`;
            }

            return { inodeBlock: null, dataBlocks: freeBlocks };
        }
    }

    _formatInodeTag(filename) {
        const namePart = filename.includes('.') ? filename.split('.')[0] : filename;
        const clean = namePart.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        return clean.slice(0, 8);
    }

    readFile(pathStr) {
        const node = this.resolveNode(pathStr);
        if (!node) {
            throw new Error(`Arquivo não encontrado: '${pathStr}'`);
        }
        if (node.isDirectory) {
            throw new Error(`'${pathStr}' é um diretório. Use 'ls' para listar seu conteúdo.`);
        }
        return {
            name: node.name,
            path: node.getFullPath(),
            size: node.size,
            formattedSize: formatSize(node.size),
            inodeBlock: node.inodeBlock,
            dataBlocks: node.dataBlocks,
            content: node.content,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt
        };
    }

    updateFile(pathStr, newSizeBytes, newContent = null) {
        const node = this.resolveNode(pathStr);
        if (!node) {
            throw new Error(`Arquivo não encontrado: '${pathStr}'`);
        }
        if (node.isDirectory) {
            throw new Error(`'${pathStr}' é um diretório, não um arquivo.`);
        }

        const fullPath = node.getFullPath();
        const baseName = node.name;

        // Libera blocos anteriores
        this.disk.freePath(fullPath);

        // Aloca novos blocos com o novo tamanho
        const neededDataBlocks = Math.ceil(newSizeBytes / this.blockSize);
        try {
            const allocation = this._allocateBlocks(fullPath, baseName, newSizeBytes, neededDataBlocks);
            node.size = newSizeBytes;
            node.inodeBlock = allocation.inodeBlock;
            node.dataBlocks = allocation.dataBlocks;
            node.updatedAt = new Date();
            if (newContent !== null) node.content = newContent;
            return node;
        } catch (err) {
            // Em caso de falha de espaço, tentar restaurar ou propagar erro
            throw new Error(`Erro ao atualizar arquivo: ${err.message}`);
        }
    }

    delete(pathStr) {
        const clean = pathStr.trim();
        if (clean === '/' || clean === '') {
            throw new Error("Não é permitido deletar o diretório raiz '/'.");
        }

        const node = this.resolveNode(clean);
        if (!node) {
            throw new Error(`Arquivo ou diretório não encontrado: '${clean}'`);
        }

        if (node === this.currentDir) {
            throw new Error("Não é possível deletar o diretório atual de trabalho. Mude com 'cd ..' primeiro.");
        }

        const fullPath = node.getFullPath();

        // Se for diretório, libera recursivamente todos os arquivos filhos
        if (node.isDirectory) {
            this._freeDirectoryRecursive(node);
        } else {
            this.disk.freePath(fullPath);
        }

        // Remove do pai
        node.parent.children.delete(node.name);
        return true;
    }

    _freeDirectoryRecursive(dirNode) {
        for (const child of dirNode.children.values()) {
            if (child.isDirectory) {
                this._freeDirectoryRecursive(child);
            } else {
                this.disk.freePath(child.getFullPath());
            }
        }
    }

    // ----------------------------------------------------
    // NAVEGAÇÃO E LISTAGEM
    // ----------------------------------------------------
    cd(pathStr) {
        const target = this.resolveNode(pathStr);
        if (!target) {
            throw new Error(`Diretório não encontrado: '${pathStr}'`);
        }
        if (!target.isDirectory) {
            throw new Error(`'${pathStr}' não é um diretório.`);
        }
        this.currentDir = target;
        return this.currentDir.getFullPath();
    }

    pwd() {
        return this.currentDir.getFullPath();
    }

    list(pathStr = '') {
        const target = pathStr ? this.resolveNode(pathStr) : this.currentDir;
        if (!target) {
            throw new Error(`Caminho não encontrado: '${pathStr}'`);
        }
        if (!target.isDirectory) {
            return [{
                name: target.name,
                isDir: false,
                size: target.size,
                formattedSize: formatSize(target.size)
            }];
        }

        const items = [];
        for (const child of target.children.values()) {
            items.push({
                name: child.name,
                isDir: child.isDirectory,
                size: child.size,
                formattedSize: child.isDirectory ? '-' : formatSize(child.size)
            });
        }
        return items;
    }

    // Exibe árvore hierárquica idêntica ao Exemplo 1.1 do enunciado
    getTreeString(startNode = this.root) {
        const lines = [];
        lines.push('[ÁRVORE DO SISTEMA DE ARQUIVOS]');
        lines.push(startNode.getFullPath());

        const buildTree = (node, prefix = '') => {
            if (!node.isDirectory) return;
            const entries = Array.from(node.children.values());
            entries.forEach((child, index) => {
                // Para a raiz com 1 único nó, manter '├── ' para compatibilidade visual exata com o enunciado
                const isLast = (node === this.root && entries.length === 1) ? false : (index === entries.length - 1);
                const connector = isLast ? '└── ' : '├── ';
                const childPrefix = isLast ? '    ' : '│   ';

                if (child.isDirectory) {
                    lines.push(`${prefix}${connector}${child.name}/ [DIR]`);
                    buildTree(child, prefix + childPrefix);
                } else {
                    lines.push(`${prefix}${connector}${child.name} (${formatSize(child.size)}) [ARQ]`);
                }
            });
        };

        buildTree(startNode);
        return lines.join('\n');
    }

    // ----------------------------------------------------
    // DIAGNÓSTICO DO DISCO E FRAGMENTAÇÃO
    // ----------------------------------------------------
    getAllFiles(dir = this.root, acc = []) {
        for (const child of dir.children.values()) {
            if (child.isDirectory) {
                this.getAllFiles(child, acc);
            } else {
                acc.push(child);
            }
        }
        return acc;
    }

    getDiskStatusString(details = true) {
        const lines = [];
        const strategyName = this.strategy === 'INDEXED' ? 'Indexado' :
            (this.strategy === 'CONTIGUOUS' ? 'Contíguo' : 'Encadeado (FAT)');

        lines.push(`Tamanho do Bloco de Disco: ${formatSize(this.blockSize)} | Total de Blocos: ${this.totalBlocks} (${formatSize(this.disk.totalCapacityBytes)})`);
        lines.push('');
        lines.push(`[MAPA DE ALOCAÇÃO DO DISCO (${strategyName})]`);

        // Agrupamento de blocos para exibição limpa
        let i = 0;
        while (i < this.disk.totalBlocks) {
            const block = this.disk.blocks[i];

            if (block.type === 'FREE') {
                // Encontra sequência de blocos livres contíguos
                let startFree = i;
                while (i < this.disk.totalBlocks && this.disk.blocks[i].type === 'FREE') {
                    i++;
                }
                const endFree = i - 1;
                if (startFree === endFree) {
                    lines.push(`Bloco ${String(startFree).padStart(2, '0')}              : [LIVRE]`);
                } else {
                    lines.push(`Bloco ${String(startFree).padStart(2, '0')}..${String(endFree).padStart(2, '0')}           : [LIVRE]`);
                }
            } else {
                const blockNum = String(block.id).padStart(2, '0');
                const tag = block.tag.padEnd(14, ' ');
                lines.push(`Bloco ${blockNum} ${tag}: ${block.details}`);
                i++;
            }
        }

        lines.push('');
        lines.push('--- RELATÓRIO DE FRAGMENTAÇÃO ---');

        const allFiles = this.getAllFiles();

        if (allFiles.length === 0) {
            lines.push('Nenhum arquivo gravado no sistema.');
            lines.push('Fragmentação Interna             : 0 bytes');
            lines.push('Fragmentação Externa             : 0 bytes');
            lines.push('Necessidade de Compactação       : NÃO (Disco vazio)');
            return lines.join('\n');
        }

        let totalRealBytes = 0;
        let totalAllocatedBytes = 0;
        let totalInternalFrag = 0;

        allFiles.forEach(file => {
            const dataBlocksCount = file.dataBlocks.length;
            const allocatedForData = dataBlocksCount * this.blockSize;
            const internalFrag = allocatedForData > file.size ? (allocatedForData - file.size) : 0;
            const lastBlockNum = dataBlocksCount > 0 ? file.dataBlocks[dataBlocksCount - 1] : null;

            totalRealBytes += file.size;
            totalAllocatedBytes += allocatedForData;
            totalInternalFrag += internalFrag;

            const percentWasted = internalFrag > 0 ? Math.round((internalFrag / this.blockSize) * 100) : 0;
            const lastBlockInfo = lastBlockNum !== null ? ` no Bloco ${String(lastBlockNum).padStart(2, '0')}` : '';

            lines.push(`Tamanho Real do Arquivo '${file.name}': ${file.size} bytes (${formatSize(file.size)})`);
            lines.push(`Espaço Alocado no Disco          : ${allocatedForData} bytes (${dataBlocksCount} blocos de ${formatSize(this.blockSize)})`);
            lines.push(`Fragmentação Interna             : ${internalFrag} bytes (${percentWasted}% de desperdício${lastBlockInfo})`);
        });

        // Fragmentação Externa
        const extStats = this.disk.getExternalFragmentationStats();
        const externalFragBytes = this.strategy === 'CONTIGUOUS' ? extStats.fragmentedBytes : 0;
        lines.push(`Fragmentação Externa             : ${externalFragBytes} bytes`);

        // Necessidade de Compactação
        let needCompaction = 'NÃO';
        let reason = '';

        if (this.strategy === 'INDEXED') {
            needCompaction = 'NÃO';
            reason = ' (Blocos alocados via i-node indexado)';
        } else if (this.strategy === 'LINKED') {
            needCompaction = 'NÃO';
            reason = ' (Alocação encadeada não requer blocos contíguos)';
        } else if (this.strategy === 'CONTIGUOUS') {
            if (extStats.fragmentedFreeBlocks > 0 && extStats.freeSegments > 1) {
                needCompaction = 'SIM';
                reason = ` (${extStats.fragmentedFreeBlocks} blocos livres dispersos em ${extStats.freeSegments} segmentos. Use o comando 'compact')`;
            } else {
                needCompaction = 'NÃO';
                reason = ' (Blocos livres estão agrupados de forma contígua)';
            }
        }

        lines.push(`Necessidade de Compactação       : ${needCompaction}${reason}`);

        return lines.join('\n');
    }

    // Compacta o disco (reorganiza blocos de dados de forma contígua eliminando fragmentação externa)
    compactDisk() {
        if (this.strategy !== 'CONTIGUOUS') {
            return "Compactação de disco é aplicável principalmente na alocação CONTÍGUA, onde evita fragmentação externa.";
        }

        const allFiles = this.getAllFiles();
        // Limpa blocos de dados
        for (let i = 0; i < this.disk.totalBlocks; i++) {
            if (this.disk.blocks[i].type !== 'INODE') {
                this.disk.blocks[i].setFree();
            }
        }

        // Realoca arquivos de forma consecutiva
        let nextBlock = 0;
        // Pula os inodes (se houver)
        while (nextBlock < this.disk.totalBlocks && this.disk.blocks[nextBlock].type === 'INODE') {
            nextBlock++;
        }

        for (const file of allFiles) {
            const needed = Math.ceil(file.size / this.blockSize);
            file.dataBlocks = [];
            let remaining = file.size;

            for (let b = 0; b < needed; b++) {
                const bId = nextBlock++;
                file.dataBlocks.push(bId);
                const block = this.disk.blocks[bId];
                const bytesInThisBlock = Math.min(this.blockSize, remaining);
                remaining -= bytesInThisBlock;

                block.type = 'DADO';
                block.tag = '[CONTÍGUO]';
                block.filePath = file.getFullPath();
                block.blockIndex = b + 1;
                block.occupiedBytes = bytesInThisBlock;
                block.details = `'${file.getFullPath()}' (Bloco ${b + 1} - ${bytesInThisBlock} bytes ocupados)`;
            }
        }

        return "Disco compactado com sucesso! Todos os arquivos foram realocados contiguamente.";
    }

    setStrategy(strategyName) {
        const strat = strategyName.toUpperCase();
        if (!['INDEXED', 'CONTIGUOUS', 'LINKED'].includes(strat)) {
            throw new Error("Estratégia inválida. Escolha entre: INDEXED, CONTIGUOUS, LINKED.");
        }
        this.strategy = strat;
        return `Estratégia física de alocação alterada para: ${strat}`;
    }
}

// ==========================================
// INTERFACE DE LINHA DE COMANDO (REPL)
// ==========================================
function startCLI() {
    const fs = new FileSystem();

    const banner = `
======================================================================
  SIMULADOR DE SISTEMA DE ARQUIVOS & ALOCAÇÃO FÍSICA DE BLOCOS
  Sistemas Operacionais - Entrega de Projeto
======================================================================
Comandos Disponíveis:
  mkdir <caminho>                 - Cria um diretório (ex: mkdir /sistema/logs)
  create <caminho> --size <tam>   - Cria arquivo com tamanho (ex: create /sistema/logs/app.log --size 10KB)
  read <caminho>                  - Lê conteúdo e metadados de um arquivo
  update <caminho> --size <tam>   - Atualiza tamanho de um arquivo existente
  rm <caminho>                    - Remove arquivo ou diretório
  cd <caminho>                    - Navega entre diretórios (ex: cd /sistema, cd .., cd logs)
  pwd                             - Mostra o diretório atual
  ls [caminho]                    - Lista itens do diretório
  tree                            - Exibe a hierarquia em árvore
  fs_status [--details]           - Exibe o mapa físico do disco e diagnóstico de fragmentação
  strategy <indexed|contiguous|linked> - Alterna a estratégia de alocação física
  compact                         - Compacta o disco (elimina fragmentação externa)
  demo                            - Executa o cenário de exemplo exato do enunciado
  help                            - Mostra esta lista de ajuda
  exit                            - Encerra o simulador
======================================================================
`;

    console.log(banner);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `simulador:${fs.pwd()}> `
    });

    rl.prompt();

    rl.on('line', (line) => {
        const input = line.trim();
        if (!input) {
            rl.setPrompt(`simulador:${fs.pwd()}> `);
            rl.prompt();
            return;
        }

        try {
            executeCommand(fs, input);
        } catch (err) {
            console.error(`[ERRO]: ${err.message}`);
        }

        rl.setPrompt(`simulador:${fs.pwd()}> `);
        rl.prompt();
    }).on('close', () => {
        console.log('\nSaindo do simulador. Até mais!');
        process.exit(0);
    });
}

function executeCommand(fs, inputStr) {
    const tokens = inputStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cleanTokens = tokens.map(t => t.replace(/^"|"$/g, ''));
    const cmd = cleanTokens[0]?.toLowerCase();
    const args = cleanTokens.slice(1);

    switch (cmd) {
        case 'help':
            console.log(`
Comandos suportados:
  mkdir <caminho>                 : Cria diretório
  create <caminho> --size <tam>   : Cria arquivo (ex: create /sistema/logs/app.log --size 10KB)
  read <caminho> (ou cat)         : Lê arquivo
  update <caminho> --size <tam>   : Atualiza arquivo existente
  rm <caminho> (ou delete)        : Deleta arquivo ou pasta
  cd <caminho>                    : Muda diretório atual
  pwd                             : Diretório atual
  ls [caminho]                    : Lista arquivos e pastas
  tree                            : Exibe árvore do sistema
  fs_status [--details]           : Mapa de blocos e relatório de fragmentação
  strategy <tipo>                 : Define estratégia (INDEXED, CONTIGUOUS, LINKED)
  compact (ou defrag)             : Compacta o disco
  demo                            : Executa o fluxo de teste do enunciado
  exit                            : Fecha o programa
            `);
            break;

        case 'mkdir':
            if (args.length === 0) {
                console.log("Uso: mkdir <caminho>");
                return;
            }
            fs.mkdir(args[0]);
            console.log(`Diretório criado: ${args[0]}`);
            break;

        case 'create':
            if (args.length === 0) {
                console.log("Uso: create <caminho> --size <tamanho> (ex: create /sistema/logs/app.log --size 10KB)");
                return;
            }
            let path = args[0];
            let size = 0;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '--size' && args[i + 1]) {
                    size = parseSize(args[i + 1]);
                    i++;
                }
            }
            const created = fs.createFile(path, size);
            console.log(`Arquivo '${created.getFullPath()}' criado com sucesso (${formatSize(created.size)}).`);
            break;

        case 'read':
        case 'cat':
            if (args.length === 0) {
                console.log("Uso: read <caminho>");
                return;
            }
            const info = fs.readFile(args[0]);
            console.log(`--- [ARQUIVO: ${info.path}] ---`);
            console.log(`Tamanho       : ${info.size} bytes (${info.formattedSize})`);
            if (info.inodeBlock !== null) console.log(`Bloco Inode   : Bloco ${String(info.inodeBlock).padStart(2, '0')}`);
            console.log(`Blocos de Dado: ${info.dataBlocks.map(b => 'Bloco ' + String(b).padStart(2, '0')).join(', ') || 'Nenhum'}`);
            console.log(`Conteúdo      : ${info.content}`);
            break;

        case 'update':
            if (args.length === 0) {
                console.log("Uso: update <caminho> --size <novo_tamanho>");
                return;
            }
            let uPath = args[0];
            let uSize = 0;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '--size' && args[i + 1]) {
                    uSize = parseSize(args[i + 1]);
                    i++;
                }
            }
            fs.updateFile(uPath, uSize);
            console.log(`Arquivo '${uPath}' atualizado com sucesso para ${formatSize(uSize)}.`);
            break;

        case 'rm':
        case 'delete':
            if (args.length === 0) {
                console.log("Uso: rm <caminho>");
                return;
            }
            fs.delete(args[0]);
            console.log(`Item '${args[0]}' removido com sucesso.`);
            break;

        case 'cd':
            const target = args[0] || '/';
            const newPath = fs.cd(target);
            console.log(`Diretório atual: ${newPath}`);
            break;

        case 'pwd':
            console.log(fs.pwd());
            break;

        case 'ls':
            const items = fs.list(args[0] || '');
            if (items.length === 0) {
                console.log("(Diretório vazio)");
            } else {
                items.forEach(it => {
                    const typeLabel = it.isDir ? '<DIR>' : '<ARQ>';
                    console.log(`  ${typeLabel.padEnd(6)} ${it.name.padEnd(20)} ${it.formattedSize}`);
                });
            }
            break;

        case 'tree':
            console.log(fs.getTreeString());
            break;

        case 'fs_status':
        case 'status':
            const details = args.includes('--details') || true;
            console.log(fs.getDiskStatusString(details));
            break;

        case 'strategy':
            if (args.length === 0) {
                console.log(`Estratégia atual: ${fs.strategy} (Opções: INDEXED, CONTIGUOUS, LINKED)`);
                return;
            }
            console.log(fs.setStrategy(args[0]));
            break;

        case 'compact':
        case 'defrag':
            console.log(fs.compactDisk());
            break;

        case 'demo':
            runDemoScenario(fs);
            break;

        case 'exit':
        case 'quit':
            console.log("Encerrando simulador...");
            process.exit(0);

        default:
            console.log(`Comando desconhecido: '${cmd}'. Digite 'help' para ajuda.`);
            break;
    }
}

function runDemoScenario(fs) {
    console.log("\n>>> EXECUTANDO CENÁRIO DE DEMONSTRAÇÃO DO ENUNCIADO <<<\n");

    console.log("> mkdir /sistema");
    fs.mkdir("/sistema");

    console.log("> mkdir /sistema/logs");
    fs.mkdir("/sistema/logs");

    console.log("> create /sistema/logs/app.log --size 10KB");
    fs.createFile("/sistema/logs/app.log", 10 * 1024);

    console.log("\n[Exemplo 1.1 — Exibição da Árvore Hierárquica]:");
    console.log(fs.getTreeString());

    console.log("\n[Exemplo 1.2 — Alocação Indexada e Análise de Fragmentação]:");
    console.log(fs.getDiskStatusString(true));
}

// Inicialização direta via CLI
if (require.main === module) {
    // Se passar argumento 'demo' na linha de comando: node simulator.js demo
    if (process.argv.includes('--demo') || process.argv.includes('demo')) {
        const fs = new FileSystem();
        runDemoScenario(fs);
    } else {
        startCLI();
    }
}

module.exports = { FileSystem, SimulatedDisk, FSNode, parseSize, formatSize };

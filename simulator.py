#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SIMULADOR DE SISTEMA DE ARQUIVOS E ALOCAÇÃO FÍSICA EM DISCO
Disciplina: Sistemas Operacionais

Funcionalidades:
1. Hierarquia em Árvore (Diretórios, arquivos, caminhos absolutos e relativos)
2. Operações CRUD (Create, Read, Update, Delete)
3. Mapeamento e Alocação Física de Blocos (Indexada/i-node, Contígua, Encadeada/FAT)
4. Diagnóstico do Disco (Mapa gráfico, Fragmentação Interna, Fragmentação Externa, Compactação)
"""

import sys
import re
import math
import shlex
from datetime import datetime

# ==========================================
# UTILITÁRIOS DE TAMANHO E FORMATAÇÃO
# ==========================================
def parse_size(size_str: str) -> int:
    """Converte strings como '10KB', '4096B', '1MB' para bytes inteiros."""
    if not size_str:
        return 0
    clean = str(size_str).strip().upper()
    match = re.match(r'^([0-9.]+)\s*(B|BYTES?|KB|K|MB|M|GB|G)?$', clean, re.IGNORECASE)
    if not match:
        try:
            return int(clean)
        except ValueError:
            return 0
    num = float(match.group(1))
    unit = (match.group(2) or 'B').upper()
    if unit.startswith('G'):
        return int(round(num * 1024 * 1024 * 1024))
    if unit.startswith('M'):
        return int(round(num * 1024 * 1024))
    if unit.startswith('K'):
        return int(round(num * 1024))
    return int(round(num))

def format_size(size_bytes: int) -> str:
    """Formata bytes em representações amigáveis (B, KB, MB, GB)."""
    if size_bytes >= 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    if size_bytes >= 1024:
        kb = size_bytes / 1024
        return f"{int(kb)} KB" if kb.is_integer() else f"{kb:.1f} KB"
    return f"{size_bytes} B"

# ==========================================
# CAMADA FÍSICA DO DISCO
# ==========================================
class DiskBlock:
    def __init__(self, block_id: int):
        self.id = block_id
        self.type = 'FREE'  # 'FREE', 'INODE', 'DATA'
        self.tag = '[LIVRE]'
        self.occupied_bytes = 0
        self.file_path = None
        self.block_index = None  # 1-based index dentro dos blocos de dados do arquivo
        self.details = ''
        self.next_block = None   # Para alocação encadeada

    def set_free(self):
        self.type = 'FREE'
        self.tag = '[LIVRE]'
        self.occupied_bytes = 0
        self.file_path = None
        self.block_index = None
        self.details = ''
        self.next_block = None

class SimulatedDisk:
    def __init__(self, total_blocks: int = 16, block_size: int = 4096):
        self.total_blocks = total_blocks
        self.block_size = block_size  # Padrão: 4 KB
        self.blocks = [DiskBlock(i) for i in range(total_blocks)]

    @property
    def total_capacity_bytes(self) -> int:
        return self.total_blocks * self.block_size

    @property
    def free_blocks_count(self) -> int:
        return sum(1 for b in self.blocks if b.type == 'FREE')

    def find_free_blocks(self, count: int):
        free = [b.id for b in self.blocks if b.type == 'FREE']
        return free[:count] if len(free) >= count else None

    def find_contiguous_free_blocks(self, count: int):
        run_start = -1
        run_length = 0
        for i in range(self.total_blocks):
            if self.blocks[i].type == 'FREE':
                if run_length == 0:
                    run_start = i
                run_length += 1
                if run_length == count:
                    return list(range(run_start, run_start + count))
            else:
                run_length = 0
                run_start = -1
        return None

    def get_external_fragmentation_stats(self):
        max_contiguous = 0
        current_contiguous = 0
        total_free = 0
        free_segments = 0
        in_segment = False

        for b in self.blocks:
            if b.type == 'FREE':
                total_free += 1
                current_contiguous += 1
                if not in_segment:
                    in_segment = True
                    free_segments += 1
                if current_contiguous > max_contiguous:
                    max_contiguous = current_contiguous
            else:
                in_segment = False
                current_contiguous = 0

        fragmented_free_blocks = total_free - max_contiguous
        fragmented_bytes = fragmented_free_blocks * self.block_size

        return {
            'total_free_blocks': total_free,
            'max_contiguous_blocks': max_contiguous,
            'fragmented_free_blocks': fragmented_free_blocks,
            'fragmented_bytes': fragmented_bytes,
            'free_segments': free_segments
        }

    def free_path(self, file_path: str):
        for block in self.blocks:
            if block.file_path == file_path:
                block.set_free()

# ==========================================
# HIERARQUIA DO SISTEMA DE ARQUIVOS
# ==========================================
class FSNode:
    def __init__(self, name: str, is_directory: bool = False, parent=None):
        self.name = name
        self.is_directory = is_directory
        self.parent = parent
        self.children = {} if is_directory else None
        self.size = 0  # em bytes
        self.inode_block = None
        self.data_blocks = []
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        self.content = None if is_directory else ''

    def get_full_path(self) -> str:
        if not self.parent:
            return '/'
        parts = []
        curr = self
        while curr and curr.parent:
            parts.insert(0, curr.name)
            curr = curr.parent
        return '/' + '/'.join(parts)

class FileSystem:
    def __init__(self, total_blocks: int = 16, block_size: int = 4096, strategy: str = 'INDEXED'):
        self.total_blocks = total_blocks
        self.block_size = block_size
        self.strategy = strategy.upper()  # 'INDEXED', 'CONTIGUOUS', 'LINKED'

        self.disk = SimulatedDisk(self.total_blocks, self.block_size)
        self.root = FSNode('/', is_directory=True, parent=None)
        self.current_dir = self.root

        # Bloco 00: Inode do diretório Raiz '/'
        self._allocate_root_inode()

    def _allocate_root_inode(self):
        root_block = self.disk.blocks[0]
        root_block.type = 'INODE'
        root_block.tag = '[INODE_RAIZ]'
        root_block.file_path = '/'
        root_block.occupied_bytes = 0
        root_block.details = "Diretório '/'"
        self.root.inode_block = 0

    def resolve_node(self, path_str: str):
        """Resolve caminhos absolutos (ex: /sistema/logs) e relativos (ex: logs, ../, .)."""
        if not path_str or not path_str.strip():
            return self.current_dir

        clean = path_str.strip()
        current = self.root if clean.startswith('/') else self.current_dir
        parts = [p for p in clean.split('/') if p]

        for part in parts:
            if part == '.':
                continue
            if part == '..':
                if current.parent:
                    current = current.parent
                continue
            if not current.is_directory:
                return None
            if part not in current.children:
                return None
            current = current.children[part]
        return current

    def resolve_parent_and_name(self, path_str: str):
        clean = path_str.strip()
        if clean in ('/', ''):
            return None

        normalized = clean[:-1] if clean.endswith('/') and len(clean) > 1 else clean
        last_slash = normalized.rfind('/')

        if last_slash == -1:
            parent_node = self.current_dir
            base_name = normalized
        elif last_slash == 0:
            parent_node = self.root
            base_name = normalized[1:]
        else:
            parent_path = normalized[:last_slash]
            base_name = normalized[last_slash + 1:]
            parent_node = self.resolve_node(parent_path)

        if not parent_node or not parent_node.is_directory:
            return None
        if not base_name or base_name in ('.', '..'):
            return None

        return parent_node, base_name

    # ----------------------------------------------------
    # OPERAÇÕES CRUD: DIRETÓRIO (mkdir)
    # ----------------------------------------------------
    def mkdir(self, path_str: str):
        resolved = self.resolve_parent_and_name(path_str)
        if not resolved:
            return self._mkdir_recursive(path_str)

        parent_node, base_name = resolved
        if base_name in parent_node.children:
            raise ValueError(f"Diretório ou arquivo '{base_name}' já existe.")

        new_dir = FSNode(base_name, is_directory=True, parent=parent_node)
        parent_node.children[base_name] = new_dir
        return new_dir

    def _mkdir_recursive(self, path_str: str):
        clean = path_str.strip()
        curr = self.root if clean.startswith('/') else self.current_dir
        parts = [p for p in clean.split('/') if p]

        for part in parts:
            if part == '.':
                continue
            if part == '..':
                if curr.parent:
                    curr = curr.parent
                continue
            if not curr.is_directory:
                raise ValueError(f"Caminho inválido: '{curr.name}' não é um diretório.")
            if part not in curr.children:
                new_dir = FSNode(part, is_directory=True, parent=curr)
                curr.children[part] = new_dir
                curr = new_dir
            else:
                curr = curr.children[part]
        return curr

    # ----------------------------------------------------
    # OPERAÇÕES CRUD: ARQUIVO (create, read, update, delete)
    # ----------------------------------------------------
    def create_file(self, path_str: str, size_bytes: int = 0, content: str = ''):
        resolved = self.resolve_parent_and_name(path_str)
        if not resolved:
            raise ValueError(f"Caminho pai inexistente para '{path_str}'. Crie os diretórios primeiro com mkdir.")

        parent_node, base_name = resolved
        if base_name in parent_node.children:
            raise ValueError(f"Arquivo ou diretório '{base_name}' já existe.")

        prefix = '' if parent_node == self.root else parent_node.get_full_path()
        full_path = f"{prefix}/{base_name}"
        needed_data_blocks = math.ceil(size_bytes / self.block_size)

        alloc = self._allocate_blocks(full_path, base_name, size_bytes, needed_data_blocks)

        new_file = FSNode(base_name, is_directory=False, parent=parent_node)
        new_file.size = size_bytes
        new_file.content = content or f"[Dados simulados de {base_name} ({format_size(size_bytes)})]"
        new_file.inode_block = alloc['inode_block']
        new_file.data_blocks = alloc['data_blocks']

        parent_node.children[base_name] = new_file
        return new_file

    def _format_inode_tag(self, filename: str) -> str:
        # Se contiver extensão, pega o nome base (ex: app.log -> APP)
        name_part = filename.split('.')[0] if '.' in filename else filename
        clean = re.sub(r'[^a-zA-Z0-9]', '_', name_part).upper()
        return clean[:8]

    def _allocate_blocks(self, full_path: str, base_name: str, size_bytes: int, needed_data_blocks: int):
        if self.strategy == 'INDEXED':
            total_needed = 1 + needed_data_blocks
            free_blocks = self.disk.find_free_blocks(total_needed)
            if not free_blocks:
                raise ValueError(
                    f"Disco Cheio! Necessários {total_needed} blocos ({format_size(total_needed * self.block_size)}), "
                    f"disponíveis: {self.disk.free_blocks_count} blocos."
                )

            inode_id = free_blocks[0]
            data_ids = free_blocks[1:]

            # Bloco Inode
            inode_block = self.disk.blocks[inode_id]
            inode_block.type = 'INODE'
            inode_tag_name = self._format_inode_tag(base_name)
            inode_block.tag = f"[INODE_{inode_tag_name}]"
            inode_block.file_path = full_path
            inode_block.occupied_bytes = 0
            inode_block.details = f"Arquivo '{full_path}'"

            # Blocos de Dados
            remaining = size_bytes
            for idx, b_id in enumerate(data_ids):
                b = self.disk.blocks[b_id]
                bytes_in_block = min(self.block_size, remaining)
                remaining -= bytes_in_block

                b.type = 'DADO'
                b.tag = '[DADO]'
                b.file_path = full_path
                b.block_index = idx + 1
                b.occupied_bytes = bytes_in_block
                b.details = f"'{full_path}' (Bloco {idx + 1} - {bytes_in_block} bytes ocupados)"

            return {'inode_block': inode_id, 'data_blocks': data_ids}

        elif self.strategy == 'CONTIGUOUS':
            free_contiguous = self.disk.find_contiguous_free_blocks(needed_data_blocks)
            if not free_contiguous:
                total_free = self.disk.free_blocks_count
                if total_free >= needed_data_blocks:
                    raise ValueError(
                        f"Fragmentação Externa! Existem {total_free} blocos livres no total, mas nenhum segmento "
                        f"contíguo de tamanho {needed_data_blocks}. É necessário compactar o disco!"
                    )
                else:
                    raise ValueError(f"Espaço insuficiente. Necessários {needed_data_blocks} blocos contíguos, disponíveis: {total_free}.")

            remaining = size_bytes
            for idx, b_id in enumerate(free_contiguous):
                b = self.disk.blocks[b_id]
                bytes_in_block = min(self.block_size, remaining)
                remaining -= bytes_in_block

                b.type = 'DADO'
                b.tag = '[CONTÍGUO]'
                b.file_path = full_path
                b.block_index = idx + 1
                b.occupied_bytes = bytes_in_block
                b.details = f"'{full_path}' (Bloco {idx + 1} - {bytes_in_block} bytes ocupados)"

            return {'inode_block': None, 'data_blocks': free_contiguous}

        elif self.strategy == 'LINKED':
            free_blocks = self.disk.find_free_blocks(needed_data_blocks)
            if not free_blocks:
                raise ValueError(f"Disco Cheio! Necessários {needed_data_blocks} blocos, disponíveis: {self.disk.free_blocks_count}.")

            remaining = size_bytes
            for idx, b_id in enumerate(free_blocks):
                next_id = free_blocks[idx + 1] if idx + 1 < len(free_blocks) else None
                b = self.disk.blocks[b_id]
                bytes_in_block = min(self.block_size, remaining)
                remaining -= bytes_in_block

                b.type = 'DADO'
                b.tag = '[ENCADEADO]'
                b.file_path = full_path
                b.block_index = idx + 1
                b.occupied_bytes = bytes_in_block
                b.next_block = next_id
                next_str = f"Bloco {next_id:02d}" if next_id is not None else "FIM"
                b.details = f"'{full_path}' (Bloco {idx + 1} - {bytes_in_block} bytes ocupados, Próximo: {next_str})"

            return {'inode_block': None, 'data_blocks': free_blocks}

    def read_file(self, path_str: str):
        node = self.resolve_node(path_str)
        if not node:
            raise ValueError(f"Arquivo não encontrado: '{path_str}'")
        if node.is_directory:
            raise ValueError(f"'{path_str}' é um diretório. Use 'ls' para listar seu conteúdo.")
        return {
            'name': node.name,
            'path': node.get_full_path(),
            'size': node.size,
            'formatted_size': format_size(node.size),
            'inode_block': node.inode_block,
            'data_blocks': node.data_blocks,
            'content': node.content,
            'created_at': node.created_at,
            'updated_at': node.updated_at
        }

    def update_file(self, path_str: str, new_size_bytes: int, new_content: str = None):
        node = self.resolve_node(path_str)
        if not node:
            raise ValueError(f"Arquivo não encontrado: '{path_str}'")
        if node.is_directory:
            raise ValueError(f"'{path_str}' é um diretório, não um arquivo.")

        full_path = node.get_full_path()
        base_name = node.name

        # Libera alocações anteriores
        self.disk.free_path(full_path)

        # Realoca blocos
        needed_data_blocks = math.ceil(new_size_bytes / self.block_size)
        alloc = self._allocate_blocks(full_path, base_name, new_size_bytes, needed_data_blocks)

        node.size = new_size_bytes
        node.inode_block = alloc['inode_block']
        node.data_blocks = alloc['data_blocks']
        node.updated_at = datetime.now()
        if new_content is not None:
            node.content = new_content
        return node

    def delete(self, path_str: str):
        clean = path_str.strip()
        if clean in ('/', ''):
            raise ValueError("Não é permitido deletar o diretório raiz '/'.")

        node = self.resolve_node(clean)
        if not node:
            raise ValueError(f"Arquivo ou diretório não encontrado: '{clean}'")

        if node == self.current_dir:
            raise ValueError("Não é possível deletar o diretório atual de trabalho. Mude com 'cd ..' primeiro.")

        full_path = node.get_full_path()
        if node.is_directory:
            self._free_dir_recursive(node)
        else:
            self.disk.free_path(full_path)

        del node.parent.children[node.name]
        return True

    def _free_dir_recursive(self, dir_node: FSNode):
        for child in dir_node.children.values():
            if child.is_directory:
                self._free_dir_recursive(child)
            else:
                self.disk.free_path(child.get_full_path())

    # ----------------------------------------------------
    # NAVEGAÇÃO E LISTAGEM
    # ----------------------------------------------------
    def cd(self, path_str: str):
        target = self.resolve_node(path_str)
        if not target:
            raise ValueError(f"Diretório não encontrado: '{path_str}'")
        if not target.is_directory:
            raise ValueError(f"'{path_str}' não é um diretório.")
        self.current_dir = target
        return self.current_dir.get_full_path()

    def pwd(self) -> str:
        return self.current_dir.get_full_path()

    def list_dir(self, path_str: str = ''):
        target = self.resolve_node(path_str) if path_str else self.current_dir
        if not target:
            raise ValueError(f"Caminho não encontrado: '{path_str}'")
        if not target.is_directory:
            return [{'name': target.name, 'is_dir': False, 'size': target.size, 'formatted_size': format_size(target.size)}]

        items = []
        for child in target.children.values():
            items.append({
                'name': child.name,
                'is_dir': child.is_directory,
                'size': child.size,
                'formatted_size': '-' if child.is_directory else format_size(child.size)
            })
        return items

    def get_tree_string(self, start_node: FSNode = None) -> str:
        if start_node is None:
            start_node = self.root

        lines = ["[ÁRVORE DO SISTEMA DE ARQUIVOS]", start_node.get_full_path()]

        def build_tree(node: FSNode, prefix: str = ''):
            if not node.is_directory:
                return
            entries = list(node.children.values())
            for idx, child in enumerate(entries):
                is_last = False if (node == self.root and len(entries) == 1) else (idx == len(entries) - 1)
                connector = "└── " if is_last else "├── "
                child_prefix = "    " if is_last else "│   "

                if child.is_directory:
                    lines.append(f"{prefix}{connector}{child.name}/ [DIR]")
                    build_tree(child, prefix + child_prefix)
                else:
                    lines.append(f"{prefix}{connector}{child.name} ({format_size(child.size)}) [ARQ]")

        build_tree(start_node)
        return "\n".join(lines)

    # ----------------------------------------------------
    # DIAGNÓSTICO DO DISCO E FRAGMENTAÇÃO
    # ----------------------------------------------------
    def get_all_files(self, current_node: FSNode = None, acc = None):
        if acc is None:
            acc = []
        if current_node is None:
            current_node = self.root

        for child in current_node.children.values():
            if child.is_directory:
                self.get_all_files(child, acc)
            else:
                acc.append(child)
        return acc

    def get_disk_status_string(self, details: bool = True) -> str:
        lines = []
        strategy_label = {
            'INDEXED': 'Indexado',
            'CONTIGUOUS': 'Contíguo',
            'LINKED': 'Encadeado (FAT)'
        }.get(self.strategy, self.strategy)

        lines.append(
            f"Tamanho do Bloco de Disco: {format_size(self.block_size)} | "
            f"Total de Blocos: {self.total_blocks} ({format_size(self.disk.total_capacity_bytes)})"
        )
        lines.append("")
        lines.append(f"[MAPA DE ALOCAÇÃO DO DISCO ({strategy_label})]")

        # Agrupa blocos livres consecutivos para visualização idêntica ao enunciado
        i = 0
        while i < self.disk.total_blocks:
            block = self.disk.blocks[i]
            if block.type == 'FREE':
                start_free = i
                while i < self.disk.total_blocks and self.disk.blocks[i].type == 'FREE':
                    i += 1
                end_free = i - 1
                if start_free == end_free:
                    lines.append(f"Bloco {start_free:02d}              : [LIVRE]")
                else:
                    lines.append(f"Bloco {start_free:02d}..{end_free:02d}           : [LIVRE]")
            else:
                block_num = f"{block.id:02d}"
                tag_col = f"{block.tag:<14}"
                lines.append(f"Bloco {block_num} {tag_col}: {block.details}")
                i += 1

        lines.append("")
        lines.append("--- RELATÓRIO DE FRAGMENTAÇÃO ---")

        all_files = self.get_all_files()
        if not all_files:
            lines.append("Nenhum arquivo gravado no sistema.")
            lines.append("Fragmentação Interna             : 0 bytes")
            lines.append("Fragmentação Externa             : 0 bytes")
            lines.append("Necessidade de Compactação       : NÃO (Disco vazio)")
            return "\n".join(lines)

        for file_node in all_files:
            data_blocks_count = len(file_node.data_blocks)
            allocated_bytes = data_blocks_count * self.block_size
            internal_frag = allocated_bytes - file_node.size if allocated_bytes > file_node.size else 0
            last_block_id = file_node.data_blocks[-1] if data_blocks_count > 0 else None

            pct_waste = int(round((internal_frag / self.block_size) * 100)) if internal_frag > 0 else 0
            last_block_str = f" no Bloco {last_block_id:02d}" if last_block_id is not None else ""

            lines.append(f"Tamanho Real do Arquivo '{file_node.name}': {file_node.size} bytes ({format_size(file_node.size)})")
            lines.append(f"Espaço Alocado no Disco          : {allocated_bytes} bytes ({data_blocks_count} blocos de {format_size(self.block_size)})")
            lines.append(f"Fragmentação Interna             : {internal_frag} bytes ({pct_waste}% de desperdício{last_block_str})")

        # Fragmentação Externa
        ext_stats = self.disk.get_external_fragmentation_stats()
        ext_frag_bytes = ext_stats['fragmented_bytes'] if self.strategy == 'CONTIGUOUS' else 0
        lines.append(f"Fragmentação Externa             : {ext_frag_bytes} bytes")

        # Necessidade de compactação
        need_compaction = "NÃO"
        reason = ""
        if self.strategy == 'INDEXED':
            need_compaction = "NÃO"
            reason = " (Blocos alocados via i-node indexado)"
        elif self.strategy == 'LINKED':
            need_compaction = "NÃO"
            reason = " (Alocação encadeada não requer blocos contíguos)"
        elif self.strategy == 'CONTIGUOUS':
            if ext_stats['fragmented_free_blocks'] > 0 and ext_stats['free_segments'] > 1:
                need_compaction = "SIM"
                reason = f" ({ext_stats['fragmented_free_blocks']} blocos livres dispersos. Use o comando 'compact')"
            else:
                need_compaction = "NÃO"
                reason = " (Blocos livres estão contíguos)"

        lines.append(f"Necessidade de Compactação       : {need_compaction}{reason}")
        return "\n".join(lines)

    def compact_disk(self) -> str:
        if self.strategy != 'CONTIGUOUS':
            return "Compactação é aplicável principalmente na alocação CONTÍGUA para eliminar fragmentação externa."

        all_files = self.get_all_files()
        for i in range(self.disk.total_blocks):
            if self.disk.blocks[i].type != 'INODE':
                self.disk.blocks[i].set_free()

        next_block = 0
        while next_block < self.disk.total_blocks and self.disk.blocks[next_block].type == 'INODE':
            next_block += 1

        for f in all_files:
            needed = math.ceil(f.size / self.block_size)
            f.data_blocks = []
            remaining = f.size
            for b in range(needed):
                b_id = next_block
                next_block += 1
                f.data_blocks.append(b_id)
                blk = self.disk.blocks[b_id]
                bytes_in_block = min(self.block_size, remaining)
                remaining -= bytes_in_block

                blk.type = 'DADO'
                blk.tag = '[CONTÍGUO]'
                blk.file_path = f.get_full_path()
                blk.block_index = b + 1
                blk.occupied_bytes = bytes_in_block
                blk.details = f"'{f.get_full_path()}' (Bloco {b + 1} - {bytes_in_block} bytes ocupados)"

        return "Disco compactado com sucesso! Fragmentação externa eliminada."

    def set_strategy(self, strategy_name: str) -> str:
        strat = strategy_name.upper()
        if strat not in ('INDEXED', 'CONTIGUOUS', 'LINKED'):
            raise ValueError("Estratégia inválida. Escolha: INDEXED, CONTIGUOUS, LINKED.")
        self.strategy = strat
        return f"Estratégia física de alocação alterada para: {strat}"

# ==========================================
# INTERFACE DE LINHA DE COMANDO (CLI / REPL)
# ==========================================
def run_demo_scenario(fs: FileSystem):
    print("\n>>> EXECUTANDO CENÁRIO DE DEMONSTRAÇÃO DO ENUNCIADO <<<\n")
    print("> mkdir /sistema")
    fs.mkdir("/sistema")

    print("> mkdir /sistema/logs")
    fs.mkdir("/sistema/logs")

    print("> create /sistema/logs/app.log --size 10KB")
    fs.create_file("/sistema/logs/app.log", 10 * 1024)

    print("\n[Exemplo 1.1 — Exibição da Árvore Hierárquica]:")
    print(fs.get_tree_string())

    print("\n[Exemplo 1.2 — Alocação Indexada e Análise de Fragmentação]:")
    print(fs.get_disk_status_string(True))

def start_cli():
    fs = FileSystem()
    banner = """
======================================================================
  SIMULADOR DE SISTEMA DE ARQUIVOS & ALOCAÇÃO FÍSICA DE BLOCOS
  Sistemas Operacionais - Entrega de Projeto (Python 3)
======================================================================
Comandos Disponíveis:
  mkdir <caminho>                 - Cria diretório (ex: mkdir /sistema/logs)
  create <caminho> --size <tam>   - Cria arquivo (ex: create /sistema/logs/app.log --size 10KB)
  read <caminho>                  - Lê arquivo
  update <caminho> --size <tam>   - Atualiza tamanho de arquivo existente
  rm <caminho>                    - Remove arquivo ou diretório
  cd <caminho>                    - Navega entre diretórios
  pwd                             - Mostra diretório atual
  ls [caminho]                    - Lista diretório
  tree                            - Exibe árvore do sistema
  fs_status [--details]           - Exibe mapa de alocação e relatório de fragmentação
  strategy <indexed|contiguous|linked> - Alterna estratégia física
  compact                         - Compacta o disco
  demo                            - Roda o teste do enunciado
  help                            - Mostra ajuda
  exit                            - Sai do simulador
======================================================================
"""
    print(banner)

    while True:
        try:
            line = input(f"simulador:{fs.pwd()}> ").strip()
            if not line:
                continue

            parts = shlex.split(line)
            cmd = parts[0].lower()
            args = parts[1:]

            if cmd in ('exit', 'quit'):
                print("Encerrando simulador...")
                break

            elif cmd == 'help':
                print("""
Comandos:
  mkdir <caminho>                 : Cria diretório
  create <caminho> --size <tam>   : Cria arquivo (ex: create /sistema/logs/app.log --size 10KB)
  read <caminho> (ou cat)         : Lê metadados e blocos do arquivo
  update <caminho> --size <tam>   : Atualiza tamanho de arquivo
  rm <caminho>                    : Remove arquivo ou pasta
  cd <caminho>                    : Navega pelo sistema de arquivos
  pwd                             : Diretório atual
  ls [caminho]                    : Lista conteúdo
  tree                            : Exibe a hierarquia em árvore
  fs_status [--details]           : Mapa físico do disco e fragmentação
  strategy <tipo>                 : Alterna estratégia (INDEXED, CONTIGUOUS, LINKED)
  compact                         : Elimina fragmentação externa
  demo                            : Executa o cenário do enunciado
  exit                            : Encerra o programa
                """)

            elif cmd == 'mkdir':
                if not args:
                    print("Uso: mkdir <caminho>")
                    continue
                fs.mkdir(args[0])
                print(f"Diretório criado: {args[0]}")

            elif cmd == 'create':
                if not args:
                    print("Uso: create <caminho> --size <tamanho>")
                    continue
                path = args[0]
                size = 0
                i = 1
                while i < len(args):
                    if args[i] == '--size' and i + 1 < len(args):
                        size = parse_size(args[i + 1])
                        i += 1
                    i += 1
                created = fs.create_file(path, size)
                print(f"Arquivo '{created.get_full_path()}' criado com sucesso ({format_size(created.size)}).")

            elif cmd in ('read', 'cat'):
                if not args:
                    print("Uso: read <caminho>")
                    continue
                info = fs.read_file(args[0])
                print(f"--- [ARQUIVO: {info['path']}] ---")
                print(f"Tamanho       : {info['size']} bytes ({info['formatted_size']})")
                if info['inode_block'] is not None:
                    print(f"Bloco Inode   : Bloco {info['inode_block']:02d}")
                blocks_str = ", ".join(f"Bloco {b:02d}" for b in info['data_blocks']) or "Nenhum"
                print(f"Blocos de Dado: {blocks_str}")
                print(f"Conteúdo      : {info['content']}")

            elif cmd == 'update':
                if not args:
                    print("Uso: update <caminho> --size <novo_tamanho>")
                    continue
                path = args[0]
                size = 0
                i = 1
                while i < len(args):
                    if args[i] == '--size' and i + 1 < len(args):
                        size = parse_size(args[i + 1])
                        i += 1
                    i += 1
                fs.update_file(path, size)
                print(f"Arquivo '{path}' atualizado com sucesso para {format_size(size)}.")

            elif cmd in ('rm', 'delete'):
                if not args:
                    print("Uso: rm <caminho>")
                    continue
                fs.delete(args[0])
                print(f"Item '{args[0]}' removido com sucesso.")

            elif cmd == 'cd':
                target = args[0] if args else '/'
                new_p = fs.cd(target)
                print(f"Diretório atual: {new_p}")

            elif cmd == 'pwd':
                print(fs.pwd())

            elif cmd == 'ls':
                target = args[0] if args else ''
                items = fs.list_dir(target)
                if not items:
                    print("(Diretório vazio)")
                else:
                    for it in items:
                        t = '<DIR>' if it['is_dir'] else '<ARQ>'
                        print(f"  {t:<6} {it['name']:<20} {it['formatted_size']}")

            elif cmd == 'tree':
                print(fs.get_tree_string())

            elif cmd in ('fs_status', 'status'):
                print(fs.get_disk_status_string(True))

            elif cmd == 'strategy':
                if not args:
                    print(f"Estratégia atual: {fs.strategy} (Opções: INDEXED, CONTIGUOUS, LINKED)")
                else:
                    print(fs.set_strategy(args[0]))

            elif cmd in ('compact', 'defrag'):
                print(fs.compact_disk())

            elif cmd == 'demo':
                run_demo_scenario(fs)

            else:
                print(f"Comando desconhecido: '{cmd}'. Digite 'help' para ajuda.")

        except Exception as e:
            print(f"[ERRO]: {e}")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('demo', '--demo'):
        fs = FileSystem()
        run_demo_scenario(fs)
    else:
        start_cli()

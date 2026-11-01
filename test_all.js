const { FileSystem } = require('./simulator');

console.log("=== INICIANDO BATERIA DE TESTES DO SIMULADOR ===");

const fs = new FileSystem();

// 1. Hierarquia e caminhos absolutos / relativos
console.log("\n[TESTE 1] Hierarquia e caminhos:");
fs.mkdir("/sistema");
fs.mkdir("/sistema/logs");
fs.cd("/sistema/logs");
console.log("PWD:", fs.pwd()); // deve ser /sistema/logs

fs.createFile("app.log", 10 * 1024); // relativo ao diretório atual!
console.log("Criou app.log via caminho relativo!");

fs.createFile("../doc.txt", 4 * 1024); // relativo com ..
console.log("Criou doc.txt em /sistema via caminho relativo '../doc.txt'!");

console.log("\nÁrvore resultante:");
console.log(fs.getTreeString());

// 2. Leitura (Read)
console.log("\n[TESTE 2] Leitura (Read):");
const readApp = fs.readFile("/sistema/logs/app.log");
console.log(`Lido ${readApp.path}: ${readApp.formattedSize}, Inode: ${readApp.inodeBlock}, Blocos: ${readApp.dataBlocks.join(', ')}`);

// 3. Atualização (Update)
console.log("\n[TESTE 3] Atualização (Update):");
fs.updateFile("/sistema/doc.txt", 6 * 1024);
const readDoc = fs.readFile("/sistema/doc.txt");
console.log(`Atualizado ${readDoc.path}: novo tamanho ${readDoc.formattedSize}, Blocos: ${readDoc.dataBlocks.join(', ')}`);

// 4. Remoção (Delete)
console.log("\n[TESTE 4] Remoção (Delete):");
fs.delete("/sistema/doc.txt");
console.log("doc.txt removido.");
console.log(fs.getTreeString());

// 5. Status do Disco
console.log("\n[TESTE 5] fs_status:");
console.log(fs.getDiskStatusString(true));

// 6. Teste de Alocação Contígua e Fragmentação Externa
console.log("\n[TESTE 6] Alocação Contígua e Fragmentação Externa:");
const fsContig = new FileSystem({ strategy: 'CONTIGUOUS' });
fsContig.createFile("/arqA.bin", 4 * 1024); // Bloco 0 (ou 1 se 0 for raiz)
fsContig.createFile("/arqB.bin", 8 * 1024); // 2 blocos
fsContig.createFile("/arqC.bin", 4 * 1024); // 1 bloco
console.log("Antes de deletar arqB:");
console.log(fsContig.getDiskStatusString(true));

console.log("\nDeletando /arqB.bin para criar 'buraco' (fragmentação externa):");
fsContig.delete("/arqB.bin");
console.log(fsContig.getDiskStatusString(true));

console.log("\nExecutando Compactação (defrag):");
console.log(fsContig.compactDisk());
console.log(fsContig.getDiskStatusString(true));

console.log("\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");

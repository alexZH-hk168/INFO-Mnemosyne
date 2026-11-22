// 生成 docs/contract/fixtures/*.json：npm run fixtures:gen
// 数据源是 src/mocks/fixtures-source.ts；本脚本只负责落盘（先删旧的 *.json，再全部重写）。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from '../src/mocks/fixtures-source';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../docs/contract/fixtures');
mkdirSync(outDir, { recursive: true });

for (const f of readdirSync(outDir)) {
  if (f.endsWith('.json')) rmSync(join(outDir, f));
}

const seen = new Set<string>();
for (const { file, content } of FIXTURES) {
  if (seen.has(file)) throw new Error(`fixture 文件名重复：${file}`);
  seen.add(file);
  writeFileSync(join(outDir, file), `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}
console.log(`已写出 ${FIXTURES.length} 份 fixture → ${outDir}`);

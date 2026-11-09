// Inlines DESCRIPTION.md into the preview template. Run: node devpost/build-preview.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const md = readFileSync(new URL('./DESCRIPTION.md', import.meta.url), 'utf8').replace(/<\/script>/gi, '<\\/script>');
const t = readFileSync(new URL('./preview/template.html', import.meta.url), 'utf8');
writeFileSync(new URL('./preview/index.html', import.meta.url), t.replace('@@MD@@', () => md));

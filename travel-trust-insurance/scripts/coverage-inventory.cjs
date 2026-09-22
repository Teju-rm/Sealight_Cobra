const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const extensions = new Set(['.js', '.cjs', '.mjs']);
const ignored = new Set(['node_modules', 'coverage-artifacts', '.git']);

function sourceFiles(root, directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : sourceFiles(root, absolute);
    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [path.relative(root, absolute).split(path.sep).join('/')] : [];
  });
}
function nameOf(node) { if (!node) return ''; if (node.type === 'Identifier') return node.name; if (node.type === 'Literal') return String(node.value); return node.type === 'MemberExpression' ? `${nameOf(node.object)}.${nameOf(node.property)}` : ''; }
function functionName(node, parent, index) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator') return nameOf(parent.id);
  if (parent?.type === 'AssignmentExpression') return nameOf(parent.left);
  if (parent?.type === 'Property' || parent?.type === 'MethodDefinition') return nameOf(parent.key);
  if (parent?.type === 'CallExpression') return `${nameOf(parent.callee)} callback ${parent.arguments.indexOf(node)}`;
  return `anonymous ${index}`;
}
function inventorySource(file, source) {
  const options = { ecmaVersion: 'latest', locations: true, allowHashBang: true }; let ast;
  try { ast = acorn.parse(source, { ...options, sourceType: 'script' }); } catch { ast = acorn.parse(source, { ...options, sourceType: 'module' }); }
  const found = []; const walk = (node, parent = null) => { if (!node || typeof node !== 'object') return; if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) found.push({ node, parent }); Object.entries(node).forEach(([key, value]) => { if (['start', 'end', 'loc'].includes(key)) return; if (Array.isArray(value)) value.forEach((item) => walk(item, node)); else walk(value, node); }); }; walk(ast);
  return found.map(({ node, parent }, index) => { const name = functionName(node, parent, index); const parameters = node.params.map((p) => source.slice(p.start, p.end).replace(/\s+/g, ' ').trim()); const signature = `${name}(${parameters.join(', ')})`; return { id: `${file}::${signature}`, logicalId: `${file}::${name}`, file, name, signature, start: node.start, end: node.end, line: node.loc.start.line, hash: crypto.createHash('sha256').update(source.slice(node.start, node.end).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16) }; });
}
function createInventory(root) { const files = {}; sourceFiles(root).forEach((file) => { try { files[file] = inventorySource(file, fs.readFileSync(path.join(root, file), 'utf8')); } catch (error) { console.warn(`Skipping ${file}: ${error.message}`); } }); return { schemaVersion: 1, generatedAt: new Date().toISOString(), files }; }
function allFunctions(inventory) { return Object.values(inventory.files || {}).flat(); }
module.exports = { createInventory, inventorySource, allFunctions };

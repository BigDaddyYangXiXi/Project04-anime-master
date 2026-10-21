const fs = require('node:fs');
const path = require('node:path');

// Checks literal relative CommonJS imports without executing application code.
function inspectLocalModules(directory) {
  const issues = [];
  function visit(folder) {
    for (const item of fs.readdirSync(folder,{withFileTypes:true})) {
      if (['node_modules','.git'].includes(item.name) || item.isSymbolicLink()) continue;
      const file = path.join(folder,item.name);
      if (item.isDirectory()) { visit(file); continue; }
      if (!item.name.endsWith('.js') || item.name.endsWith('.test.js') || item.name.startsWith('test-')) continue;
      const source = fs.readFileSync(file,'utf8');
      for (const match of source.matchAll(/\brequire\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
        const target = path.resolve(folder,match[2]);
        const candidates = [target,`${target}.js`,`${target}.json`,path.join(target,'index.js'),path.join(target,'index.json')];
        if (!candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
          issues.push(`${path.relative(directory,file)}: missing local module ${match[2]}`);
        }
      }
    }
  }
  visit(directory);
  return issues;
}
module.exports = { inspectLocalModules };

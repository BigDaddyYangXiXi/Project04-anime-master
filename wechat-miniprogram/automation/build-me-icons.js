const fs = require('node:fs');
const path = require('node:path');
function buildMeIcons() {
  const root = path.resolve(__dirname, '..');
  const tokens = JSON.parse(fs.readFileSync(path.join(root, 'design-system/tokens.json'), 'utf8'));
  const shapes = {
    reviews: ['<path d="M4 4h16v12H9l-5 4Z"/>', '<path d="M8 8h8M8 12h5"/>'],
    help: ['<circle cx="12" cy="12" r="9"/>', '<path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>'],
    settings: ['<path d="M4 6h16M4 12h16M4 18h16"/>', '<circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>'],
    cooperation: ['<rect x="5" y="3" width="14" height="18" rx="2"/>', '<path d="m8 12 3 3 5-6"/>'],
    chevron: ['<path d="m9 5 7 7-7 7"/>', ''],
    orders: ['<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V3h6v1M9 14h6M9 18h3"/>', '<path d="M9 10h6"/>'],
    projects: ['<path d="M3 8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', '<path d="M8 13h8m-8 4h5"/>'],
    storefront: ['<path d="M4 10v10h16V10M3 10l2-6h14l2 6M9 20v-6h6v6"/>', '<path d="M3 10c1 3 4 3 6 0 1 3 5 3 6 0 2 3 5 3 6 0"/>'],
    upload: ['<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 4 4"/>', '<path d="M16 5v6m-3-3h6"/>'],
    preview: ['<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/>', '<circle cx="12" cy="12" r="3"/>'],
    funds: ['<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M4 5V3h14"/>', '<path d="M21 11h-6v4h6"/>'],
    followed: ['<circle cx="10" cy="7" r="4"/><path d="M3 21v-3a7 7 0 0 1 12-5"/>', '<path d="M19 13v8m-4-4h8"/>'],
    liked: ['<path d="M20.4 4.6a5.3 5.3 0 0 0-7.5 0L12 5.5l-.9-.9a5.3 5.3 0 0 0-7.5 7.5L12 20.5l8.4-8.4a5.3 5.3 0 0 0 0-7.5Z"/>', ''],
    referenced: ['<rect x="5" y="3" width="16" height="16" rx="2"/><path d="M17 22H3V7M6 15l4-4 4 4 3-3 3 3"/>', '<circle cx="16" cy="7" r="1"/>'],
    preferences: ['<path d="M4 6h16M4 12h16M4 18h16"/>', '<path d="M8 3v6m8 0v6m-8 0v6"/>']
  };
  const folder = path.join(root, 'miniprogram/assets/me');
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, [outline, accent]] of Object.entries(shapes)) {
    fs.writeFileSync(path.join(folder, name + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${tokens['color-text-secondary']}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${outline}<g stroke="${tokens['color-brand']}">${accent}</g></svg>\n`);
  }
}
if (require.main === module) buildMeIcons();
module.exports = buildMeIcons;

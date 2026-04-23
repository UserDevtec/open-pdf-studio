// NEN 1414 Symbol Library — Dutch standard for safety symbols on technical drawings
// PNG assets bundled in /assets/nen1414/ (converted TIF→PNG)
// Categories by prefix: Tb=Brandbeveiliging, Td=Deuren, Tn=Noodverlichting, Tr=Rook/warmteafvoer, Tv=Ventilatie, Tw=Water/sprinkler

// Import all PNG assets via Vite glob
const pngModules = import.meta.glob('/assets/nen1414/*.png', { eager: true, query: '?url', import: 'default' });

function getAssetUrl(id) {
  const key = `/assets/nen1414/${id}.png`;
  return pngModules[key] || '';
}

// Helper: wrap a raster image URL in an SVG <image> tag for stamp tool compatibility
// Uses absolute URL so it works when the SVG is loaded from a blob: context
function rasterSvg(id) {
  const url = getAssetUrl(id);
  if (!url) return '';
  // Vite inlines PNGs <4KB as data: URIs; larger ones become /assets/*.png paths.
  // blob: context can't resolve relative paths, so only prepend origin for root-relative URLs.
  const absoluteUrl = url.startsWith('/') ? window.location.origin + url : url;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><image href="${absoluteUrl}" width="64" height="64"/></svg>`;
}

// Human-readable names for NEN 1414 symbols
const NAMES = {
  'Tb0.003': 'Brandbeveiligingsinstallatie',
  'Tb01': 'Brandmeldcentrale (BMC)',
  'Tb02': 'Onderdeel BMC',
  'Tb04': 'Brandweeringang',
  'Tb05': 'Brandweerpaneel',
  'Tb1.001': 'Automatische melder',
  'Tb1.002': 'Thermische melder',
  'Tb1.003': 'Rookmelder',
  'Tb1.004': 'Vlammelder',
  'Tb1.004a': 'Vlammelder (alternatief)',
  'Tb1.005': 'Lijnmelder',
  'Tb1.006': 'Aspiratiemeldsysteem',
  'Tb1.007': 'Gasmelder',
  'Tb1.008': 'Multisensormelder',
  'Tb1.009': 'Handmelder',
  'Tb2.001': 'Optische signaalg. (flitslicht)',
  'Tb2.002': 'Akoestische signaalg. (sirene)',
  'Tb2.003': 'Optisch/akoestisch signaal',
  'Tb2.004': 'Spraakinstallatie',
  'Tb2.005': 'Gesproken bericht',
  'Tb2.021': 'Deur/raamcontact',
  'Tb2.022': 'Houdmagneet',
  'Tb2.023': 'Deurdranger',
  'Tb2.041': 'Brandklep',
  'Tb2.042': 'Overdrukklep',
  'Tb2.043': 'Rookklep',
  'Tb4.001': 'Brandslangshaspel',
  'Tb4.002': 'Droge blusleiding',
  'Tb4.003': 'Natte blusleiding',
  'Tb4.021': 'Sprinklerinstallatie',
  'Tb4.022': 'Sprinkler (hangend)',
  'Tb4.023': 'Sprinkler (staand)',
  'Tb4.024': 'Sprinkler (wand)',
  'Tb4.025': 'Sprinkler (vlak)',
  'Tb5.001': 'Blussysteem',
  'Tbk5.001': 'CO2-blusinstallatie',
  'Tbk5.002': 'Schuimblusinstallatie',
  'Tbk5.003': 'Waterblusinstallatie',
  'Tbk5.004': 'Poederblusinstallatie',
  'Tbk7.001': 'Brandbeveiligingsnet',
  'Tbk7.002': 'Brandbestrijdingsnet',
  'Tbk7.003': 'Ringnet',
  'Tbk7.004': 'Verdeelnet',
  'Td01': 'Enkele deur',
  'Td02': 'Dubbele deur',
  'Td03': 'Schuifdeur',
  'Td04': 'Draaihek',
  'Td05': 'Roldeur (boven)',
  'Td06': 'Roldeur (onder)',
  'Td07': 'Kanteldeur',
  'Td08': 'Vouwdeur',
  'Td09': 'Doorgeefluik',
  'Td10': 'Nooddeur',
  'Tn01': 'Noodverlichting armatuur',
  'Tn02': 'Noodverlichting (zelf voorzien)',
  'Tn03': 'Vluchtwegaanduiding',
  'Tn04': 'Transparant verlicht',
  'Tn05': 'Noodverlichting (centraal)',
  'Tn06': 'Anti-paniekverlichting',
  'Tn07': 'Werkplekverlichting',
  'Tn08': 'Veiligheidsverlichting',
  'Tn09': 'Noodvoeding',
  'Tn10': 'Accu-eenheid',
  'Tn11': 'Aggregaat',
  'Tn12': 'UPS',
  'Tr01': 'RWA-installatie',
  'Tr02': 'Rookluik (dak)',
  'Tr03': 'Rookluik (gevel)',
  'Tr04': 'Rookklep (kanaal)',
  'Tr05': 'Rook-/warmteafvoer',
  'Tr06': 'Toevoer buitenlucht',
  'Tr07': 'Overdrukinstallatie',
  'Tr08': 'Bedieningspaneel RWA',
  'Tr09': 'Rookmelder (RWA)',
  'Tr10': 'Thermische melder (RWA)',
  'Tr11': 'Handmelder (RWA)',
  'Tr12': 'Windmelder',
  'Tr501': 'Rook-/warmteafvoer (mech.)',
  'Tr502': 'Ventilator (RWA)',
  'Tr503': 'Toevoerventilator',
  'Tr504': 'Afvoerventilator',
  'Tv017': 'Ventilatiesysteem',
  'Tw01': 'Sprinklerinstallatie (water)',
  'Tw02': 'Sprinklerkop (hangend)',
  'Tw03': 'Sprinklerkop (staand)',
  'Tw04': 'Sprinklerkop (wand)',
  'Tw05': 'Sprinklerkop (vlak)',
  'Tw07': 'Alarmklep',
  'Tw08': 'Terugslagklep',
  'Tw09': 'Afsluiter',
  'Tw10': 'Brandkraan (ondergronds)',
  'Tw11': 'Brandkraan (bovengronds)',
  'Tw12': 'Pompverbinding',
  'Tw14': 'Sprinklercentrale',
  'Tw15': 'Watervoorziening',
  'Tw16': 'Watertank',
  'Tw19': 'Drukverhogingspomp',
  'Tw2.001': 'Watermist (open)',
  'Tw2.002': 'Watermist (gesloten)',
  'Tw20': 'Jockeypump',
  'Tw28': 'Watermotor gong',
};

// Build categories from prefix
const CATEGORY_META = {
  'Tb': { name: 'NEN 1414 — Brandbeveiliging', color: '#dc2626' },
  'Tbk': { name: 'NEN 1414 — Blussystemen', color: '#b91c1c' },
  'Td': { name: 'NEN 1414 — Deuren', color: '#92400e' },
  'Tn': { name: 'NEN 1414 — Noodverlichting', color: '#ca8a04' },
  'Tr': { name: 'NEN 1414 — Rook/Warmteafvoer', color: '#6b7280' },
  'Tv': { name: 'NEN 1414 — Ventilatie', color: '#059669' },
  'Tw': { name: 'NEN 1414 — Water/Sprinkler', color: '#2563eb' },
};

const ALL_IDS = Object.keys(NAMES);

function getPrefix(id) {
  // Tbk before Tb (longer prefix first)
  if (id.startsWith('Tbk')) return 'Tbk';
  if (id.startsWith('Tb')) return 'Tb';
  if (id.startsWith('Td')) return 'Td';
  if (id.startsWith('Tn')) return 'Tn';
  if (id.startsWith('Tr')) return 'Tr';
  if (id.startsWith('Tv')) return 'Tv';
  if (id.startsWith('Tw')) return 'Tw';
  return 'Tb'; // fallback
}

// Build categories
export const NEN1414_CATEGORIES = (() => {
  const catMap = new Map();
  for (const id of ALL_IDS) {
    const prefix = getPrefix(id);
    if (!catMap.has(prefix)) {
      const meta = CATEGORY_META[prefix] || { name: `NEN 1414 — ${prefix}`, color: '#666' };
      catMap.set(prefix, {
        id: `nen1414-${prefix.toLowerCase()}`,
        name: meta.name,
        color: meta.color,
        icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1"/><text x="8" y="11" font-size="7" font-weight="bold" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">N</text></svg>`,
        builtin: true,
        symbols: [],
      });
    }
    catMap.get(prefix).symbols.push({
      id: `nen1414-${id}`,
      name: NAMES[id] || id,
      svg: rasterSvg(id),
    });
  }
  return [...catMap.values()];
})();

// Metro config — extends watchFolders to include sibling `supabase/` dir
// so cross-root re-exports from napkin-app/lib/types/wishlistSource.ts and
// napkin-app/lib/urlValidation.ts resolve at runtime.
//
// Per TICKET-053 [ARCH-REVIEW-H4]: the canonical type union and validator
// live in supabase/functions/_shared/. Without this config Metro's default
// projectRoot=napkin-app/ refuses to bundle files outside its tree, and the
// app crashes on first import of WishlistSource at runtime even though tsc
// passes (TS only checks types, not Metro's bundle graph).

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the supabase/ tree so _shared/* files are part of the bundle graph.
config.watchFolders = [path.resolve(repoRoot, 'supabase')];

// Resolve dependencies from napkin-app/node_modules only — supabase/ has no deps.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

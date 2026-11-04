/* Package dependency direction (R-QA-002): shared <- engine <- payments, voice <- server <- web. */

const PKGS = ['shared', 'engine', 'payments', 'voice', 'server', 'web'];

// Packages each package may import. Everything else under packages/ is forbidden.
const ALLOWED = {
  shared: [],
  engine: ['shared'],
  payments: ['shared', 'engine'],
  voice: ['shared'],
  server: ['shared', 'engine', 'payments', 'voice'],
  web: ['shared', 'voice'],
};

const NODE_IO =
  '^(node:)?(fs|fs/promises|net|http|https|http2|dgram|dns|tls|child_process|cluster|worker_threads|os)$';

const directionRules = PKGS.map((pkg) => {
  const forbidden = PKGS.filter((p) => p !== pkg && !ALLOWED[pkg].includes(p));
  return {
    name: `no-${pkg}-to-forbidden`,
    comment: `${pkg} may only import: ${ALLOWED[pkg].join(', ') || '(no workspace packages)'}`,
    severity: 'error',
    from: { path: `^packages/${pkg}/` },
    to: {
      path: forbidden.flatMap((p) => [`^packages/${p}/`, `node_modules/@gavel/${p}/`]),
    },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...directionRules,
    {
      name: 'engine-no-node-io',
      comment: 'The engine is pure: no filesystem, network, process or OS access (R-QA-002).',
      severity: 'error',
      from: { path: '^packages/engine/src/', pathNot: '^packages/engine/src/(testing|node)/' },
      to: { dependencyTypes: ['core'], path: NODE_IO },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|node_modules)/' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['types', 'main'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};

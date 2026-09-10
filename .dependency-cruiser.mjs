/** レイヤー境界の規則（tech-spec §4.2）。`pnpm depcheck` で検査する */
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'core-is-pure',
      comment:
        'src/simulation と src/dem は、自ディレクトリの外（src 内の他のディレクトリ、外部パッケージ、Node の組み込み）に依存しない',
      severity: 'error',
      from: { path: '^src/(simulation|dem)/', pathNot: '\\.test\\.ts$' },
      to: { pathNot: '^src/$1/' },
    },
    {
      name: 'types-only-from-core',
      comment: 'state・renderer・shared から simulation・dem へは型だけを import する',
      severity: 'error',
      from: { path: '^src/(state|renderer|shared)/' },
      to: { path: '^src/(simulation|dem)/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-react-outside-ui',
      comment: 'renderer と bridge は React・MUI・Emotion に依存しない',
      severity: 'error',
      from: { path: '^src/(renderer|bridge)/' },
      to: { path: 'node_modules/(react|react-dom|@mui/[^/]+|@emotion/[^/]+)/' },
    },
    {
      name: 'workers-not-imported',
      comment:
        'Worker は new Worker(new URL(...), { type: "module" }) でのみ起動し、静的に import しない',
      severity: 'error',
      from: { pathNot: '^src/workers/' },
      to: { path: '^src/workers/' },
    },
    {
      name: 'workers-isolated',
      comment: 'Worker からは simulation・dem・shared 以外の自作モジュールを import しない',
      severity: 'error',
      from: { path: '^src/workers/' },
      to: { path: '^src/', pathNot: '^src/(workers|simulation|dem|shared)/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'どこからも参照されないモジュールを禁止する。エントリポイント、Worker のエントリ（new URL で起動するため依存として辿れない）、テスト、型宣言は除く',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '\\.(test|spec)\\.tsx?$',
          '\\.d\\.ts$',
          '^src/main\\.tsx$',
          '^src/workers/[^/]+\\.worker\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // import type を区別する（types-only-from-core に必要。tech-spec §4.2）
    tsPreCompilationDeps: 'specify',
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
    },
  },
}

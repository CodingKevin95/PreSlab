/*
  Catches what the build cannot.

  Bundling resolves imports but never checks that a name exists in scope, so a
  refactor that leaves a helper behind still builds green and then throws at
  render. That is not hypothetical: extracting CostBasis from BacklogTable left
  verdictOf behind and blanked the whole app, and `npm run build` reported
  success. no-undef is the rule that would have caught it.

  Kept deliberately small. Every rule here fires on code that is broken or
  half-finished, not code written in a style someone dislikes, so a warning is
  always worth reading rather than something to tune out.
*/
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: '18.2' } },
  plugins: ['react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react/recommended'],
  rules: {
    /*
      The new JSX transform means React need not be in scope, and components
      are not "unused" just because only JSX references them.
    */
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',

    // Prop types are not used in this codebase; the shapes come from psa.js.
    'react/prop-types': 'off',

    // Escaped entities in copy are noise, and the text here is deliberate.
    'react/no-unescaped-entities': 'off',

    /*
      The other half of a bad refactor. An import nothing uses, or a variable
      left behind when logic moved, means something was only partly finished.
      Args are exempt so a handler can name what it ignores.
    */
    'no-unused-vars': ['error', {
      args: 'none',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],

    // Hooks in a condition or loop attach state to the wrong render. Baffling
    // to debug and always a mistake.
    'react-hooks/rules-of-hooks': 'error',

    // An effect reading a value it does not list is the usual cause of "why is
    // this showing the old number". A warning rather than an error: the fix is
    // sometimes deliberate.
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      // The serverless relay and the snapshot builder run on Node, not in a
      // browser, so process and console come from somewhere else entirely.
      files: ['api/**/*.js', 'scripts/**/*.mjs', 'vite.config.js', 'server/**/*.js'],
      env: { node: true, browser: false },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    {
      files: ['.eslintrc.cjs'],
      env: { node: true, browser: false },
      parserOptions: { sourceType: 'script' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', 'public/data'],
}

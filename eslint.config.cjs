const js = require("@eslint/js");

const sharedGlobals = {
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  Math: "readonly",
  JSON: "readonly",
  Date: "readonly",
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "public/obj/**",
      "server.log",
    ],
  },
  js.configs.recommended,
  {
    files: ["server.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...sharedGlobals,
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        global: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...sharedGlobals,
        Blob: "readonly",
        DeviceOrientationEvent: "readonly",
        document: "readonly",
        Element: "readonly",
        fetch: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        screen: "readonly",
        window: "readonly",
        WebSocket: "readonly",
      },
    },
  },
];

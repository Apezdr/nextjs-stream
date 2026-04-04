const js = require("@eslint/js");
const nextConfig = require("eslint-config-next");
const globals = require("globals");

module.exports = [
    {
        ignores: [
            "**/node_modules/**",
            "**/.next/**",
            "**/out/**",
            "**/dist/**",
            "src/pages/chromecast/receiver.js"
        ]
    },
    js.configs.recommended,
    ...nextConfig,
    {
        // Add TypeScript specific rules here if needed, e.g.:
        // files: ["**/*.ts", "**/*.tsx"],
        // rules: {
        //     "@typescript-eslint/no-empty-function": "warn",
        // },
        files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
            },
        },
        rules: {
            "no-unused-vars": "off",
            "no-undef": "off",
            "react/react-in-jsx-scope": "off",
            "react/prop-types": "off",
            "react/no-unescaped-entities": "off",
        },
    }
];
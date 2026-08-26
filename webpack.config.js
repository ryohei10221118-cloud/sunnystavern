import { resolve as _resolve } from 'path';
import TerserPlugin from 'terser-webpack-plugin';
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin';

const serverConfig = {
    // 發行版不附 source map：原本會產生 94 個 .map 共 42MB，
    // 而瀏覽器在 DevTools 開啟時會去下載它們，嚴重影響量測與除錯體驗。
    devtool: false,
    target: 'browserslist',
    entry: './src/index.ts',
    output: {
        path: _resolve('.', 'dist'),
        filename: 'index.js',
        libraryTarget: 'module',
        libraryExport: 'default',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            sourceMaps: true,
                        },
                    },
                ],
                exclude: /node_modules/,
            },
            {
                test: /\.js/,
                exclude: /node_modules/,
                options: {
                    cacheDirectory: true,
                    presets: [
                        ['@babel/preset-env', { 'modules': false }],
                    ],
                    sourceMaps: true,
                },
                loader: 'babel-loader',
            },
            {
                test: /\.css$/,
                oneOf: [
                    {
                        include: /node_modules[\\/]monaco-editor/,
                        use: ['style-loader', 'css-loader'],
                    },
                    {
                        exclude: /node_modules[\\/]monaco-editor/,
                        use: [
                            'style-loader',
                            {
                                loader: 'css-loader',
                                options: {
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    },
    experiments: {
        outputModule: true,
    },
    optimization: {
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
            }),
        ],
    },
    plugins: [
        new MonacoWebpackPlugin({
            languages: ['javascript'],
        }),
    ],
    externals: function ({ context, request }, callback) {
        if (request.includes('node_modules') || context.includes('node_modules')) {
            return callback();
        }
        if (request.startsWith('../../') || request.includes('libs/')) {
            if (context.search(/(\/|\\)src\1/) > 0)
                return callback(null, request.substring(3));
            return callback(null, request);
        } else if (request.startsWith('https://') || request.startsWith('http://')) {
            return callback(null, request);
        }
        callback();
    },
};

export default [serverConfig];

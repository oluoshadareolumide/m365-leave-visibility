/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const isDev = process.env.NODE_ENV !== 'production';
const ADDIN_URL = process.env.ADDIN_URL || 'https://localhost:3000';
const API_BASE_URL = process.env.API_BASE_URL || 'https://localhost:3001';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || 'common';

module.exports = {
  mode: isDev ? 'development' : 'production',
  devtool: isDev ? 'source-map' : false,

  entry: {
    taskpane: ['./src/taskpane/taskpane.ts'],
    commands: ['./src/commands/commands.ts'],
  },

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]/[name].js',
    clean: true,
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },

  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      filename: 'taskpane/taskpane.html',
      template: './src/taskpane/index.html',
      chunks: ['taskpane'],
    }),
    new HtmlWebpackPlugin({
      filename: 'commands/commands.html',
      template: './src/commands/commands.html',
      chunks: ['commands'],
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'assets', to: 'assets', noErrorOnMissing: true },
      ],
    }),
    // Inject build-time constants into the bundle
    {
      apply(compiler) {
        const webpack = require('webpack');
        new webpack.DefinePlugin({
          __CLIENT_ID__: JSON.stringify(AZURE_CLIENT_ID),
          __TENANT_ID__: JSON.stringify(AZURE_TENANT_ID),
          __ADDIN_URL__: JSON.stringify(ADDIN_URL),
          __API_BASE_URL__: JSON.stringify(API_BASE_URL),
        }).apply(compiler);
      },
    },
  ],

  devServer: {
    port: 3000,
    server: {
      type: 'https',
      options: (() => {
        try {
          const devCerts = require('office-addin-dev-certs');
          return devCerts.getHttpsServerOptions();
        } catch {
          return {};
        }
      })(),
    },
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    hot: true,
  },
};

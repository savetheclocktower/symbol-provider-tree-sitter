
const TreeSitterProvider = require('./tree-sitter-provider');

module.exports = {
  activate () {
    console.log('activate symbol-provider-tree-sitter');
    this.provider = new TreeSitterProvider();
  },

  deactivate () {
    console.log('deactivate symbol-provider-tree-sitter', this.provider);
    this.provider?.destroy?.();
  },

  provideSymbols () {
    console.log('provideSymbols symbol-provider-tree-sitter', this.provider);
    return this.provider;
  }
};

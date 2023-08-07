const CaptureOrganizer = require('./capture-organizer');

class TreeSitterProvider {
  constructor () {
    this.packageName = 'symbol-provider-tree-sitter';
    this.name = 'Tree-sitter';
    this.isExclusive = true;
    this.captureOrganizer = new CaptureOrganizer();
  }

  destroy () {
    this.captureOrganizer.destroy();
  }

  canProvideSymbols (meta) {
    let { editor, type } = meta;

    // This provider can't crawl the whole project.
    if (type === 'project' || type === 'project-find') return false;

    // This provider works only for editors with Tree-sitter grammars.
    let languageMode = editor?.getBuffer()?.getLanguageMode();
    if (!languageMode?.atTransactionEnd) {
      return false;
    }

    // This provider needs at least one layer to have a tags query.
    let layers = languageMode.getAllLanguageLayers(l => !!l.tagsQuery);
    if (layers.length === 0) {
      return false;
    }

    return true;
  }

  async getSymbols (meta) {
    let { editor, signal } = meta;
    let languageMode = editor?.getBuffer()?.getLanguageMode();
    if (!languageMode) return null;

    let scopeResolver = languageMode?.rootLanguageLayer?.scopeResolver;
    if (!scopeResolver) return null;

    let results = [];

    // Wait for the buffer to be at rest so we know we're capturing against
    // clean trees.
    await languageMode.atTransactionEnd();

    // The symbols-view package might've cancelled us in the interim.
    if (signal.aborted) return null;

    let layers = languageMode.getAllLanguageLayers(l => !!l.tagsQuery);
    if (layers.length === 0) return null;

    for (let layer of layers) {
      let extent = layer.getExtent();

      let captures = layer.tagsQuery.captures(
        layer.tree.rootNode,
        extent.start,
        extent.end
      );

      results.push(
        ...this.captureOrganizer.process(captures, scopeResolver)
      );
    }
    return results;
  }
}

module.exports = TreeSitterProvider;

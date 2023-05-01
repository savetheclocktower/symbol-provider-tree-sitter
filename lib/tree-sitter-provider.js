const { Point } = require('atom');

function pointFromNodePosition (position) {
  return Point.fromObject(position, true);
}

class TreeSitterProvider {

  constructor () {
    this.patternCache = new Map();
  }

  destroy() {
    this.patternCache.clear();
  }

  getPackageName () {
    return 'symbol-provider-tree-sitter';
  }

  getName () {
    return 'Tree-sitter';
  }

  canProvideSymbols (meta) {
    let { editor, type } = meta;
    // This provider can't crawl the whole project.
    if (type === 'project') return false;

    // This provider works only for editors with Tree-sitter grammars.
    let languageMode = editor?.getBuffer()?.getLanguageMode();
    if (!languageMode?.atTransactionEnd) return false;

    // This provider needs at least one layer to have a tags query.
    let layers = languageMode.getAllLanguageLayers(l => !!l.tagsQuery);
    if (layers.length === 0) return false;

    return true;
  }

  getOrCompilePattern(pattern) {
    let regex = this.patternCache.get(pattern);
    if (!regex) {
      regex = new RegExp(pattern, 'g');
      this.patternCache.set(pattern, regex);
    }
    return regex;
  }

  getCaptureName (capture) {
    let { node, setProperties: props = {} } = capture;
    let base = node.text;
    console.log('props:', props);
    if (props['symbols.prepend']) {
      base = `${props['symbols.prepend']}${base}`;
    }
    if (props['symbols.append']) {
      base = `${base}${props['symbols.append']}`;
    }
    if (props['symbols.strip']) {
      let pattern = this.getOrCompilePattern(props['symbols.strip']);
      base = base.replace(pattern, '');
    }
    // TODO: Regex-based replacement?
    return base;
  }

  interpretCaptures (captures) {
    let results = [];

    for (let capture of captures) {
      let { name, node, setProperties: props } = capture;
      // For now we just care about nodes called `name`. We don't have any of
      // the features that rely on other captures — for instance, being able to
      // mark `Foo` as a class or `bar` as a method, or to associate a symbol
      // with its docstring. We may feel compelled to add that stuff when LSP
      // providers are added.
      if (name === 'name') {
        results.push({
          position: pointFromNodePosition(node.startPosition),
          name: this.getCaptureName(capture)
        });
      }
    }
    return results;
  }

  async getSymbols (meta) {
    let { editor, signal } = meta;
    let languageMode = editor?.getBuffer()?.getLanguageMode();
    if (!languageMode) return null;

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

      results.push(...this.interpretCaptures(captures));
    }
    return results;
  }
}

module.exports = TreeSitterProvider;

const { Point } = require('atom');

function pointFromNodePosition (position) {
  return Point.fromObject(position, true);
}

function resolveNodeDescriptor (node, descriptor) {
  let parts = descriptor.split('.');
  let result = node;
  while (result !== null && parts.length > 0) {
    let part = parts.shift();
    if (!result[part]) { return null; }
    result = result[part];
  }
  return result;
}

class TreeSitterProvider {

  constructor () {
    this.patternCache = new Map();
    this.packageName = 'symbol-provider-tree-sitter';
    this.name = 'Tree-sitter';
    this.isExclusive = true;
    this.nameCache = new Map();
  }

  destroy () {
    this.patternCache.clear();
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

  getOrCompilePattern (pattern) {
    let regex = this.patternCache.get(pattern);
    if (!regex) {
      regex = new RegExp(pattern, 'g');
      this.patternCache.set(pattern, regex);
    }
    return regex;
  }

  getSymbolNameForNode (node) {
    return this.nameCache.get(node.id);
  }

  resolvePrefixForCapture (capture) {
    let { node, setProperties: props = {} } = capture;
    let symbolDescriptor = props['symbol.prependSymbolForNode'];
    let textDescriptor = props['symbol.prependTextForNode'];

    // Prepending with a symbol name requires that we already have determined
    // the name for another node, which means the other node must have a
    // corresponding symbol. But it allows for recursion.
    if (symbolDescriptor) {
      let other = resolveNodeDescriptor(node, symbolDescriptor);
      if (other) {
        let symbolName = this.getSymbolNameForNode(other);
        if (symbolName) return symbolName;
      }
    }

    // A simpler option is to prepend with a node's text. This works on any
    // arbitrary node, even nodes that don't have their own symbol names.
    if (textDescriptor) {
      let other = resolveNodeDescriptor(node, textDescriptor);
      if (other) {
        return other.text;
      }
    }
  }

  resolveSymbolNameForCapture (capture) {
    let { node, setProperties: props = {} } = capture;
    let base = node.text;

    if (props['symbol.strip']) {
      let pattern = this.getOrCompilePattern(props['symbol.strip']);
      base = base.replace(pattern, '');
    }

    // TODO: Regex-based replacement?
    if (props['symbol.prepend']) {
      base = `${props['symbol.prepend']}${base}`;
    }
    if (props['symbol.append']) {
      base = `${base}${props['symbol.append']}`;
    }

    let prefix = this.resolvePrefixForCapture(capture);
    if (prefix) {
      let joiner = props['symbol.joiner'] ?? '';
      base = `${prefix}${joiner}${base}`;
    }

    this.nameCache.set(node.id, base);
    return base;
  }

  interpretCaptures (captures, scopeResolver) {
    scopeResolver.reset();
    let results = [];

    for (let capture of captures) {
      let { name, node } = capture;
      // For now we just care about nodes called `name`. We don't have any of
      // the features that rely on other captures — for instance, being able to
      // mark `Foo` as a class or `bar` as a method, or to associate a symbol
      // with its docstring. We may feel compelled to add that stuff when LSP
      // providers are added.
      if (name === 'name') {
        if (!scopeResolver.store(capture)) continue;

        results.push({
          position: pointFromNodePosition(node.startPosition),
          name: this.resolveSymbolNameForCapture(capture)
        });
      }
    }
    scopeResolver.reset();
    return results;
  }

  async getSymbols (meta) {
    let { editor, signal } = meta;
    let languageMode = editor?.getBuffer()?.getLanguageMode();
    if (!languageMode) return null;

    let scopeResolver = languageMode.rootLanguageLayer.scopeResolver;
    this.nameCache.clear();

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

      results.push(...this.interpretCaptures(captures, scopeResolver));
    }
    return results;
  }
}

module.exports = TreeSitterProvider;

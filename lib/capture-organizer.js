const { Point } = require('atom');

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

const PatternCache = {
  getOrCompile (pattern) {
    this.patternCache ??= new Map();
    let regex = this.patternCache.get(pattern);
    if (!regex) {
      regex = new RegExp(pattern, 'g');
      this.patternCache.set(pattern, regex);
    }
    return regex;
  },

  clear () {
    this.patternCache?.clear();
  },
};

/**
 * A container capture. When another capture's node is contained by the
 * definition capture's node, it gets added to this instance.
 */
class Container {
  constructor (capture, organizer) {
    this.captureFields = new Map();
    this.captureFields.set(capture.name, capture);
    this.capture = capture;
    this.node = capture.node;
    this.organizer = organizer;

    this.tag = capture.name.substring(capture.name.indexOf('.') + 1);
    this.position = capture.node.range.start;
  }

  getCapture (name) {
    return this.captureFields.get(name);
  }

  add (capture) {
    if (this.captureFields.has(capture.name)) {
      console.warn(`Name already exists:`, capture.name);
    }
    // Any captures added to this definition need to be checked to make sure
    // their nodes are actually descendants of this definition's node.
    if (!this.node.range.containsRange(capture.node.range)) {
      return false;
    }
    this.captureFields.set(capture.name, capture);
    if (capture.name === 'name') {
      this.nameCapture = new Name(capture, this.organizer);
    }
    return true;
  }

  isValid () {
    return (
      this.nameCapture &&
      this.position instanceof Point
    );
  }

  toSymbol () {
    if (!this.nameCapture) return null;
    let nameSymbol = this.nameCapture.toSymbol();
    let symbol = {
      name: nameSymbol.name,
      tag: nameSymbol.tag ?? this.tag,
      position: this.position
    };

    if (nameSymbol.context) {
      symbol.context = nameSymbol.context;
    }

    return symbol;
  }
}

class Definition extends Container {
  constructor (...args) {
    super(...args);
    this.type = 'definition';
  }
}

class Reference extends Container {
  constructor (...args) {
    super(...args);
    this.type = 'reference';
  }
}

class Name {
  constructor (capture, organizer) {
    this.type = 'name';
    this.organizer = organizer;
    this.props = capture.setProperties ?? {};
    this.capture = capture;
    this.node = capture.node;
    this.position = capture.node.range.start,
    this.name = this.resolveName(capture);
    this.context = this.resolveContext(capture);
    this.tag = this.resolveTag(capture);
  }

  getSymbolNameForNode (node) {
    return this.organizer.nameCache.get(node.id);
  }

  resolveName (capture) {
    let { node, props } = this;
    let base = node.text;
    if (props['symbol.strip']) {
      let pattern = PatternCache.getOrCompile(props['symbol.strip']);
      base = base.replace(pattern, '');
    }

    // TODO: Regex-based replacement?
    if (props['symbol.prepend']) {
      base = `${props['symbol.prepend']}${base}`;
    }
    if (props['symbol.append']) {
      base = `${base}${props['symbol.append']}`;
    }

    let prefix = this.resolvePrefix(capture);
    if (prefix) {
      let joiner = props['symbol.joiner'] ?? '';
      base = `${prefix}${joiner}${base}`;
    }
    this.organizer.nameCache.set(node.id, base);
    return base;
  }

  resolveContext () {
    let { node, props } = this;
    let result = null;
    if (props['symbol.contextNode']) {
      let contextNode = resolveNodeDescriptor(node, props['symbol.contextNode']);
      if (contextNode) {
        result = contextNode.text;
      }
    }

    if (props['symbol.context']) {
      result = props['symbol.context'];
    }

    return result;
  }

  resolvePrefix () {
    let { node, props } = this;
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

    return null;
  }

  resolveTag () {
    return this.props['symbol.tag'] ?? null;
  }

  toSymbol () {
    let { name, position, context, tag } = this;
    let symbol = { name, position };
    if (tag) symbol.tag = tag;
    if (context) symbol.context = context;

    return symbol;
  }

}

/**
 * Keeps track of @definition.* captures and the captures they may contain.
 */
class CaptureOrganizer {
  clear () {
    this.nameCache ??= new Map();
    this.nameCache.clear();
    this.activeContainer = null;

    this.definitions = [];
    this.references = [];
    this.names = [];
    this.extraCaptures = [];
  }

  destroy () {
    PatternCache.clear();
    this.clear();
  }

  isDefinition (capture) {
    return capture.name.startsWith('definition.');
  }

  isReference (capture) {
    return capture.name.startsWith('reference.');
  }

  isName (capture) {
    return capture.name === 'name';
  }

  finish (activeContainer) {
    if (!activeContainer) return;
    if (activeContainer instanceof Definition) {
      this.definitions.push(activeContainer);
    } else if (activeContainer instanceof Reference) {
      this.references.push(activeContainer);
    }
  }

  process (captures, scopeResolver) {
    scopeResolver.reset();

    this.clear();
    let activeContainer = null;
    for (let capture of captures) {
      if (!scopeResolver.store(capture)) continue;

      if (this.isDefinition(capture)) {
        this.finish(activeContainer);
        activeContainer = new Definition(capture, this);
      } else if (this.isReference(capture)) {
        this.finish(activeContainer);
        activeContainer = new Reference(capture, this);
      } else if (this.isName(capture)) {
        // See if this @name capture belongs with the most recent @definition
        // capture.
        if (activeContainer?.add(capture)) continue;
        this.names.push(new Name(capture, this));
      } else {
        if (activeContainer?.add(capture)) {
          continue;
        } else {
          this.extraCaptures.push(capture);
        }
      }
    }
    this.finish(activeContainer);

    let symbols = [];
    for (let definition of this.definitions) {
      if (!definition.isValid()) continue;
      symbols.push(definition.toSymbol());
    }

    if (atom.config.get('symbol-provider-tree-sitter.includeReferences')) {
      for (let reference of this.references) {
        if (!reference.isValid()) continue;
        symbols.push(reference.toSymbol());
      }
    }

    for (let name of this.names) {
      symbols.push(name.toSymbol());
    }

    scopeResolver.reset();

    return symbols;
  }
}

module.exports = CaptureOrganizer;
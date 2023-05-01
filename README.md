# symbol-provider-tree-sitter package

A symbol provider for tree-sitter grammars.

Used with the [symbols-view-plus package](https://github.com/savetheclocktower/symbols-view-plus), which will eventually be folded into [Pulsar’s existing symbols-view package](https://github.com/pulsar-edit/symbols-view).

Tree-sitter grammars [with tags queries](https://tree-sitter.github.io/tree-sitter/code-navigation-systems) can very easily give us a list of all the symbols in a file without the drawbacks of a `ctags`-based approach. For instance, they operate on the contents of the buffer, not the contents of the file on disk, so they work just fine in brand-new files and in files that have been modified since the last save.

This provider does not currently support project-wide symbol search, but possibly could do so in the future.

## Tags queries

This provider expects for a grammar to have specified a tags query in its grammar definition file. All the built-in Tree-sitter grammars will have such a file. If you’re using a third-party Tree-sitter grammar that hasn’t defined one, file an issue on Pulsar and we’ll see what we can do.

If you’re writing your own grammar, or contributing a `tags.scm` to a grammar without one, keep reading.

### Query syntax

The query syntax starts as a subset of what is described [on this page](https://tree-sitter.github.io/tree-sitter/code-navigation-systems). At present, this package cares only about captures named `@name`, and the `web-tree-sitter` bindings used by Pulsar will silently ignore predicates like `#select-adjacent!`.

To match the current behavior of the `symbols-view` package, you can usually take a `queries/tags.scm` file from a Tree-sitter repository — many parsers define them — and paste it straight into your grammar’s `tags.scm` file. Then you’d remove any captures that have to do with _references_, since `symbols-view` doesn’t care about those. The result would be very similar to what the `ctags` provider would give you, but faster and with better accuracy.

#### Advanced features

The text of the captured node is what will be displayed as the symbol, but a few predicates are available to alter that text.

```scm
(class_declaration
  name: (identifier) @name
  (#set! symbol.prepend "Class: "))
```

The `symbol.prepend` predicate adds a string to the beginning of a symbol name. For a class `Foo` in JavaScript, this predicate would result in a symbol called `Class: Foo`.

```scm
(class_declaration
  name: (identifier) @name
  (#set! symbol.append " (class)"))
```

The `symbol.append` predicate adds a string to the end of a symbol name. For a class `Foo`, this predicate would result in a symbol called `Foo (class)`.


```scm
(class_declaration
  name: (identifier) @name
  (#set! symbol.strip "^\\s+|\\s+$"))
```

The `symbol.strip` predicate will replace everything matched by the regular expression with an empty string. The pattern given is compiled into a JavaScript `RegExp` with an implied `g` (global) flag.

In this example, _if_ the `identifier` node included whitespace on either side of the symbol, this would be one way to remove that.

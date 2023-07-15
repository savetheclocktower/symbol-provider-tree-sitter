
const path = require('path');
const fs = require('fs-plus');
const temp = require('temp');
const TreeSitterProvider = require('../lib/tree-sitter-provider');

// Just for syntax highlighting.
function scm (strings) {
  return strings.join('');
}

function getEditor () {
  return atom.workspace.getActiveTextEditor();
}

async function wait (ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getProjectSymbols (provider, editor) {
  let symbols = await provider.getSymbols({
    type: 'project',
    editor,
    paths: atom.project.getPaths()
  });
  return symbols;
}

async function findDeclarationInProject (provider, editor) {
  let symbols = await provider.getSymbols({
    type: 'project-find',
    editor,
    paths: atom.project.getPaths(),
    word: editor.getWordUnderCursor()
  });
  return symbols;
}

let provider;

async function getSymbols (editor, type = 'file') {
  let controller = new AbortController();
  let symbols = await provider.getSymbols({
    type,
    editor,
    signal: controller.signal
  });

  return symbols;
}

describe('TreeSitterProvider', () => {
  let directory, editor;

  beforeEach(async () => {
    jasmine.unspy(global, 'setTimeout');
    jasmine.unspy(Date, 'now');

    atom.config.set('core.useTreeSitterParsers', true);
    atom.config.set('core.useExperimentalModernTreeSitter', true);
    await atom.packages.activatePackage('language-javascript');

    provider = new TreeSitterProvider();

    atom.project.setPaths([
      temp.mkdirSync('other-dir-'),
      temp.mkdirSync('atom-symbols-view-')
    ]);

    directory = atom.project.getDirectories()[1];
    fs.copySync(
      path.join(__dirname, 'fixtures', 'js'),
      atom.project.getPaths()[1]
    );
  });

  describe('when a tree-sitter grammar is used for a file', () => {
    beforeEach(async () => {
      await atom.workspace.open(directory.resolve('sample.js'));
      editor = getEditor();
      let languageMode = editor.getBuffer().getLanguageMode();
      await languageMode.ready;
    });

    it('provides all JavaScript functions', async () => {
      let symbols = await getSymbols(editor, 'file');

      expect(symbols[0].name).toBe('quicksort');
      expect(symbols[0].position.row).toEqual(0);

      expect(symbols[1].name).toBe('sort');
      expect(symbols[1].position.row).toEqual(1);
    });
  });

  describe('when the buffer is new and unsaved', () => {
    let grammar;
    beforeEach(async () => {
      await atom.workspace.open();
      editor = getEditor();
      grammar = atom.grammars.grammarForId('source.js');
      editor.setGrammar(grammar);
      await editor.getBuffer().getLanguageMode().ready;
    });

    it('is willing to provide symbols', () => {
      let meta = { type: 'file', editor };
      expect(provider.canProvideSymbols(meta)).toBe(true);
    });

    describe('and has content', () => {
      beforeEach(async () => {
        let text = fs.readFileSync(
          path.join(__dirname, 'fixtures', 'js', 'sample.js')
        );
        editor.setText(text);
        await editor.getBuffer().getLanguageMode().atTransactionEnd();
      });

      it('provides symbols just as if the file were saved on disk', async () => {
        let symbols = await getSymbols(editor, 'file');

        expect(symbols[0].name).toBe('quicksort');
        expect(symbols[0].position.row).toEqual(0);

        expect(symbols[1].name).toBe('sort');
        expect(symbols[1].position.row).toEqual(1);
      });
    });
  });

  describe('when the tags query uses predicate', () => {
    let grammar;
    beforeEach(async () => {
      await atom.workspace.open(directory.resolve('sample.js'));
      editor = getEditor();
      let languageMode = editor.getBuffer().getLanguageMode();
      await languageMode.ready;
      grammar = editor.getGrammar();
    });

    describe('symbol.strip', () => {
      beforeEach(async () => {
        await grammar.setQueryForTest('tagsQuery', scm`
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
                (#set! symbol.strip "ort$")
          )
        `);
      });
      it('strips the given text from each symbol', async () => {
        let symbols = await getSymbols(editor, 'file');

        expect(symbols[0].name).toBe('quicks');
        expect(symbols[0].position.row).toEqual(0);

        expect(symbols[1].name).toBe('s');
        expect(symbols[1].position.row).toEqual(1);
      });
    });

    describe('symbol.prepend', () => {
      beforeEach(async () => {
        await grammar.setQueryForTest('tagsQuery', scm`
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
                (#set! symbol.prepend "Foo: ")
          )
        `);
      });
      it('prepends the given text to each symbol', async () => {
        let symbols = await getSymbols(editor, 'file');

        expect(symbols[0].name).toBe('Foo: quicksort');
        expect(symbols[0].position.row).toEqual(0);

        expect(symbols[1].name).toBe('Foo: sort');
        expect(symbols[1].position.row).toEqual(1);
      });
    });

    describe('symbol.append', () => {
      beforeEach(async () => {
        await grammar.setQueryForTest('tagsQuery', scm`
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
                (#set! symbol.append " (foo)")
          )

        `);
      });
      it('appends the given text to each symbol', async () => {
        let symbols = await getSymbols(editor, 'file');

        expect(symbols[0].name).toBe('quicksort (foo)');
        expect(symbols[0].position.row).toEqual(0);

        expect(symbols[1].name).toBe('sort (foo)');
        expect(symbols[1].position.row).toEqual(1);
      });
    });

    describe('symbol.prependTextForNode', () => {
      beforeEach(async () => {
        await grammar.setQueryForTest('tagsQuery', scm`
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
                (#set! test.onlyIfDescendantOfType function)
                (#set! symbol.prependTextForNode "parent.parent.parent.parent.parent.firstNamedChild")
                (#set! symbol.joiner ".")
                (#set! test.final true)
          )
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
          )
        `);
      });
      it(`prepends the associated node's text to each symbol`, async () => {
        let symbols = await getSymbols(editor, 'file');

        expect(symbols[0].name).toBe('quicksort');
        expect(symbols[0].position.row).toEqual(0);

        expect(symbols[1].name).toBe('quicksort.sort');
        expect(symbols[1].position.row).toEqual(1);
      });
    });

    describe('symbol.prependSymbolForNode', () => {
      beforeEach(async () => {
        await grammar.setQueryForTest('tagsQuery', scm`
          ; Outer function has prepended text...
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
                (#set! test.onlyIfNotDescendantOfType function)
                (#set! symbol.prepend "ROOT: ")
                (#set! test.final true)
          )
          ; …which the inner function picks up on.
          (
            (variable_declaration
              (variable_declarator
                name: (identifier) @name
                value: [(arrow_function) (function)]))
                (#set! test.onlyIfDescendantOfType function)
                (#set! symbol.prependSymbolForNode "parent.parent.parent.parent.parent.firstNamedChild")
                (#set! symbol.joiner ".")
                (#set! test.final true)
          )
        `);
      });
      it(`prepends the associated node's symbol name to each symbol`, async () => {
        let symbols = await getSymbols(editor, 'file');

        expect(symbols[0].name).toBe('ROOT: quicksort');
        expect(symbols[0].position.row).toEqual(0);

        expect(symbols[1].name).toBe('ROOT: quicksort.sort');
        expect(symbols[1].position.row).toEqual(1);
      });
    });

  });
});

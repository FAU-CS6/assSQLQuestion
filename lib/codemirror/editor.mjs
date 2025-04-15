import {sql} from "@codemirror/lang-sql"
import {defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching,
        foldGutter, foldKeymap} from "@codemirror/language"
import {EditorState, Compartment} from "@codemirror/state"
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands"
import {searchKeymap, highlightSelectionMatches} from "@codemirror/search"
import {EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine, dropCursor,
        rectangularSelection, crosshairCursor,
        lineNumbers, highlightActiveLineGutter} from "@codemirror/view"

// As promoted in the codemirror docs, this is taken from https://github.com/codemirror/basic-setup
const editorSetup = (() => [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    /*closeBrackets(),
    autocompletion(),*/
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
        //...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        //...completionKeymap,
        //...lintKeymap,
        indentWithTab,  // this line is added
    ])
])();

class CodeMirrorAdapter {

  constructor(codeMirrorView, readOnlyCompartment) {
    this.codeMirrorView = codeMirrorView;
    this.readOnlyCompartment = readOnlyCompartment;
  }

  getValue() {
    return this.codeMirrorView.state.doc.toString();
  }

  setReadOnly(value) {
    this.codeMirrorView.dispatch({
      effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(value))
    })
  }

}

// This is also from the docs: https://codemirror.net/docs/migration/#codemirror.fromtextarea
function editorFromTextArea(textarea, onChange, isReadOnly) {
  let readOnlyCompartment = new Compartment();
  let extensions = [
    editorSetup,
    sql(),
    EditorView.updateListener.of(function(e) {
      onChange
    }),
    readOnlyCompartment.of(EditorState.readOnly.of(isReadOnly)),
  ];
  let view = new EditorView({
    doc: textarea.value,
    extensions: extensions
  })
  textarea.parentNode.insertBefore(view.dom, textarea)
  textarea.style.display = "none"
  if (textarea.form) textarea.form.addEventListener("submit", () => {
    textarea.value = view.state.doc.toString()
  })
  // do not submit the form on Enter -- as it is the default behavior for textareas, too
  view.dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  });
  return new CodeMirrorAdapter(view, readOnlyCompartment);
}

export { CodeMirrorAdapter, editorFromTextArea };

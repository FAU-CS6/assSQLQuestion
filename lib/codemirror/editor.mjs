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

/**
 * A class to instantiate objects from that are made available to <script> code in plugin HTML.
 * The deeper sense is that from <script> (the so-called "global environment"), no modules are `import`able, which is
 * needed (see above). So, do not wonder why the method signatures seem quite arbitrary -- their only sense is to glue
 * modules together with the <script> code and thus the signatures directly derive from what's needed there.
 */
class CodeMirrorAdapter {

  constructor(codeMirrorView, readOnlyCompartment, textarea) {
    this.codeMirrorView = codeMirrorView;
    this.readOnlyCompartment = readOnlyCompartment;
    this.textarea = textarea;
  }

  getValue() {
    return this.codeMirrorView.state.doc.toString();
  }

  transferValueToTextarea() {
    this.textarea.value = this.getValue();
  }

  setReadOnly(value) {
    this.codeMirrorView.dispatch({
      effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(value))
    })
  }

}

// This is also from the docs: https://codemirror.net/docs/migration/#codemirror.fromtextarea
// Creating a CodeMirror instance from a textarea is quite a workaround and seems to be a hack to restore the old
// CodeMirror 5 behavior, but in fact the textarea is needed to transfer the code entered to the PHP backend. (HTML
// <form>)
function editorFromTextArea(textarea, onChange, isReadOnly) {
  // Compartments allow parts of the editor setup to be changed dynamically, we use it to make the editor readonly
  // while an execution takes place. For dynamic configuration see https://codemirror.net/examples/config/
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

  // Transfer the contents of the editor to the hidden textarea in order to submit the code via an HTML <form>.
  // In case the textarea is not part of a <form>, the execute button, too, transfers the content (see method
  // transferValueToTextarea() above.)
  if (textarea.form) textarea.form.addEventListener("submit", () => {
    textarea.value = view.state.doc.toString()
  })

  // do not submit the form on Enter -- as it is the default behavior for textareas, too
  view.dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  });

  return new CodeMirrorAdapter(view, readOnlyCompartment, textarea);
}

export { CodeMirrorAdapter, editorFromTextArea };

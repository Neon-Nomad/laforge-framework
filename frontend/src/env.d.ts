declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  export default class MonacoEditorWorker extends Worker {
    constructor();
  }
}

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  export default class TsWorker extends Worker {
    constructor();
  }
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  export default class JsonWorker extends Worker {
    constructor();
  }
}

declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  export default class HtmlWorker extends Worker {
    constructor();
  }
}

declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  export default class CssWorker extends Worker {
    constructor();
  }
}

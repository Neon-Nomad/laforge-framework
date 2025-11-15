import '../monacoEnvironment';
import React, { useRef, useEffect } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

interface MonacoEditorProps {
  code: string;
  language?: string;
  readOnly?: boolean;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onChange?: (value: string) => void;
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  code,
  language = 'typescript',
  readOnly = false,
  onMount,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create editor
    const editor = monaco.editor.create(containerRef.current, {
      value: code,
      language,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: 'on',
      readOnly,
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      folding: true,
      renderWhitespace: 'selection',
    });

    editorRef.current = editor;

    // Call onMount callback
    if (onMount) {
      onMount(editor);
    }

    // Setup onChange listener
    if (onChange && !readOnly) {
      const disposable = editor.onDidChangeModelContent(() => {
        onChange(editor.getValue());
      });

      return () => {
        disposable.dispose();
        editor.dispose();
      };
    }

    return () => {
      editor.dispose();
    };
  }, []);

  // Update editor value when code prop changes
  useEffect(() => {
    if (editorRef.current && readOnly) {
      const currentValue = editorRef.current.getValue();
      if (currentValue !== code) {
        editorRef.current.setValue(code);
      }
    }
  }, [code, readOnly]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
};

export default MonacoEditor;

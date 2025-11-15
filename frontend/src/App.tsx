import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Container,
  Paper,
  Tab,
  Tabs,
  Button,
  Typography,
  Alert,
  Card,
  CardContent,
  Grid,
  TextField,
  MenuItem,
  Divider,
  Chip,
  Stack,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CodeIcon from '@mui/icons-material/Code';

import MonacoEditor from './components/MonacoEditor';
import type { CompilationOutput } from './compiler/types';
import RuntimeSimulation from './components/RuntimeSimulation';

// Dark theme configuration
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#2f81f7',
    },
    secondary: {
      main: '#238636',
    },
    background: {
      default: '#0d1117',
      paper: '#161b22',
    },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    code: {
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
    },
  },
});

const DEFAULT_DSL = `model User {
  id: uuid pk
  tenantId: uuid tenant
  email: string
  role: string default "user"
  createdAt: datetime default "now()"
}

model Post {
  id: uuid pk
  tenantId: uuid tenant
  title: string
  content: text
  authorId: uuid
  published: boolean default "false"
  createdAt: datetime default "now()"
}

policy User.read {
  ({ user, record }) => record.id === user.id || user.role === 'admin'
}

policy User.update {
  ({ user, record }) => record.id === user.id
}

policy Post.create {
  ({ user }) => true
}

policy Post.read {
  ({ user, record }) => record.published || record.authorId === user.id || user.role === 'admin'
}

policy Post.update {
  ({ user, record }) => record.authorId === user.id
}

policy Post.delete {
  ({ user, record }) => record.authorId === user.id || user.role === 'admin'
}

hook Post.beforeCreate {
  (data) => {
    if (!data.published) {
      return { published: false };
    }
  }
}`;

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`output-tabpanel-${index}`}
      aria-labelledby={`output-tab-${index}`}
      {...other}
      style={{ height: '100%' }}
    >
      {value === index && <Box sx={{ p: 0, height: '100%' }}>{children}</Box>}
    </div>
  );
}

function App() {
  const [dslCode, setDslCode] = useState(DEFAULT_DSL);
  const [compilationResult, setCompilationResult] = useState<CompilationOutput | null>(null);
  const [compilationError, setCompilationError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  
  const editorRef = useRef<any>(null);

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleCompile = async () => {
    setIsCompiling(true);
    setCompilationError(null);
    
    try {
      const code = editorRef.current?.getValue() || dslCode;
      
      // Call REAL LaForge backend for compilation
      const response = await fetch('http://localhost:3001/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dsl: code }),
      });

      const result = await response.json();

      if (result.success) {
        setCompilationResult(result.output);
        setDslCode(code);
        console.log('✅ LaForge compilation successful!', result.output);
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      setCompilationError(error.message || 'Compilation failed');
      setCompilationResult(null);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
        {/* Header */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, py: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" spacing={2}>
              <CodeIcon sx={{ fontSize: 32, color: 'primary.main' }} />
              <Typography variant="h5" component="h1" fontWeight="bold">
                🔥 LaForge Sandbox Dashboard
              </Typography>
              <Chip label="v1.0" size="small" color="primary" variant="outlined" />
            </Stack>
            <Button
              variant="contained"
              color="secondary"
              startIcon={<PlayArrowIcon />}
              onClick={handleCompile}
              disabled={isCompiling}
              size="large"
            >
              {isCompiling ? 'Compiling...' : 'Compile DSL'}
            </Button>
          </Stack>
        </Box>

        {/* Main Content */}
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left Panel - Editor */}
          <Box sx={{ width: '50%', display: 'flex', flexDirection: 'column', borderRight: 1, borderColor: 'divider' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
              <Typography variant="h6" gutterBottom>
                Forge DSL Editor
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Define your models, policies, and hooks
              </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              <MonacoEditor
                code={dslCode}
                language="typescript"
                onMount={handleEditorMount}
              />
            </Box>
          </Box>

          {/* Right Panel - Output */}
          <Box sx={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
            <Paper sx={{ borderRadius: 0, borderBottom: 1, borderColor: 'divider' }} elevation={0}>
              <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
                <Tab label="AST" />
                <Tab label="SQL Schema" />
                <Tab label="RLS Policies" />
                <Tab label="Domain Services" />
                <Tab label="API Routes" />
                <Tab label="Runtime" />
              </Tabs>
            </Paper>
            
            <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              {compilationError ? (
                <Box sx={{ p: 3 }}>
                  <Alert severity="error">
                    <Typography variant="h6" gutterBottom>
                      Compilation Error
                    </Typography>
                    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                      {compilationError}
                    </Typography>
                  </Alert>
                </Box>
              ) : !compilationResult ? (
                <Box sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  height: '100%',
                  color: 'text.secondary'
                }}>
                  <Typography variant="body1">
                    Click "Compile DSL" to see generated artifacts
                  </Typography>
                </Box>
              ) : (
                <>
                  <TabPanel value={activeTab} index={0}>
                    <MonacoEditor
                      code={compilationResult.ast}
                      language="json"
                      readOnly
                    />
                  </TabPanel>
                  <TabPanel value={activeTab} index={1}>
                    <MonacoEditor
                      code={compilationResult.sql}
                      language="sql"
                      readOnly
                    />
                  </TabPanel>
                  <TabPanel value={activeTab} index={2}>
                    <MonacoEditor
                      code={compilationResult.rls}
                      language="sql"
                      readOnly
                    />
                  </TabPanel>
                  <TabPanel value={activeTab} index={3}>
                    <MonacoEditor
                      code={compilationResult.domain}
                      language="typescript"
                      readOnly
                    />
                  </TabPanel>
                  <TabPanel value={activeTab} index={4}>
                    <MonacoEditor
                      code={compilationResult.routes}
                      language="typescript"
                      readOnly
                    />
                  </TabPanel>
                  <TabPanel value={activeTab} index={5}>
                    <RuntimeSimulation compilationResult={compilationResult} />
                  </TabPanel>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Typography,
  Paper,
  Stack,
  Alert,
  Chip,
  Card,
  CardContent,
  Divider,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { v4 as uuidv4 } from 'uuid';
import type { CompilationOutput, ModelDefinition, Policy } from '../compiler/types';

interface RuntimeSimulationProps {
  compilationResult: CompilationOutput;
}

interface SimulatedUser {
  id: string;
  tenantId: string;
  role: string;
}

interface Record {
  [key: string]: any;
}

interface DatabaseState {
  [modelName: string]: Record[];
}

interface AuditLog {
  timestamp: string;
  operation: string;
  model: string;
  recordId?: string;
  success: boolean;
  message: string;
  user: SimulatedUser;
}

const RuntimeSimulation: React.FC<RuntimeSimulationProps> = ({ compilationResult }) => {
  const [database, setDatabase] = useState<DatabaseState>({});
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [operation, setOperation] = useState<'create' | 'read' | 'update' | 'delete'>('create');
  const [formData, setFormData] = useState<Record>({});
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [currentUser, setCurrentUser] = useState<SimulatedUser>({
    id: 'user-123',
    tenantId: 'tenant-abc',
    role: 'user',
  });

  const models = compilationResult.models;

  // Initialize database state for all models
  useEffect(() => {
    const initialDb: DatabaseState = {};
    models.forEach(model => {
      initialDb[model.name] = [];
    });
    setDatabase(initialDb);
    
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].name);
    }
  }, [models]);

  const addAuditLog = (log: Omit<AuditLog, 'timestamp' | 'user'>) => {
    const newLog: AuditLog = {
      ...log,
      timestamp: new Date().toISOString(),
      user: { ...currentUser },
    };
    setAuditLogs(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
  };

  const evaluatePolicy = (model: ModelDefinition, action: string, record?: Record): boolean => {
    const policy = model.policies[action];
    if (!policy) {
      // No policy means allow by default
      return true;
    }

    try {
      // Parse and evaluate the policy handler
      const handlerSource = policy.handlerSource.trim();
      const funcBody = handlerSource.replace(/^\(.*?\)\s*=>\s*/, '');
      
      // Create a safe evaluation context
      const context = {
        user: currentUser,
        record: record || {},
      };

      // Simple evaluation (in production, you'd use a proper sandbox)
      const func = new Function('ctx', `
        const { user, record } = ctx;
        return ${funcBody};
      `);

      return func(context);
    } catch (error: any) {
      console.error('Policy evaluation error:', error);
      addAuditLog({
        operation: action.toUpperCase(),
        model: model.name,
        success: false,
        message: `Policy evaluation failed: ${error.message}`,
      });
      return false;
    }
  };

  const executeHooks = (model: ModelDefinition, hookType: string, data: Record): Record => {
    const hooks = model.hooks.filter(h => h.type === hookType);
    let result = { ...data };

    for (const hook of hooks) {
      try {
        const funcBody = hook.handlerSource.trim().replace(/^\(.*?\)\s*=>\s*/, '');
        const func = new Function('data', `return ${funcBody};`);
        const hookResult = func(result);
        if (hookResult) {
          result = { ...result, ...hookResult };
        }
      } catch (error: any) {
        console.error('Hook execution error:', error);
        addAuditLog({
          operation: hookType.toUpperCase(),
          model: model.name,
          success: false,
          message: `Hook execution failed: ${error.message}`,
        });
      }
    }

    return result;
  };

  const handleCreate = async () => {
    const model = models.find(m => m.name === selectedModel);
    if (!model) return;

    try {
      // Call REAL LaForge backend
      const response = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelName: selectedModel,
          operation: 'create',
          user: currentUser,
          data: formData,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Add record to local state for display
        setDatabase(prev => ({
          ...prev,
          [selectedModel]: [...prev[selectedModel], result.data],
        }));

        addAuditLog({
          operation: 'CREATE',
          model: selectedModel,
          recordId: result.data.id,
          success: true,
          message: `✅ REAL BACKEND: Created ${selectedModel} with ID: ${result.data.id}`,
        });

        // Add backend audit logs
        if (result.auditLog) {
          result.auditLog.forEach((log: any) => {
            addAuditLog({
              operation: log.operation?.toUpperCase() || 'AUDIT',
              model: selectedModel,
              success: true,
              message: `Backend: ${JSON.stringify(log)}`,
            });
          });
        }

        setFormData({});
      } else {
        addAuditLog({
          operation: 'CREATE',
          model: selectedModel,
          success: false,
          message: `❌ ${result.error} (${result.errorType})`,
        });
      }
    } catch (error: any) {
      addAuditLog({
        operation: 'CREATE',
        model: selectedModel,
        success: false,
        message: `❌ Network error: ${error.message}`,
      });
    }
  };

  const handleUpdate = () => {
    const model = models.find(m => m.name === selectedModel);
    if (!model || !selectedRecordId) return;

    const recordIndex = database[selectedModel].findIndex(r => r.id === selectedRecordId);
    if (recordIndex === -1) {
      addAuditLog({
        operation: 'UPDATE',
        model: selectedModel,
        recordId: selectedRecordId,
        success: false,
        message: 'Record not found',
      });
      return;
    }

    const record = database[selectedModel][recordIndex];

    // Check update policy
    if (!evaluatePolicy(model, 'update', record)) {
      addAuditLog({
        operation: 'UPDATE',
        model: selectedModel,
        recordId: selectedRecordId,
        success: false,
        message: 'Policy denied: User does not have permission to update this record',
      });
      return;
    }

    // Execute beforeUpdate hooks
    let updatedData = executeHooks(model, 'beforeUpdate', { ...record, ...formData });

    // Update record
    const updatedRecords = [...database[selectedModel]];
    updatedRecords[recordIndex] = {
      ...record,
      ...formData,
      updatedAt: new Date().toISOString(),
    };

    setDatabase(prev => ({
      ...prev,
      [selectedModel]: updatedRecords,
    }));

    // Execute afterUpdate hooks
    executeHooks(model, 'afterUpdate', updatedRecords[recordIndex]);

    addAuditLog({
      operation: 'UPDATE',
      model: selectedModel,
      recordId: selectedRecordId,
      success: true,
      message: `Updated ${selectedModel} with ID: ${selectedRecordId}`,
    });

    setFormData({});
    setSelectedRecordId('');
  };

  const handleDelete = (recordId: string) => {
    const model = models.find(m => m.name === selectedModel);
    if (!model) return;

    const record = database[selectedModel].find(r => r.id === recordId);
    if (!record) {
      addAuditLog({
        operation: 'DELETE',
        model: selectedModel,
        recordId,
        success: false,
        message: 'Record not found',
      });
      return;
    }

    // Check delete policy
    if (!evaluatePolicy(model, 'delete', record)) {
      addAuditLog({
        operation: 'DELETE',
        model: selectedModel,
        recordId,
        success: false,
        message: 'Policy denied: User does not have permission to delete this record',
      });
      return;
    }

    // Execute beforeDelete hooks
    executeHooks(model, 'beforeDelete', record);

    // Delete record
    setDatabase(prev => ({
      ...prev,
      [selectedModel]: prev[selectedModel].filter(r => r.id !== recordId),
    }));

    // Execute afterDelete hooks
    executeHooks(model, 'afterDelete', record);

    addAuditLog({
      operation: 'DELETE',
      model: selectedModel,
      recordId,
      success: true,
      message: `Deleted ${selectedModel} with ID: ${recordId}`,
    });
  };

  const handleRead = () => {
    const model = models.find(m => m.name === selectedModel);
    if (!model) return;

    // Filter records based on read policy
    const records = database[selectedModel];
    const allowedRecords = records.filter(record => evaluatePolicy(model, 'read', record));

    addAuditLog({
      operation: 'READ',
      model: selectedModel,
      success: true,
      message: `Read ${allowedRecords.length} of ${records.length} ${selectedModel} records (${records.length - allowedRecords.length} filtered by policy)`,
    });
  };

  const currentModel = models.find(m => m.name === selectedModel);
  const currentModelRecords = database[selectedModel] || [];
  const filteredRecords = currentModel 
    ? currentModelRecords.filter(record => evaluatePolicy(currentModel, 'read', record))
    : [];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* User Context Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1}>
            <Chip label={`User: ${currentUser.id}`} size="small" variant="outlined" />
            <Chip label={`Tenant: ${currentUser.tenantId}`} size="small" variant="outlined" />
            <Chip label={`Role: ${currentUser.role}`} size="small" color="primary" />
          </Stack>
          <TextField
            select
            size="small"
            value={currentUser.role}
            onChange={(e) => setCurrentUser({ ...currentUser, role: e.target.value })}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="user">User</MenuItem>
            <MenuItem value="admin">Admin</MenuItem>
          </TextField>
        </Stack>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left Panel - Operations */}
        <Box sx={{ width: '50%', p: 2, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
          <Typography variant="h6" gutterBottom>
            CRUD Operations
          </Typography>

          <Stack spacing={2}>
            <TextField
              select
              label="Model"
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setFormData({});
                setSelectedRecordId('');
              }}
              fullWidth
            >
              {models.map(model => (
                <MenuItem key={model.name} value={model.name}>
                  {model.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Operation"
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value as any);
                setFormData({});
                setSelectedRecordId('');
              }}
              fullWidth
            >
              <MenuItem value="create">Create</MenuItem>
              <MenuItem value="read">Read</MenuItem>
              <MenuItem value="update">Update</MenuItem>
              <MenuItem value="delete">Delete</MenuItem>
            </TextField>

            {operation === 'update' && (
              <TextField
                select
                label="Select Record to Update"
                value={selectedRecordId}
                onChange={(e) => {
                  const recordId = e.target.value;
                  setSelectedRecordId(recordId);
                  const record = currentModelRecords.find(r => r.id === recordId);
                  if (record) {
                    setFormData({ ...record });
                  }
                }}
                fullWidth
              >
                {filteredRecords.map(record => (
                  <MenuItem key={record.id} value={record.id}>
                    {record.id} - {JSON.stringify(record).substring(0, 50)}...
                  </MenuItem>
                ))}
              </TextField>
            )}

            {(operation === 'create' || operation === 'update') && currentModel && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Field Values
                </Typography>
                <Stack spacing={1.5}>
                  {Object.entries(currentModel.schema)
                    .filter(([name]) => !['id', 'tenantId', 'createdAt', 'updatedAt'].includes(name))
                    .map(([fieldName, fieldOptions]) => (
                      <TextField
                        key={fieldName}
                        label={fieldName}
                        value={formData[fieldName] || ''}
                        onChange={(e) => setFormData({ ...formData, [fieldName]: e.target.value })}
                        fullWidth
                        size="small"
                        placeholder={fieldOptions.type}
                      />
                    ))}
                </Stack>
              </Paper>
            )}

            {operation === 'create' && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate} fullWidth>
                Create {selectedModel}
              </Button>
            )}

            {operation === 'update' && (
              <Button 
                variant="contained" 
                startIcon={<EditIcon />} 
                onClick={handleUpdate} 
                disabled={!selectedRecordId}
                fullWidth
              >
                Update {selectedModel}
              </Button>
            )}

            {operation === 'read' && (
              <Button variant="contained" onClick={handleRead} fullWidth>
                Read {selectedModel} Records
              </Button>
            )}

            {/* Display Records */}
            {selectedModel && (
              <Box>
                <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                  Records ({filteredRecords.length} visible of {currentModelRecords.length} total)
                </Typography>
                <Stack spacing={1}>
                  {filteredRecords.map(record => (
                    <Card key={record.id} variant="outlined">
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              ID: {record.id}
                            </Typography>
                            <Typography variant="body2" component="pre" sx={{ 
                              fontSize: '0.75rem', 
                              whiteSpace: 'pre-wrap', 
                              wordBreak: 'break-word',
                              mt: 0.5 
                            }}>
                              {JSON.stringify(record, null, 2)}
                            </Typography>
                          </Box>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDelete(record.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                  {filteredRecords.length === 0 && (
                    <Alert severity="info">No records found</Alert>
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        </Box>

        {/* Right Panel - Audit Logs */}
        <Box sx={{ width: '50%', p: 2, overflowY: 'auto' }}>
          <Typography variant="h6" gutterBottom>
            Audit Log
          </Typography>
          <Stack spacing={1}>
            {auditLogs.map((log, index) => (
              <Accordion key={index} sx={{ bgcolor: 'background.default' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                    <Chip 
                      label={log.operation} 
                      size="small" 
                      color={log.success ? 'success' : 'error'}
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                    />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {log.model}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={0.5}>
                    <Typography variant="body2">{log.message}</Typography>
                    {log.recordId && (
                      <Typography variant="caption" color="text.secondary">
                        Record ID: {log.recordId}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      User: {log.user.id} (Role: {log.user.role})
                    </Typography>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
            {auditLogs.length === 0 && (
              <Alert severity="info">No operations performed yet</Alert>
            )}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default RuntimeSimulation;

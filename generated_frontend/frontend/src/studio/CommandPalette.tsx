import React, { useEffect, useMemo, useState } from 'react';
import { getCommandsForProfile, OperatorCommand } from './commands/registry';

interface CommandPaletteProps {
  profileId: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (routeId: string) => void;
}

interface CommandStatus {
  type: 'success' | 'error';
  message: string;
}

export function CommandPalette({ profileId, isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CommandStatus | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const commands = useMemo(() => getCommandsForProfile(profileId), [profileId]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setStatus(null);
      setRunningId(null);
    }
  }, [isOpen]);

  const filtered = commands.filter(cmd => {
    if (!query) return true;
    const lowered = query.toLowerCase();
    return cmd.label.toLowerCase().includes(lowered) || (cmd.description?.toLowerCase().includes(lowered) ?? false);
  });

  const runCommand = async (command: OperatorCommand) => {
    if (command.route) {
      onNavigate(command.route);
      onClose();
      return;
    }
    if (!command.run) {
      return;
    }
    setRunningId(command.id);
    setStatus(null);
    try {
      await command.run();
      setStatus({ type: 'success', message: `${command.label} complete.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed';
      setStatus({ type: 'error', message });
    } finally {
      setRunningId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        style={{
          width: 'min(520px, 90vw)',
          borderRadius: '14px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: '#0b1022',
          padding: '12px',
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a command"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
          }}
        />
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
          {filtered.length ? (
            filtered.map(command => (
              <button
                key={command.id}
                onClick={() => {
                  void runCommand(command);
                }}
                style={{
                  textAlign: 'left',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.03)',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
                data-testid={`command-${command.id}`}
                disabled={runningId === command.id}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{command.label}</div>
                  {command.hotkey && <div style={{ fontSize: '12px', color: '#9ca3af' }}>{command.hotkey}</div>}
                </div>
                <div style={{ color: '#9ca3af', fontSize: '13px' }}>{command.description || command.category}</div>
              </button>
            ))
          ) : (
            <div style={{ color: '#9ca3af', fontSize: '13px' }}>No commands match “{query}”.</div>
          )}
        </div>
        {status && (
          <div
            role="status"
            aria-live="assertive"
            style={{
              marginTop: '12px',
              borderRadius: '8px',
              padding: '8px 10px',
              background: status.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color: status.type === 'success' ? '#10b981' : '#f87171',
            }}
          >
            {status.message}
          </div>
        )}
      </div>
    </div>
  );
}

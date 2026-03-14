/**
 * AgentSwarmChat.tsx
 *
 * Componente React completo para visualizar el Agent Swarm de Kimi K2.5.
 * Inspirado en la interfaz de Kimi.com — diseño oscuro, progreso dinámico de agentes.
 *
 * Uso:
 *   <AgentSwarmChat apiBase="http://100.64.0.1:8081" apiKey="no-key" />
 *
 * Dependencias: React 18+, no requiere librerías externas (CSS-in-JS inline).
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  duration?: number;
  error?: string;
}

interface SwarmState {
  active: boolean;
  totalAgents: number;
  agents: Agent[];
  synthesizing: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  swarm?: SwarmState;
  timestamp: Date;
  isStreaming?: boolean;
}

interface AgentSwarmChatProps {
  apiBase?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

// ─── Agent Progress Parsers ─────────────────────────────────────────────────

const PATTERNS = {
  swarmStart: /AGENT SWARM.*?[Ll]aunching (\d+) agents?/,
  agentLaunch: /`(\d+)\/(\d+)`\s+\*\*(\w+)\*\*\s*[—\-]\s*(.+?)(?:\.\.\.|$)/gm,
  agentCompleted: /`(\d+)\/(\d+)`\s+\*\*(\w+)\*\*\s+completed\s*\(([0-9.]+)s\)/,
  agentFailed: /`(\d+)\/(\d+)`\s+\*\*(\w+)\*\*\s+failed:\s*(.+)/,
  allCompleted: /All (\d+) agents? completed/,
  synthesizing: /[Ss]ynthesiz/,
  webSearch: /Searching:\s*(.+)/,
};

function parseAgentChunk(text: string, currentSwarm: SwarmState): SwarmState {
  const swarm = { ...currentSwarm, agents: [...currentSwarm.agents] };

  // Detect swarm start
  const startMatch = text.match(PATTERNS.swarmStart);
  if (startMatch) {
    swarm.active = true;
    swarm.totalAgents = parseInt(startMatch[1]);
  }

  // Detect agent launches
  let launchMatch;
  const launchRegex = /`(\d+)\/(\d+)`\s+\*\*(\w+)\*\*\s*[—\-]\s*(.+?)(?:\.\.\.|\\n|$)/g;
  while ((launchMatch = launchRegex.exec(text)) !== null) {
    const [, , , name, task] = launchMatch;
    if (!swarm.agents.find(a => a.name === name)) {
      swarm.agents.push({
        id: `agent-${name}`,
        name,
        task: task.trim(),
        status: 'running',
      });
    }
  }

  // Detect agent completion
  const completedMatch = text.match(PATTERNS.agentCompleted);
  if (completedMatch) {
    const [, , , name, duration] = completedMatch;
    const agent = swarm.agents.find(a => a.name === name);
    if (agent) {
      agent.status = 'completed';
      agent.duration = parseFloat(duration);
    }
  }

  // Detect agent failure
  const failedMatch = text.match(PATTERNS.agentFailed);
  if (failedMatch) {
    const [, , , name, error] = failedMatch;
    const agent = swarm.agents.find(a => a.name === name);
    if (agent) {
      agent.status = 'failed';
      agent.error = error.trim();
    }
  }

  // Detect all completed
  if (PATTERNS.allCompleted.test(text)) {
    swarm.agents.forEach(a => {
      if (a.status === 'running') a.status = 'completed';
    });
  }

  // Detect synthesizing
  if (PATTERNS.synthesizing.test(text)) {
    swarm.synthesizing = true;
  }

  return swarm;
}

function isAgentProgressChunk(text: string): boolean {
  return (
    text.includes('AGENT SWARM') ||
    (text.includes('`') && text.includes('**') && (text.includes('completed') || text.includes('failed'))) ||
    text.includes('All ') && text.includes('agents completed') ||
    text.includes('Synthesizing') ||
    text.includes('Searching:')
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#0a0a0f',
    color: '#e4e4e7',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'linear-gradient(180deg, rgba(15,15,25,1) 0%, rgba(10,10,15,1) 100%)',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: 600,
    background: 'linear-gradient(135deg, #a78bfa, #818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  headerBadge: {
    fontSize: '11px',
    padding: '3px 10px',
    borderRadius: '12px',
    background: 'rgba(139, 92, 246, 0.15)',
    color: '#a78bfa',
    border: '1px solid rgba(139, 92, 246, 0.25)',
    fontWeight: 500,
  },
  messagesArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '24px',
    scrollBehavior: 'smooth' as const,
  },
  messageRow: {
    display: 'flex',
    marginBottom: '24px',
    maxWidth: '860px',
    margin: '0 auto 24px',
    width: '100%',
  },
  userMessage: {
    marginLeft: 'auto',
    maxWidth: '70%',
  },
  userBubble: {
    padding: '12px 18px',
    borderRadius: '18px 18px 4px 18px',
    background: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
    color: '#fff',
    fontSize: '14px',
    lineHeight: '1.6',
    boxShadow: '0 2px 12px rgba(109, 40, 217, 0.3)',
  },
  assistantMessage: {
    display: 'flex',
    gap: '12px',
    maxWidth: '100%',
    width: '100%',
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #818cf8, #6d28d9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    flexShrink: 0,
    boxShadow: '0 2px 8px rgba(129, 140, 248, 0.3)',
  },
  assistantContent: {
    flex: 1,
    minWidth: 0,
  },
  responseText: {
    fontSize: '14px',
    lineHeight: '1.75',
    color: '#d4d4d8',
  },

  // ── Reasoning panel ──
  reasoningToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#71717a',
    cursor: 'pointer',
    padding: '6px 12px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    marginBottom: '12px',
    transition: 'all 0.2s',
  },
  reasoningPanel: {
    fontSize: '12px',
    lineHeight: '1.6',
    color: '#71717a',
    padding: '12px 16px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.02)',
    borderLeft: '2px solid rgba(139, 92, 246, 0.3)',
    marginBottom: '12px',
    maxHeight: '200px',
    overflowY: 'auto' as const,
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    whiteSpace: 'pre-wrap' as const,
  },

  // ── Agent Swarm Panel ──
  swarmContainer: {
    background: 'linear-gradient(135deg, rgba(15,15,30,0.95), rgba(20,10,35,0.95))',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: '16px',
    padding: '20px',
    marginBottom: '16px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
  },
  swarmHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
  },
  swarmTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#a78bfa',
  },
  swarmCount: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '10px',
    background: 'rgba(139, 92, 246, 0.2)',
    color: '#c4b5fd',
  },
  agentCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    marginBottom: '8px',
    transition: 'all 0.3s ease',
  },
  agentCardCompleted: {
    borderColor: 'rgba(52, 211, 153, 0.3)',
    background: 'rgba(52, 211, 153, 0.05)',
  },
  agentCardFailed: {
    borderColor: 'rgba(248, 113, 113, 0.3)',
    background: 'rgba(248, 113, 113, 0.05)',
  },
  agentStatusIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    flexShrink: 0,
  },
  agentRunning: {
    background: 'rgba(139, 92, 246, 0.15)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
  },
  agentDone: {
    background: 'rgba(52, 211, 153, 0.15)',
    border: '1px solid rgba(52, 211, 153, 0.3)',
  },
  agentError: {
    background: 'rgba(248, 113, 113, 0.15)',
    border: '1px solid rgba(248, 113, 113, 0.3)',
  },
  agentInfo: {
    flex: 1,
    minWidth: 0,
  },
  agentName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e4e4e7',
    marginBottom: '2px',
  },
  agentTask: {
    fontSize: '12px',
    color: '#71717a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  agentDuration: {
    fontSize: '11px',
    color: '#52d39a',
    fontFamily: '"JetBrains Mono", monospace',
    fontWeight: 500,
  },
  synthesizingBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '10px',
    background: 'linear-gradient(90deg, rgba(139,92,246,0.1), rgba(59,130,246,0.1))',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    marginTop: '12px',
    fontSize: '13px',
    color: '#a78bfa',
    fontWeight: 500,
  },

  // ── Input area ──
  inputArea: {
    padding: '16px 24px 24px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(10,10,15,0.95)',
  },
  inputContainer: {
    maxWidth: '860px',
    margin: '0 auto',
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    padding: '14px 18px',
    borderRadius: '14px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e4e4e7',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'none' as const,
    outline: 'none',
    minHeight: '48px',
    maxHeight: '160px',
    lineHeight: '1.5',
    transition: 'border-color 0.2s',
  },
  sendButton: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    border: 'none',
    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
    color: '#fff',
    fontSize: '18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0,
    boxShadow: '0 2px 12px rgba(109, 40, 217, 0.4)',
  },
  sendButtonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },

  // ── Spinner keyframe (inline) ──
  '@keyframes spin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },

  // ── Cursor blink ──
  cursor: {
    display: 'inline-block',
    width: '2px',
    height: '16px',
    background: '#a78bfa',
    marginLeft: '2px',
    verticalAlign: 'text-bottom',
    animation: 'blink 1s step-end infinite',
  },
};

// ─── CSS Animations (injected once) ────────────────────────────────────────

const CSS_ANIMATIONS = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes blink {
  50% { opacity: 0; }
}
@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

// ─── Sub-Components ─────────────────────────────────────────────────────────

const Spinner: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <div
    style={{
      width: size,
      height: size,
      border: '2px solid rgba(139, 92, 246, 0.2)',
      borderTop: '2px solid #a78bfa',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}
  />
);

const AgentCard: React.FC<{ agent: Agent; index: number }> = ({ agent, index }) => {
  const cardStyle = {
    ...styles.agentCard,
    ...(agent.status === 'completed' ? styles.agentCardCompleted : {}),
    ...(agent.status === 'failed' ? styles.agentCardFailed : {}),
    animation: `slideIn 0.3s ease ${index * 0.1}s both`,
  };

  const iconStyle = {
    ...styles.agentStatusIcon,
    ...(agent.status === 'running'
      ? styles.agentRunning
      : agent.status === 'completed'
        ? styles.agentDone
        : styles.agentError),
  };

  return (
    <div style={cardStyle}>
      <div style={iconStyle}>
        {agent.status === 'running' ? (
          <Spinner size={14} />
        ) : agent.status === 'completed' ? (
          <span style={{ color: '#34d399' }}>&#10003;</span>
        ) : (
          <span style={{ color: '#f87171' }}>&#10007;</span>
        )}
      </div>
      <div style={styles.agentInfo}>
        <div style={styles.agentName}>{agent.name}</div>
        <div style={styles.agentTask}>
          {agent.status === 'failed' ? agent.error : agent.task}
        </div>
      </div>
      {agent.status === 'completed' && agent.duration && (
        <div style={styles.agentDuration}>{agent.duration.toFixed(1)}s</div>
      )}
    </div>
  );
};

const SwarmPanel: React.FC<{ swarm: SwarmState }> = ({ swarm }) => {
  const completedCount = swarm.agents.filter(a => a.status === 'completed').length;
  const failedCount = swarm.agents.filter(a => a.status === 'failed').length;
  const runningCount = swarm.agents.filter(a => a.status === 'running').length;

  // Progress bar width
  const progress = swarm.totalAgents > 0
    ? ((completedCount + failedCount) / swarm.totalAgents) * 100
    : 0;

  return (
    <div style={styles.swarmContainer}>
      <div style={styles.swarmHeader}>
        <span style={{ fontSize: '18px' }}>&#x1F680;</span>
        <span style={styles.swarmTitle}>Agent Swarm</span>
        <span style={styles.swarmCount}>
          {completedCount}/{swarm.totalAgents} completed
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: '3px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '2px',
        marginBottom: '14px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: runningCount > 0
            ? 'linear-gradient(90deg, #7c3aed, #a78bfa, #7c3aed)'
            : 'linear-gradient(90deg, #34d399, #6ee7b7)',
          backgroundSize: runningCount > 0 ? '200% 100%' : '100% 100%',
          animation: runningCount > 0 ? 'shimmer 1.5s ease infinite' : 'none',
          borderRadius: '2px',
          transition: 'width 0.5s ease',
        }} />
      </div>

      {/* Agent cards */}
      {swarm.agents.map((agent, i) => (
        <AgentCard key={agent.id} agent={agent} index={i} />
      ))}

      {/* Synthesizing indicator */}
      {swarm.synthesizing && (
        <div style={styles.synthesizingBar}>
          <Spinner size={14} />
          <span>Synthesizing final answer...</span>
        </div>
      )}
    </div>
  );
};

const ReasoningPanel: React.FC<{ reasoning: string }> = ({ reasoning }) => {
  const [expanded, setExpanded] = useState(false);

  if (!reasoning) return null;

  return (
    <div>
      <div
        style={styles.reasoningToggle}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span style={{
          display: 'inline-block',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>
          &#9654;
        </span>
        <span>Thinking</span>
        <span style={{
          animation: reasoning ? 'pulse 1.5s ease infinite' : 'none',
          fontSize: '8px',
          color: '#a78bfa',
        }}>&#9679;</span>
      </div>
      {expanded && (
        <div style={styles.reasoningPanel}>
          {reasoning}
        </div>
      )}
    </div>
  );
};

// ─── Simple Markdown Renderer ───────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  lines.forEach((line, i) => {
    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} style={{
            background: 'rgba(0,0,0,0.4)',
            borderRadius: '8px',
            padding: '14px 18px',
            fontSize: '13px',
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            overflowX: 'auto',
            border: '1px solid rgba(255,255,255,0.06)',
            margin: '8px 0',
            lineHeight: '1.5',
          }}>
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        codeLang = line.slice(3).trim();
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} style={{ fontSize: '15px', fontWeight: 600, color: '#e4e4e7', margin: '16px 0 8px' }}>
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} style={{ fontSize: '17px', fontWeight: 600, color: '#f4f4f5', margin: '20px 0 10px' }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: '24px 0 12px' }}>
          {line.slice(2)}
        </h1>
      );
    }
    // Bullet points
    else if (line.match(/^[-*] /)) {
      elements.push(
        <div key={i} style={{ paddingLeft: '16px', margin: '4px 0', display: 'flex', gap: '8px' }}>
          <span style={{ color: '#a78bfa' }}>&#8226;</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }
    // Numbered list
    else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.+)/);
      if (match) {
        elements.push(
          <div key={i} style={{ paddingLeft: '16px', margin: '4px 0', display: 'flex', gap: '8px' }}>
            <span style={{ color: '#818cf8', fontWeight: 500, minWidth: '20px' }}>{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>
        );
      }
    }
    // Horizontal rule
    else if (line.match(/^---+$/)) {
      elements.push(
        <hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0' }} />
      );
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '8px' }} />);
    }
    // Regular text
    else {
      elements.push(
        <p key={i} style={{ margin: '4px 0' }}>
          {renderInline(line)}
        </p>
      );
    }
  });

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Bold, italic, inline code, links
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Inline code
    const codeMatch = remaining.match(/`(.+?)`/);
    // Link
    const linkMatch = remaining.match(/\[(.+?)\]\((.+?)\)/);

    // Find earliest match
    const matches = [
      boldMatch ? { type: 'bold', index: remaining.indexOf(boldMatch[0]), match: boldMatch } : null,
      codeMatch ? { type: 'code', index: remaining.indexOf(codeMatch[0]), match: codeMatch } : null,
      linkMatch ? { type: 'link', index: remaining.indexOf(linkMatch[0]), match: linkMatch } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const earliest = matches[0]!;

    // Text before match
    if (earliest.index > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, earliest.index)}</span>);
    }

    // The match itself
    switch (earliest.type) {
      case 'bold':
        parts.push(
          <strong key={key++} style={{ color: '#e4e4e7', fontWeight: 600 }}>
            {earliest.match![1]}
          </strong>
        );
        remaining = remaining.slice(earliest.index + earliest.match![0].length);
        break;
      case 'code':
        parts.push(
          <code key={key++} style={{
            background: 'rgba(139, 92, 246, 0.15)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: '"JetBrains Mono", monospace',
            color: '#c4b5fd',
          }}>
            {earliest.match![1]}
          </code>
        );
        remaining = remaining.slice(earliest.index + earliest.match![0].length);
        break;
      case 'link':
        parts.push(
          <a key={key++} href={earliest.match![2]} target="_blank" rel="noopener noreferrer" style={{
            color: '#818cf8',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(129,140,248,0.3)',
          }}>
            {earliest.match![1]}
          </a>
        );
        remaining = remaining.slice(earliest.index + earliest.match![0].length);
        break;
    }
  }

  return <>{parts}</>;
}

// ─── Main Component ─────────────────────────────────────────────────────────

const AgentSwarmChat: React.FC<AgentSwarmChatProps> = ({
  apiBase = 'http://100.64.0.1:8081',
  apiKey = 'no-key',
  model = 'kimi2.5',
  systemPrompt,
  maxTokens = 4096,
  temperature = 0.7,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Inject CSS animations
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = CSS_ANIMATIONS;
    document.head.appendChild(styleEl);
    return () => { document.head.removeChild(styleEl); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  // ── Send message & stream response ──
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    // Prepare assistant message placeholder
    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      reasoning: '',
      swarm: { active: false, totalAgents: 0, agents: [], synthesizing: false },
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Build API messages
    const apiMessages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text },
    ];

    try {
      abortRef.current = new AbortController();

      const response = await fetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
          max_tokens: maxTokens,
          temperature,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response body');

      let buffer = '';
      let currentSwarm: SwarmState = { active: false, totalAgents: 0, agents: [], synthesizing: false };
      let fullContent = '';
      let fullReasoning = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();

          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Handle reasoning
            if (delta.reasoning) {
              fullReasoning += delta.reasoning;
            }

            // Handle content
            if (delta.content) {
              const chunk = delta.content;

              // Check if this is agent progress
              if (isAgentProgressChunk(chunk)) {
                currentSwarm = parseAgentChunk(chunk, currentSwarm);
              } else {
                fullContent += chunk;
              }
            }

            // Update message
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: fullContent,
                reasoning: fullReasoning,
                swarm: { ...currentSwarm },
                isStreaming: true,
              };
              return updated;
            });
          } catch (e) {
            // Skip malformed chunks
          }
        }
      }

      // Mark streaming complete
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        updated[lastIdx] = { ...updated[lastIdx], isStreaming: false };
        return updated;
      });

    } catch (error: any) {
      if (error.name === 'AbortError') return;

      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: `Error: ${error.message}`,
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, isLoading, messages, apiBase, apiKey, model, systemPrompt, maxTokens, temperature]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px' }}>&#x1F9E0;</span>
          <span style={styles.headerTitle}>Kimi K2.5 Agent Swarm</span>
        </div>
        <span style={styles.headerBadge}>Beta</span>
      </div>

      {/* Messages */}
      <div style={styles.messagesArea}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '80px 20px',
            color: '#52525b',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#x1F680;</div>
            <div style={{ fontSize: '18px', fontWeight: 500, color: '#71717a', marginBottom: '8px' }}>
              Kimi K2.5 Agent Swarm
            </div>
            <div style={{ fontSize: '14px', maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
              Ask complex questions and watch AI agents research in parallel.
              Try: "Investiga en paralelo las diferencias entre NVIDIA H200 y AMD MI325X"
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={styles.messageRow}>
            {msg.role === 'user' ? (
              <div style={styles.userMessage}>
                <div style={styles.userBubble}>{msg.content}</div>
              </div>
            ) : (
              <div style={styles.assistantMessage}>
                {/* Avatar */}
                <div style={styles.avatar}>K</div>

                {/* Content */}
                <div style={styles.assistantContent}>
                  {/* Reasoning */}
                  {msg.reasoning && <ReasoningPanel reasoning={msg.reasoning} />}

                  {/* Agent Swarm Panel */}
                  {msg.swarm?.active && <SwarmPanel swarm={msg.swarm} />}

                  {/* Response text */}
                  {msg.content && (
                    <div style={styles.responseText}>
                      {renderMarkdown(msg.content)}
                      {msg.isStreaming && (
                        <span style={styles.cursor} />
                      )}
                    </div>
                  )}

                  {/* Loading indicator when no content yet */}
                  {msg.isStreaming && !msg.content && !msg.swarm?.active && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
                      <Spinner />
                      <span style={{ fontSize: '13px', color: '#71717a' }}>Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <div style={styles.inputContainer}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (Shift+Enter for new line)"
            style={styles.textarea}
            rows={1}
            disabled={isLoading}
          />
          {isLoading ? (
            <button
              onClick={stopStreaming}
              style={{
                ...styles.sendButton,
                background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                boxShadow: '0 2px 12px rgba(220, 38, 38, 0.4)',
              }}
              title="Stop"
            >
              &#9632;
            </button>
          ) : (
            <button
              onClick={sendMessage}
              style={{
                ...styles.sendButton,
                ...(input.trim() ? {} : styles.sendButtonDisabled),
              }}
              disabled={!input.trim()}
              title="Send"
            >
              &#9650;
            </button>
          )}
        </div>
        <div style={{
          textAlign: 'center',
          fontSize: '11px',
          color: '#3f3f46',
          marginTop: '8px',
        }}>
          Kimi K2.5 on 8&times;H200 NVL &mdash; Agent Swarm with web search
        </div>
      </div>
    </div>
  );
};

export default AgentSwarmChat;

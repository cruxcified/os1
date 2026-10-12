import { Trash2 } from 'lucide-react';
import type { MemoryItem } from '../../shared/protocol';

interface MemoryViewerProps {
  isOpen: boolean;
  memories: MemoryItem[];
  onDelete: (id: string) => void;
  isLoading: boolean;
}

export function MemoryViewer({ isOpen, memories, onDelete, isLoading }: MemoryViewerProps) {

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString(); 
  };

  return (
    <div className={`memory-viewer ${isOpen ? 'open' : ''}`}>
      {isLoading ? (
        <div className="memory-loading">Loading memories...</div>
      ) : memories.length === 0 ? (
        <div className="memory-empty">No memories yet.</div>
      ) : (
        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id} className="memory-item">
              <div className="memory-item-content">
                <p className="memory-text">{memory.text}</p>
                <p className="memory-meta">
                  {memory.about === 'self' ? 'About itself' : 'About you'} · {formatDate(memory.createdAt)}
                </p>
              </div>
              <button
                className="memory-delete-button"
                onClick={() => onDelete(memory.id)}
                title="Forget this"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

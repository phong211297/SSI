'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Bot, Send, User, X, TrendingUp } from 'lucide-react';
import PriceTicker from './components/PriceTicker';
import StockList from './components/StockList';
import StockDetail from './components/StockDetail';
import styles from './dashboard.module.css';

export default function Home() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');
  const [selectedTicker, setSelectedTicker] = useState('');
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  const [chatOpen, setChatOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'streaming' || status === 'submitted';

  // Sync live prices từ SSE stream
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.prices) {
          const map: Record<string, any> = {};
          data.prices.forEach((p: any) => { map[p.code] = p; });
          setLivePrices(prev => ({ ...prev, ...map }));
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  // Auto scroll chat
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput('');
    setChatOpen(true);
  };

  const handleAskAI = useCallback((message: string) => {
    sendMessage({ text: message });
    setChatOpen(true);
  }, [sendMessage]);

  return (
    <div className={styles.app}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <div className={styles.logo}>
          <TrendingUp size={24} className={styles.logoIcon} />
          <span className={styles.logoText}>VN<strong>Stock</strong></span>
          <span className={styles.logoBadge}>AI</span>
        </div>
        <div className={styles.topBarRight}>
          <span className={styles.marketTime}>
            {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ICT
          </span>
          <button
            className={`${styles.chatToggle} ${chatOpen ? styles.active : ''}`}
            onClick={() => setChatOpen(o => !o)}
          >
            <Bot size={18} />
            <span>AI Analyst</span>
          </button>
        </div>
      </header>

      {/* Price ticker */}
      <PriceTicker onSelectTicker={setSelectedTicker} />

      {/* Main content */}
      <div className={styles.mainContent}>
        {/* Left: Stock list */}
        <aside className={styles.sidebar}>
          <StockList
            selectedTicker={selectedTicker}
            onSelectTicker={setSelectedTicker}
            livePrices={livePrices}
          />
        </aside>

        {/* Center: Stock detail */}
        <main className={styles.center}>
          <StockDetail ticker={selectedTicker} onAskAI={handleAskAI} />
        </main>

        {/* Right: AI Chat panel */}
        {chatOpen && (
          <aside className={styles.chatPanel}>
            <div className={styles.chatHeader}>
              <div className={styles.chatHeaderLeft}>
                <Bot size={18} />
                <span>AI Analyst</span>
              </div>
              <button className={styles.closeBtn} onClick={() => setChatOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className={styles.chatMessages}>
              {messages.length === 0 && (
                <div className={styles.chatEmpty}>
                  <p>Hỏi tôi về bất kỳ mã cổ phiếu nào!</p>
                  <div className={styles.chatSuggestions}>
                    {['Phân tích VNM', 'Nên mua HPG không?', 'Top 5 mã an toàn nhất'].map(s => (
                      <button key={s} className={styles.suggestion}
                        onClick={() => { sendMessage({ text: s }); }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`${styles.chatMsg} ${m.role === 'user' ? styles.userMsg : styles.aiMsg}`}>
                  <div className={styles.msgAvatar}>
                    {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                  </div>
                  <div className={styles.msgContent}>
                    {m.parts?.map((part, i) =>
                      part.type === 'text' ? <span key={i}>{part.text}</span> : null
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className={`${styles.chatMsg} ${styles.aiMsg}`}>
                  <div className={styles.msgAvatar}><Bot size={14} /></div>
                  <div className={styles.typing}>
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={handleSubmit} className={styles.chatInput}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Hỏi về cổ phiếu..."
                disabled={isLoading}
                autoFocus
              />
              <button type="submit" disabled={!input.trim() || isLoading}>
                <Send size={16} />
              </button>
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}

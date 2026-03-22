-- ============================================================
-- SSI Stock Analysis Platform — Database Schema
-- PostgreSQL 16 + pgvector extension
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── CORE: User & Auth ────────────────────────────────────────────────────────

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portfolios (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  avg_price  DECIMAL(15, 2) NOT NULL CHECK (avg_price > 0),
  bought_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_portfolios_user_id ON portfolios (user_id);
CREATE INDEX idx_portfolios_ticker  ON portfolios (ticker);

CREATE TABLE watchlists (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker   TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_price_high DECIMAL(15, 2),
  alert_price_low  DECIMAL(15, 2),
  PRIMARY KEY (user_id, ticker)
);
CREATE INDEX idx_watchlists_user_id ON watchlists (user_id);

-- ─── MARKET: Stock Master ─────────────────────────────────────────────────────

CREATE TABLE stocks (
  ticker        TEXT PRIMARY KEY,
  company_name  TEXT NOT NULL,
  industry      TEXT,
  floor         TEXT NOT NULL CHECK (floor IN ('HOSE', 'HNX', 'UPCOM')),
  ipo_date      DATE,
  ipo_price     DECIMAL(15, 2),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── MARKET: Time-series Price Data (Partitioned by Month) ───────────────────

CREATE TABLE stock_prices (
  time    TIMESTAMPTZ NOT NULL,
  ticker  TEXT NOT NULL,
  open    DECIMAL(15, 2),
  high    DECIMAL(15, 2),
  low     DECIMAL(15, 2),
  close   DECIMAL(15, 2) NOT NULL,
  volume  BIGINT,
  PRIMARY KEY (time, ticker)
) PARTITION BY RANGE (time);

-- Create partitions for the next 6 months (auto-extend via worker)
CREATE TABLE stock_prices_2026_01 PARTITION OF stock_prices FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE stock_prices_2026_02 PARTITION OF stock_prices FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE stock_prices_2026_03 PARTITION OF stock_prices FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE stock_prices_2026_04 PARTITION OF stock_prices FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE stock_prices_2026_05 PARTITION OF stock_prices FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE stock_prices_2026_06 PARTITION OF stock_prices FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Historical data (unpartitioned for simplicity — partition later if needed)
CREATE TABLE stock_prices_history (
  time    TIMESTAMPTZ NOT NULL,
  ticker  TEXT NOT NULL,
  open    DECIMAL(15, 2),
  high    DECIMAL(15, 2),
  low     DECIMAL(15, 2),
  close   DECIMAL(15, 2) NOT NULL,
  volume  BIGINT,
  PRIMARY KEY (time, ticker)
);
CREATE INDEX idx_history_ticker_time ON stock_prices_history (ticker, time DESC);

-- ─── MARKET: Technical Indicators ─────────────────────────────────────────────

CREATE TABLE stock_indicators (
  time        TIMESTAMPTZ NOT NULL,
  ticker      TEXT NOT NULL,
  -- Trend
  ma_5        DECIMAL(15, 2),
  ma_20       DECIMAL(15, 2),
  ma_50       DECIMAL(15, 2),
  ma_200      DECIMAL(15, 2),
  ema_12      DECIMAL(15, 2),
  ema_26      DECIMAL(15, 2),
  -- Momentum
  rsi_14      DECIMAL(5, 2),    -- 0–100
  macd        DECIMAL(15, 4),
  macd_signal DECIMAL(15, 4),
  macd_hist   DECIMAL(15, 4),
  -- Volatility
  bb_upper    DECIMAL(15, 2),   -- Bollinger Band Upper
  bb_middle   DECIMAL(15, 2),   -- Bollinger Band Middle (= MA20)
  bb_lower    DECIMAL(15, 2),   -- Bollinger Band Lower
  atr_14      DECIMAL(15, 2),   -- Average True Range
  -- Volume
  volume_ma20 BIGINT,
  PRIMARY KEY (time, ticker)
);
CREATE INDEX idx_indicators_ticker_time ON stock_indicators (ticker, time DESC);

-- ─── MARKET: Whale / Smart Money Tracking ─────────────────────────────────────

CREATE TABLE whale_trades (
  id         BIGSERIAL PRIMARY KEY,
  time       TIMESTAMPTZ NOT NULL,
  ticker     TEXT NOT NULL,
  side       TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  volume     BIGINT NOT NULL,
  value      DECIMAL(20, 0) NOT NULL,  -- VND
  source     TEXT NOT NULL CHECK (source IN ('foreign_buy', 'foreign_sell', 'proprietary', 'large_order')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_whale_ticker_time ON whale_trades (ticker, time DESC);
CREATE INDEX idx_whale_time        ON whale_trades (time DESC);

-- ─── FUND: Quỹ mở ─────────────────────────────────────────────────────────────

CREATE TABLE funds (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  fund_company TEXT,
  fund_type    TEXT,             -- 'equity', 'bond', 'balanced', 'money-market'
  inception_date DATE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fund_nav (
  time      TIMESTAMPTZ NOT NULL,
  fund_code TEXT NOT NULL REFERENCES funds(code),
  nav       DECIMAL(15, 4) NOT NULL,
  PRIMARY KEY (time, fund_code)
);
CREATE INDEX idx_fund_nav_code_time ON fund_nav (fund_code, time DESC);

-- ─── NEWS + RAG: Vector Search ────────────────────────────────────────────────

CREATE TABLE news (
  id         BIGSERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT,
  url        TEXT UNIQUE NOT NULL,
  source     TEXT,               -- 'cafef', 'vnexpress', 'ssi', 'vndirect'
  tickers    TEXT[],             -- '{HPG,VNM}' — mã liên quan
  published  TIMESTAMPTZ,
  -- RAG embedding (NULL until processed by worker)
  embedding  vector(1536),
  embedded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ANN index for fast vector similarity search
CREATE INDEX idx_news_embedding ON news
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- GIN index for ticker array search
CREATE INDEX idx_news_tickers ON news USING gin (tickers);
CREATE INDEX idx_news_published ON news (published DESC);

-- ─── SYSTEM: Utility Functions ────────────────────────────────────────────────

-- Search news by vector similarity (called by AI tool)
CREATE OR REPLACE FUNCTION search_similar_news(
  query_embedding vector(1536),
  match_ticker    TEXT DEFAULT NULL,
  match_count     INT  DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id         BIGINT,
  title      TEXT,
  content    TEXT,
  url        TEXT,
  source     TEXT,
  tickers    TEXT[],
  published  TIMESTAMPTZ,
  similarity FLOAT
) LANGUAGE sql STABLE AS $$
  SELECT
    n.id, n.title, n.content, n.url, n.source, n.tickers, n.published,
    1 - (n.embedding <=> query_embedding) AS similarity
  FROM news n
  WHERE
    n.embedding IS NOT NULL
    AND (match_ticker IS NULL OR match_ticker = ANY(n.tickers))
    AND 1 - (n.embedding <=> query_embedding) > similarity_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER stocks_updated_at BEFORE UPDATE ON stocks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

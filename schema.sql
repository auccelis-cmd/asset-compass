-- 資產羅盤 Asset Compass · Supabase 資料庫結構
-- 在 Supabase Dashboard → SQL Editor 貼上整份執行一次即可。

create extension if not exists pgcrypto;

-- 銀行帳戶
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  bank text,
  currency text not null default 'TWD',
  balance numeric not null default 0,
  note text,
  created_at timestamptz default now()
);

-- 帳戶異動紀錄
create table if not exists balance_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid references accounts on delete cascade,
  delta numeric not null,
  balance_after numeric,
  note text,
  created_at timestamptz default now()
);

-- 信用卡（結算日 = 扣款日）
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  wallet_name text,              -- Apple 錢包裡顯示的卡片名稱，捷徑比對用
  closing_day int not null check (closing_day between 1 and 31), -- 每月結帳日
  due_day int check (due_day between 1 and 31),                    -- 每月扣款日（null = 結帳日當天）
  debit_account_id uuid references accounts on delete set null,
  credit_limit numeric,
  last_settled date,             -- 最近一期已自動扣款帳單的結帳日
  color text,
  rewards jsonb,                 -- 回饋規則
  created_at timestamptz default now()
);

-- 刷卡消費
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  card_id uuid references cards on delete set null,
  card_label text,
  merchant text,
  amount numeric not null,
  currency text not null default 'TWD',
  amount_twd numeric not null,
  txn_at timestamptz not null default now(),
  source text default 'manual',  -- manual | shortcut
  pay text,                      -- card | applepay | linepay | googlepay | samsungpay | other
  note text,
  settled_cycle text,            -- 已扣款的結算日（null = 尚未扣款）
  created_at timestamptz default now()
);

-- 扣款紀錄（同一張卡同一結算日只會有一筆，防止兩台裝置重複扣款）
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  card_id uuid references cards on delete cascade,
  cycle_end date not null,
  amount numeric not null,
  account_id uuid references accounts on delete set null,
  created_at timestamptz default now(),
  unique (card_id, cycle_end)
);

-- 台股持股
create table if not exists stocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  code text not null,
  name text,
  shares numeric not null default 0,
  avg_cost numeric,
  note text,
  created_at timestamptz default now()
);

-- 加密貨幣（交易所等手動持倉）
create table if not exists crypto_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  symbol text not null,
  cg_id text,
  qty numeric not null default 0,
  venue text,
  note text,
  created_at timestamptz default now()
);

-- 鏈上錢包（只存公開地址，絕不存私鑰）
create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text,
  address text not null,
  chain text not null default 'evm', -- evm | btc
  created_at timestamptz default now()
);

-- 每日淨資產快照
create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  net numeric, bank numeric, stock numeric, crypto numeric, debt numeric,
  created_at timestamptz default now(),
  unique (user_id, date)
);

-- iOS 捷徑用的寫入金鑰
create table if not exists ingest_tokens (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token text not null unique,
  created_at timestamptz default now()
);

-- 列層級安全性：每個人只看得到自己的資料
do $$
declare t text;
begin
  foreach t in array array['accounts','balance_log','cards','transactions','settlements',
                           'stocks','crypto_holdings','wallets','snapshots','ingest_tokens']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own_rows" on %I', t);
    execute format('create policy "own_rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

create index if not exists transactions_card_idx on transactions (card_id, settled_cycle);

-- 舊版資料庫升級用（已經建過表的話，單獨執行這行即可）
alter table cards add column if not exists due_day int check (due_day between 1 and 31);
alter table cards add column if not exists rewards jsonb;
alter table transactions add column if not exists pay text;

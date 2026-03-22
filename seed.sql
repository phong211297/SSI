-- ============================================================
-- Seed Data — Stock Master List
-- ============================================================

INSERT INTO stocks (ticker, company_name, industry, floor, ipo_date, ipo_price) VALUES
  ('VNM',  'Công ty CP Sữa Việt Nam (Vinamilk)',         'Thực phẩm & Đồ uống',   'HOSE', '2006-01-19', 32000),
  ('VCB',  'Ngân hàng TMCP Ngoại Thương Việt Nam',       'Ngân hàng',              'HOSE', '2009-06-30', 35000),
  ('HPG',  'Tập đoàn Hòa Phát',                          'Thép & Vật liệu',        'HOSE', '2007-11-15', 22000),
  ('VIC',  'Tập đoàn Vingroup',                          'Bất động sản',           'HOSE', '2007-09-20', 18000),
  ('VHM',  'Công ty CP Vinhomes',                        'Bất động sản',           'HOSE', '2018-05-17', 51000),
  ('TCB',  'Ngân hàng TMCP Kỹ Thương Việt Nam',          'Ngân hàng',              'HOSE', '2018-06-04', 90000),
  ('MBB',  'Ngân hàng TMCP Quân Đội',                    'Ngân hàng',              'HOSE', '2011-01-01', 16000),
  ('FPT',  'Công ty CP FPT',                             'Công nghệ',              'HOSE', '2006-12-13', 35000),
  ('MSN',  'Tập đoàn Masan',                             'Hàng tiêu dùng',         'HOSE', '2009-11-05', 39000),
  ('GAS',  'Tổng Công ty Khí Việt Nam (PV Gas)',         'Dầu khí',                'HOSE', '2012-05-23', 50000),
  ('BID',  'Ngân hàng TMCP Đầu tư & Phát triển VN',     'Ngân hàng',              'HOSE', '2014-01-24', 18500),
  ('CTG',  'Ngân hàng TMCP Công Thương Việt Nam',        'Ngân hàng',              'HOSE', '2009-07-16', 25000),
  ('ACB',  'Ngân hàng TMCP Á Châu',                      'Ngân hàng',              'HNX',  '2006-11-21', 18000),
  ('VPB',  'Ngân hàng TMCP Việt Nam Thịnh Vượng',       'Ngân hàng',              'HOSE', '2017-08-17', 39000),
  ('STB',  'Ngân hàng TMCP Sài Gòn Thương Tín',         'Ngân hàng',              'HOSE', '2006-03-09', 12000),
  ('SSI',  'Công ty CP Chứng khoán SSI',                 'Chứng khoán',            'HOSE', '2008-05-30', 22000),
  ('VJC',  'Công ty CP Hàng không VietJet',              'Hàng không',             'HOSE', '2017-02-28', 90000),
  ('PLX',  'Tập đoàn Xăng dầu Việt Nam (Petrolimex)',   'Dầu khí',                'HOSE', '2017-04-20', 43000),
  ('POW',  'Tổng Công ty Điện lực Dầu khí Việt Nam',    'Điện lực',               'HOSE', '2019-01-31', 14400),
  ('REE',  'Công ty CP Cơ điện lạnh (REE Corporation)', 'Công nghiệp',            'HOSE', '2000-07-28', 16000),
  ('HDB',  'Ngân hàng TMCP Phát triển TP.HCM',          'Ngân hàng',              'HOSE', '2018-01-05', 32000),
  ('TPB',  'Ngân hàng TMCP Tiên Phong',                  'Ngân hàng',              'HOSE', '2018-04-19', 32000),
  ('KDH',  'Công ty CP Đầu tư & Kinh doanh Nhà Khang Điền', 'Bất động sản',      'HOSE', '2010-12-01', 15000),
  ('DGC',  'Công ty CP Tập đoàn Hóa chất Đức Giang',   'Hóa chất',               'HOSE', '2017-11-14', 19500),
  ('MWG',  'Công ty CP Đầu tư Thế Giới Di Động',        'Bán lẻ',                 'HOSE', '2014-07-14', 55000)
ON CONFLICT (ticker) DO NOTHING;

-- ─── Seed một số quỹ mở phổ biến ─────────────────────────────────────────────
INSERT INTO funds (code, name, fund_company, fund_type, inception_date) VALUES
  ('VFMVSF',  'VFM VN30 ETF',                    'VFM',        'equity',      '2014-10-06'),
  ('DCVFMVN30','Quỹ ETF DCVFM VN30',             'Dragon Capital', 'equity',  '2020-03-18'),
  ('VESAF',   'Quỹ Đầu tư Cổ phiếu Tiếp Cận Thị Trường', 'VFM', 'equity',  '2019-08-30'),
  ('BVPF',    'Quỹ Phúc Lợi Bảo Việt',           'Bảo Việt',   'balanced',   '2016-05-11')
ON CONFLICT (code) DO NOTHING;

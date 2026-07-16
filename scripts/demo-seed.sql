\set ON_ERROR_STOP on

BEGIN;

-- This script is only for the disposable database in docker-compose.demo.yml.
-- Cascading from users clears reader and appearance state before every reseed.
TRUNCATE TABLE users CASCADE;

INSERT INTO users (id, username, updated_at)
VALUES ('10000000-0000-4000-8000-000000000001', :'demo_username', now() - interval '1 day');

INSERT INTO categories (id, user_id, name)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Engineering'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Design');

INSERT INTO feeds (
  id, user_id, canonical_url, title, site_url, description, last_fetched_at, next_refresh_at
)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'https://example.com/demo/platform.xml',
    'Platform Notes',
    'https://example.com/',
    'Invented engineering notes for the hosted demo.',
    now(),
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'https://example.com/demo/interface.xml',
    'Interface Review',
    'https://example.com/',
    'Invented product and interface articles.',
    now(),
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'https://example.com/demo/field-notes.xml',
    'Field Notes',
    'https://example.com/',
    'Short operational observations for reader filtering.',
    now(),
    NULL
  );

INSERT INTO feed_categories (feed_id, category_id)
VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001');

INSERT INTO articles (
  id, feed_id, external_id, url, title, author, summary,
  feed_content_html, extracted_content_html, extraction_status,
  extraction_attempted_at, published_at
)
VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'bounded-refresh-queue',
    'https://example.com/demo/platform/bounded-refresh-queue',
    'Designing a bounded refresh queue',
    'Demo Editorial',
    'How small batches keep background work predictable.',
    '<p>A bounded queue makes load visible and recoverable.</p>',
    '<h2>Bounded work is observable work</h2><p>Small batches make retries, latency, and failure states easier to reason about. This invented article is stored locally.</p>',
    'complete',
    now(),
    now() - interval '2 hours'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    'guarded-remote-content',
    'https://example.com/demo/platform/guarded-remote-content',
    'Guardrails for remote content',
    'Demo Editorial',
    'Validate destinations, redirects, media types, and byte limits.',
    '<p>Remote content must be treated as untrusted input.</p>',
    '<h2>Validate every hop</h2><p>Resolve and validate the initial URL and every redirect, then enforce type and size limits before parsing.</p>',
    'complete',
    now(),
    now() - interval '1 day'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    'recoverable-failures',
    'https://example.com/demo/platform/recoverable-failures',
    'Recoverable refresh failures',
    'Demo Editorial',
    'Preserve useful state when an upstream feed fails.',
    '<p>A failed refresh should not erase the last known good list.</p>',
    '<h2>Keep the last good state</h2><p>Record a safe error code and schedule a bounded retry while normalized articles remain readable.</p>',
    'complete',
    now(),
    now() - interval '3 days'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000002',
    'responsive-reading-density',
    'https://example.com/demo/interface/responsive-reading-density',
    'Tuning reading density across screens',
    'Demo Studio',
    'A responsive reader should preserve hierarchy, not just shrink.',
    '<p>Reading density changes with viewport and attention.</p>',
    '<h2>Preserve the hierarchy</h2><p>Collapse secondary controls on smaller screens while keeping context and reading actions nearby.</p>',
    'complete',
    now(),
    now() - interval '5 hours'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000002',
    'versioned-theme-contract',
    'https://example.com/demo/interface/versioned-theme-contract',
    'A versioned contract for themes',
    'Demo Studio',
    'Portable appearance settings need schema and contrast validation.',
    '<p>Theme files are data contracts, not arbitrary stylesheets.</p>',
    '<h2>Make customization portable</h2><p>A versioned token contract supports preview, validation, import, export, and recovery without executable CSS.</p>',
    'complete',
    now(),
    now() - interval '2 days'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000002',
    'keyboard-reading-flow',
    'https://example.com/demo/interface/keyboard-reading-flow',
    'Keyboard-first article navigation',
    'Demo Studio',
    'Focus order is part of the reader architecture.',
    '<p>Keyboard navigation should follow the visible reading flow.</p>',
    '<h2>Focus follows structure</h2><p>Predictable focus order and clear active states make dense layouts usable without a pointer.</p>',
    'complete',
    now(),
    now() - interval '4 days'
  ),
  (
    '40000000-0000-4000-8000-000000000007',
    '30000000-0000-4000-8000-000000000003',
    'safe-observability',
    'https://example.com/demo/field/safe-observability',
    'What to log around feed refreshes',
    'Demo Operations',
    'Prefer safe identifiers, durations, counts, and error codes.',
    '<p>Operational logs should explain work without leaking content.</p>',
    '<h2>Log structure, not secrets</h2><p>Record duration, item counts, safe error codes, and internal identifiers while excluding credentials and private text.</p>',
    'complete',
    now(),
    now() - interval '8 hours'
  ),
  (
    '40000000-0000-4000-8000-000000000008',
    '30000000-0000-4000-8000-000000000003',
    'disposable-demo-data',
    'https://example.com/demo/field/disposable-demo-data',
    'Resetting a shared demo safely',
    'Demo Operations',
    'Use a disposable database and deterministic seed data.',
    '<p>Shared demos need a clean return path.</p>',
    '<h2>Disposable by design</h2><p>Keep the database separate, seed only invented content, and reset it on a predictable schedule.</p>',
    'complete',
    now(),
    now() - interval '5 days'
  );

INSERT INTO article_states (
  id, user_id, article_id, is_read, is_starred, read_at, starred_at
)
VALUES
  (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003',
    true,
    false,
    now() - interval '1 day',
    NULL
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000005',
    true,
    true,
    now() - interval '12 hours',
    now() - interval '12 hours'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000007',
    false,
    true,
    NULL,
    now() - interval '2 hours'
  );

COMMIT;

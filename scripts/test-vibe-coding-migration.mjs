/** Run 0016 only in a disposable database inside the existing local Supabase container.
 * Usage: node scripts/test-vibe-coding-migration.mjs <read-only production snapshot.json>
 * Snapshot format: supabase db query --linked ... --output json, rows[0].snapshot.
 * No remote connection or credential is accepted by this runner.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = process.argv[2];
if (!file) throw new Error('Pass a categories/bookmarks snapshot JSON file');
const fixture = JSON.parse(readFileSync(file, 'utf8')).rows[0].snapshot;
const migration = readFileSync(new URL('../supabase/migrations/0016_organize_vibe_coding.sql', import.meta.url), 'utf8');
const container = 'supabase_db_favorite';
const database = `favorite_classification_test_${process.pid}`;
const vibe = '9a5325d2-f82f-4687-b4c3-887fb4feb7fa';
const design = '357c9ec8-1f7e-4072-a578-28e7007e523e';
const code = '0466fe3e-7887-42cd-8f1d-6209973ad818';
const jiro = '556fd17c-8427-4529-96f0-8b3d9203dcd1';
const resources = ['5ec956b9-ae6e-4054-a341-42e5648d6f0c', '732250d2-21ed-423d-b6d1-88d3419c1051'];
const literal = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function sql(query, db = database, expectFailure = false) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db],
    { input: query, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (expectFailure) { assert.notEqual(result.status, 0, 'expected migration rejection'); return; }
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}

function reset() {
  sql(`drop schema public cascade; create schema public;
    create table categories(id uuid primary key default gen_random_uuid(), name text not null,
      parent_id uuid references categories(id), sort_order int not null default 0, created_at timestamptz default now(),
      unique nulls not distinct(name,parent_id));
    create table bookmarks(id uuid primary key, category_id uuid references categories(id),
      title text, url text, normalized_url text unique, description text, tags text[], favicon_url text,
      is_pinned boolean, is_favorite boolean, fav_order int, source text, sort_order int,
      created_at timestamptz, updated_at timestamptz);
    insert into categories select * from jsonb_populate_recordset(null::categories, ${literal(fixture.categories)});
    insert into bookmarks select * from jsonb_populate_recordset(null::bookmarks, ${literal(fixture.bookmarks)});
    create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at := now(); return new; end$$;
    create trigger bookmarks_updated_at before update on bookmarks for each row execute function set_updated_at();
    create table clicks_sentinel(total int); insert into clicks_sentinel values (${Number(fixture.click_count)});`);
}
function snapshot() {
  return JSON.parse(sql(`select jsonb_build_object('categories',(select jsonb_agg(to_jsonb(c) order by id) from categories c),
    'bookmarks',(select jsonb_agg(to_jsonb(b) order by id) from bookmarks b),
    'click_count',(select total from clicks_sentinel))`));
}

sql(`create database ${database}`, 'postgres');
try {
  reset();
  const before = snapshot();
  sql(migration);
  const after = snapshot();
  const tools = after.categories.find(c => c.parent_id === vibe && c.name === '도구모음');
  assert.ok(tools);
  assert.deepEqual(after.categories.filter(c => c.parent_id === vibe).sort((a,b) => a.sort_order-b.sort_order).map(c => c.name), ['도구모음','디자인','코딩/에이전트']);
  assert.equal(after.categories.length, before.categories.length);
  assert.equal(after.bookmarks.length, before.bookmarks.length);
  for (const [id, count] of [[tools.id,12],[design,13],[code,19],[vibe,0]])
    assert.equal(after.bookmarks.filter(b => b.category_id === id).length, count);
  const expected = new Map(before.bookmarks.map(b => [b.id, b]));
  for (const b of after.bookmarks) {
    const original = expected.get(b.id);
    assert.ok(original);
    const target = original.category_id === vibe ? tools.id : b.id === jiro || resources.includes(b.id) ? design : original.category_id;
    const toolOrder = ['https://github.com/zeroclaw-labs/zeroclaw', 'https://github.com/ZeroLu/awesome-gpt-image',
      'https://github.com/pim97/anti-detect-browser-tools-tech-comparison'].indexOf(b.url);
    const order = b.id === jiro ? 246 : resources.includes(b.id) ? 247 + resources.indexOf(b.id)
      : toolOrder >= 0 ? 9 + toolOrder : original.sort_order;
    assert.equal(b.category_id, target);
    assert.equal(b.sort_order, order);
    const preservedFields = (row) => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !['category_id', 'sort_order', 'updated_at'].includes(key)));
    const preserved = preservedFields(b);
    const originalPreserved = preservedFields(original);
    assert.deepEqual(preserved, originalPreserved, `bookmark fields changed: ${b.id}`);
    if (target === original.category_id && order === original.sort_order) assert.equal(b.updated_at, original.updated_at);
  }
  for (const c of before.categories) {
    const current = after.categories.find(x => x.id === c.id);
    assert.deepEqual(current, c.id === design ? { ...c, parent_id: vibe, sort_order: 1 }
      : c.id === tools.id ? { ...c, parent_id: vibe, name: '도구모음', sort_order: 0 }
      : c.id === code ? { ...c, parent_id: vibe, name: '코딩/에이전트', sort_order: 2 } : c);
  }
  assert.equal(after.click_count, before.click_count);
  console.log('PASS initial migration: all bookmark fields, category identities and expected destinations preserved');
  sql(migration);
  assert.deepEqual(snapshot(), after);
  console.log('PASS rerun: no changes');

  const cases = [
    ['missing repository', `delete from bookmarks where id = (select id from bookmarks where category_id='${vibe}' limit 1)`],
    ['changed repository URL', `update bookmarks set url='https://example.org/changed' where id = (select id from bookmarks where category_id='${vibe}' limit 1)`],
    ['Jiro manually moved', `update bookmarks set category_id='${code}' where id='${jiro}'`],
    ['Jiro changed URL', `update bookmarks set url='https://example.org/changed' where id='${jiro}'`],
    ['Jiro changed source', `update bookmarks set source='manual' where id='${jiro}'`],
    ['design no longer a leaf', `insert into categories(name,parent_id) values('unexpected','${design}')`],
    ['partial hierarchy', `insert into categories(name,parent_id) values('도구모음','${vibe}')`],
    ['unexpected root order', `update categories set sort_order=99 where id='${vibe}'`],
  ];
  for (const [label, mutation] of cases) {
    reset(); sql(mutation); const state = snapshot();
    sql(migration, database, true);
    assert.deepEqual(snapshot(), state, `failed migration was not atomic: ${label}`);
    console.log(`PASS rejection + rollback: ${label}`);
  }
} finally {
  sql(`drop database ${database}`, 'postgres');
}

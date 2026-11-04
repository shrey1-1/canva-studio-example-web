/**
 * Database migrations, applied in order and never edited once released (add a new one instead).
 * Statements are separated by a semicolon at the end of a line.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'accounts, projects, files, versions, assets',
    sql: `
create table users (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions(user_id);
create table projects (
  id uuid primary key,
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (project_id, user_id)
);
create index project_members_user on project_members(user_id);
create table folders (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index folders_project on folders(project_id);
create table files (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  name text not null,
  document jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);
create index files_project on files(project_id);
create table file_versions (
  id uuid primary key,
  file_id uuid not null references files(id) on delete cascade,
  label text,
  auto boolean not null,
  document jsonb not null,
  revision integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);
create index file_versions_file on file_versions(file_id, created_at desc);
create table assets (
  project_id uuid not null references projects(id) on delete cascade,
  id text not null,
  mime text not null,
  size integer not null,
  width integer not null,
  height integer not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);
create index assets_id on assets(id);
`,
  },
];

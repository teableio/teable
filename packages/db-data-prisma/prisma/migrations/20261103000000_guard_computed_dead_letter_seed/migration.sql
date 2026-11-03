-- Old replicas restore an archived dead letter by inserting the parent row as-is and then
-- deleting the archive. Once seed membership moves to this child table, that sequence
-- inserts an empty rerun and the parent delete cascades the only copy of the seeds.
-- The archive row may therefore be deleted only in the transaction that proves the live
-- rerun carries the archived membership.
--
-- Functions live in the owning schema so space copy transfers them with their triggers.
-- Authorization is a transaction id, not a session flag: rollback removes it, and it is
-- never copied to another row or database.

ALTER TABLE "computed_update_dead_letter"
  ADD COLUMN IF NOT EXISTS "delete_authorized_txid" BIGINT;

-- A fresh current restore tags its live rerun so the archive guard can distinguish it
-- from an old replica's bare insert of the archived parent row.
ALTER TABLE "computed_update_outbox"
  ADD COLUMN IF NOT EXISTS "dead_letter_restore_version" INTEGER;

-- Direct archive discard, scoped to the exact archive ids the caller selected.
create or replace function computed_outbox_authorize_discard(task_ids text[])
returns void
language plpgsql
as $$
declare
  selected_count integer;
begin
  if task_ids is null or cardinality(task_ids) = 0 then
    return;
  end if;
  perform 1 from computed_update_dead_letter where id = any(task_ids) for update;
  select count(*) into selected_count
    from computed_update_dead_letter
   where id = any(task_ids);
  if selected_count <> cardinality(task_ids) then
    raise exception 'computed dead letter archives are missing for the discard request'
      using errcode = '23514';
  end if;
  update computed_update_dead_letter
     set delete_authorized_txid = txid_current()
   where id = any(task_ids);
end;
$$;

-- Restore intent. A known complete manifest is required; membership must match the live
-- rerun in both directions, including the exact manifest count (zero included), and the
-- live row must carry the current restore marker. Old replicas never call this.
create or replace function computed_outbox_authorize_restore(task_ids text[])
returns void
language plpgsql
as $$
declare
  archive computed_update_dead_letter%rowtype;
  live computed_update_outbox%rowtype;
  manifest jsonb;
  archived_count bigint;
  live_count bigint;
  expected_count numeric;
  selected_count integer := 0;
begin
  if task_ids is null or cardinality(task_ids) = 0 then
    return;
  end if;
  for archive in select * from computed_update_dead_letter where id = any(task_ids) for update loop
    selected_count := selected_count + 1;
    manifest := archive.dirty_stats -> 'rerunInputs';
    if manifest is null then
      -- Historical inline-only archives are still supported, but child-only input
      -- without a manifest cannot be distinguished from a partial archive.
      if exists (select 1 from computed_update_dead_letter_seed where task_id = archive.id) then
        raise exception 'computed dead letter % has unversioned child membership', archive.id
          using errcode = '23514';
      end if;
      continue;
    end if;
    if jsonb_typeof(manifest) is distinct from 'object'
      or manifest -> 'version' is distinct from '1'::jsonb
      or manifest -> 'complete' is distinct from 'true'::jsonb
      or jsonb_typeof(manifest -> 'seedCount') is distinct from 'string'
      or manifest ->> 'seedCount' !~ '^[0-9]+$' then
      raise exception 'computed dead letter % has an unsupported or incomplete rerun manifest', archive.id
        using errcode = '23514';
    end if;
    expected_count := (manifest ->> 'seedCount')::numeric;
    select count(*) into archived_count from computed_update_dead_letter_seed where task_id = archive.id;
    select count(*) into live_count from computed_update_outbox_seed where task_id = archive.id;
    select * into live from computed_update_outbox where id = archive.id for update;
    if live.id is null
      or live.dead_letter_restore_version is distinct from 1
      or live.base_id is distinct from archive.base_id
      or live.worker_lane is distinct from archive.worker_lane
      or live.seed_table_id is distinct from archive.seed_table_id
      or live.change_type is distinct from archive.change_type
      or live.run_id is not distinct from archive.run_id
      or live.run_id is null
      or live.origin_run_ids is distinct from array[live.run_id]::text[]
      or live.status is distinct from 'pending'
      or live.attempts is distinct from 0
      or live.stage_depth is distinct from 0
      or live.predecessor_task_id is not null
      or live.run_completed_steps_before is distinct from 0
      or live.seed_record_ids is not null
      or jsonb_exists_any(live.dirty_stats, array['ledgerScopeId','partialStageBudget','seedAllCursors','rerunInputs'])
      or expected_count <> archived_count or expected_count <> live_count
      or exists (
        (select table_id, record_id from computed_update_dead_letter_seed where task_id = archive.id)
        except
        (select table_id, record_id from computed_update_outbox_seed where task_id = archive.id)
      )
      or exists (
        (select table_id, record_id from computed_update_outbox_seed where task_id = archive.id)
        except
        (select table_id, record_id from computed_update_dead_letter_seed where task_id = archive.id)
      ) then
      raise exception 'computed dead letter % restore does not have complete fresh rerun membership', archive.id
        using errcode = '23514';
    end if;
    update computed_update_dead_letter set delete_authorized_txid = txid_current() where id = archive.id;
  end loop;
  if selected_count <> cardinality(task_ids) then
    raise exception 'computed dead letter archives are missing for the restore request'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function computed_outbox_complete_restore(task_ids text[])
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  perform computed_outbox_authorize_restore(task_ids);
  with deleted as (
    delete from computed_update_dead_letter where id = any(task_ids) returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function computed_outbox_discard(task_ids text[])
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  perform computed_outbox_authorize_discard(task_ids);
  with deleted as (
    delete from computed_update_dead_letter where id = any(task_ids) returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function computed_outbox_discard_existing(task_ids text[])
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  if task_ids is null or cardinality(task_ids) = 0 then
    return 0;
  end if;
  update computed_update_dead_letter
     set delete_authorized_txid = txid_current()
   where id = any(task_ids);
  with deleted as (
    delete from computed_update_dead_letter where id = any(task_ids) returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function computed_outbox_discard_base(base_ids text[])
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  if base_ids is null or cardinality(base_ids) = 0 then
    return 0;
  end if;
  update computed_update_dead_letter
     set delete_authorized_txid = txid_current()
   where base_id = any(base_ids);
  with deleted as (
    delete from computed_update_dead_letter where base_id = any(base_ids) returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function computed_outbox_discard_all()
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  update computed_update_dead_letter set delete_authorized_txid = txid_current();
  with deleted as (
    delete from computed_update_dead_letter returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function computed_outbox_delete_archive_seed(
  archive_task_id text,
  archive_table_id text,
  archive_record_id text
)
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  update computed_update_dead_letter
     set delete_authorized_txid = txid_current()
   where id = archive_task_id;
  with deleted as (
    delete from computed_update_dead_letter_seed
     where task_id = archive_task_id
       and table_id = archive_table_id
       and record_id = archive_record_id
     returning 1
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

-- Parent deletes require the marker. Legacy archives that predate the child table and
-- hold only inline seeds keep their old behavior. A manifest (even seedCount 0) or any
-- child row makes the archive versioned and therefore guarded.
create or replace function computed_outbox_archive_guard()
returns trigger
language plpgsql
as $$
declare
  manifest jsonb;
  has_children boolean;
begin
  if TG_TABLE_NAME = 'computed_update_dead_letter_seed' then
    if exists (
      select 1 from computed_update_dead_letter parent
      where parent.id = OLD.task_id
        and parent.delete_authorized_txid is distinct from txid_current()
    ) then
      raise exception 'computed update dead letter seed deletion is not authorized in transaction %',
        txid_current()
        using errcode = '23514',
              hint = 'Delete the archive parent through an authorized recovery or discard transaction.';
    end if;
    return OLD;
  end if;

  if OLD.delete_authorized_txid = txid_current() then
    return OLD;
  end if;
  manifest := case
    when jsonb_typeof(OLD.dirty_stats) = 'object'
      then OLD.dirty_stats -> 'rerunInputs'
    else null
  end;
  if manifest is null and to_regclass(format('%I.%I', TG_TABLE_SCHEMA, 'computed_update_dead_letter_seed')) is not null then
    execute format(
      'select exists (select 1 from %I.%I where task_id = $1)',
      TG_TABLE_SCHEMA,
      'computed_update_dead_letter_seed'
    ) into has_children using OLD.id;
    if not has_children then
      return OLD;
    end if;
  elsif manifest is null then
    return OLD;
  end if;
  raise exception
    'computed update dead letter % deletion is not authorized in transaction %',
    OLD.id, txid_current()
    using errcode = '23514',
          hint = 'Restore through the current recovery transaction or discard through the current administrative deletion path.';
end;
$$;

drop trigger if exists "computed_update_dead_letter_archive_guard"
  on "computed_update_dead_letter";
create trigger "computed_update_dead_letter_archive_guard"
  before delete on "computed_update_dead_letter"
  for each row execute function computed_outbox_archive_guard();

drop trigger if exists "computed_update_dead_letter_seed_archive_guard"
  on "computed_update_dead_letter_seed";
create trigger "computed_update_dead_letter_seed_archive_guard"
  before delete on "computed_update_dead_letter_seed"
  for each row execute function computed_outbox_archive_guard();

-- Resolve both authorization functions' unqualified tables against the schema that owns
-- them, not the caller's search path.
do $$
declare
  owner_schema text := current_schema();
begin
  execute format(
    'alter function %I.computed_outbox_authorize_discard(text[]) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_authorize_restore(text[]) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_complete_restore(text[]) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_discard(text[]) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_discard_base(text[]) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_discard_all() set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_delete_archive_seed(text,text,text) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_discard_existing(text[]) set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
  execute format(
    'alter function %I.computed_outbox_archive_guard() set search_path = %I, pg_catalog',
    owner_schema,
    owner_schema
  );
end;
$$;

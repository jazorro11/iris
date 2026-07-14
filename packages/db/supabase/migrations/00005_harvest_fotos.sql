alter table harvest_messages add column if not exists foto_file_id text;
alter table harvest_dataset add column if not exists dueno_foto_file_id text;

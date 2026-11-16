insert into storage.buckets (id, name, public, file_size_limit)
values ('user-files', 'user-files', false, 2147483648)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit;

grant select, insert, delete on storage.objects to authenticated;

drop policy if exists "Users can list their own files" on storage.objects;
create policy "Users can list their own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can upload their own files" on storage.objects;
create policy "Users can upload their own files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own files" on storage.objects;
create policy "Users can delete their own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

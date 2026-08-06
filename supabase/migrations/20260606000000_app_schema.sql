create type public.app_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  storage_path text not null unique,
  alt text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.albums enable row level security;
alter table public.photos enable row level security;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'admin'
  );
$$;

create or replace function public.can_access_event(event_id uuid, user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(user_id)
    or exists (
      select 1
      from public.events
      where id = event_id
        and owner_id = user_id
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create policy "Profiles are visible to owners and admins"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "Admins update profiles"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Event owners and admins can read events"
  on public.events for select
  using (owner_id = auth.uid() or public.is_admin());

create policy "Admins can create events for users"
  on public.events for insert
  with check (public.is_admin() or owner_id = auth.uid());

create policy "Event owners and admins can update events"
  on public.events for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

create policy "Event owners and admins can delete events"
  on public.events for delete
  using (owner_id = auth.uid() or public.is_admin());

create policy "Accessible albums are readable"
  on public.albums for select
  using (public.can_access_event(event_id));

create policy "Accessible albums are insertable"
  on public.albums for insert
  with check (public.can_access_event(event_id));

create policy "Accessible albums are updatable"
  on public.albums for update
  using (public.can_access_event(event_id))
  with check (public.can_access_event(event_id));

create policy "Accessible albums are deletable"
  on public.albums for delete
  using (public.can_access_event(event_id));

create policy "Accessible photos are readable"
  on public.photos for select
  using (
    exists (
      select 1
      from public.albums
      where albums.id = photos.album_id
        and public.can_access_event(albums.event_id)
    )
  );

create policy "Accessible photos are insertable"
  on public.photos for insert
  with check (
    exists (
      select 1
      from public.albums
      where albums.id = photos.album_id
        and public.can_access_event(albums.event_id)
    )
  );

create policy "Accessible photos are updatable"
  on public.photos for update
  using (
    exists (
      select 1
      from public.albums
      where albums.id = photos.album_id
        and public.can_access_event(albums.event_id)
    )
  )
  with check (
    exists (
      select 1
      from public.albums
      where albums.id = photos.album_id
        and public.can_access_event(albums.event_id)
    )
  );

create policy "Accessible photos are deletable"
  on public.photos for delete
  using (
    exists (
      select 1
      from public.albums
      where albums.id = photos.album_id
        and public.can_access_event(albums.event_id)
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 52428800, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners and admins can read photo objects"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy "Owners and admins can upload photo objects"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy "Owners and admins can update photo objects"
  on storage.objects for update
  using (
    bucket_id = 'photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  )
  with check (
    bucket_id = 'photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy "Owners and admins can delete photo objects"
  on storage.objects for delete
  using (
    bucket_id = 'photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

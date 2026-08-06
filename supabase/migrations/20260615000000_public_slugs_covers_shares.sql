create extension if not exists pgcrypto;

do $$
begin
  create type public.share_scope as enum ('profile', 'event', 'album');
exception
  when duplicate_object then null;
end $$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

alter table public.profiles
  add column if not exists slug text,
  add column if not exists cover_photo_id uuid references public.photos(id) on delete set null;

alter table public.events
  add column if not exists slug text,
  add column if not exists cover_photo_id uuid references public.photos(id) on delete set null;

alter table public.albums
  add column if not exists slug text,
  add column if not exists cover_photo_id uuid references public.photos(id) on delete set null;

update public.profiles
set slug = coalesce(
  nullif(public.slugify(display_name), ''),
  nullif(public.slugify(split_part(email, '@', 1)), ''),
  'user'
) || '-' || substr(id::text, 1, 8)
where slug is null;

update public.events
set slug = coalesce(nullif(public.slugify(title), ''), 'event') || '-' || substr(id::text, 1, 8)
where slug is null;

update public.albums
set slug = coalesce(nullif(public.slugify(title), ''), 'album') || '-' || substr(id::text, 1, 8)
where slug is null;

alter table public.profiles
  alter column slug set not null;

alter table public.events
  alter column slug set not null;

alter table public.albums
  alter column slug set not null;

create unique index if not exists profiles_slug_unique
  on public.profiles (slug);

create unique index if not exists events_owner_slug_unique
  on public.events (owner_id, slug);

create unique index if not exists albums_event_slug_unique
  on public.albums (event_id, slug);

create or replace function public.set_profile_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null or length(trim(new.slug)) = 0 then
    new.slug := coalesce(
      nullif(public.slugify(new.display_name), ''),
      nullif(public.slugify(split_part(new.email, '@', 1)), ''),
      'user'
    ) || '-' || substr(new.id::text, 1, 8);
  else
    new.slug := public.slugify(new.slug);
  end if;

  return new;
end;
$$;

create or replace function public.set_event_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null or length(trim(new.slug)) = 0 then
    new.slug := coalesce(nullif(public.slugify(new.title), ''), 'event') || '-' || substr(new.id::text, 1, 8);
  else
    new.slug := public.slugify(new.slug);
  end if;

  return new;
end;
$$;

create or replace function public.set_album_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null or length(trim(new.slug)) = 0 then
    new.slug := coalesce(nullif(public.slugify(new.title), ''), 'album') || '-' || substr(new.id::text, 1, 8);
  else
    new.slug := public.slugify(new.slug);
  end if;

  return new;
end;
$$;

drop trigger if exists set_profile_slug_before_write on public.profiles;
create trigger set_profile_slug_before_write
  before insert or update of slug, display_name, email on public.profiles
  for each row execute procedure public.set_profile_slug();

drop trigger if exists set_event_slug_before_write on public.events;
create trigger set_event_slug_before_write
  before insert or update of slug, title on public.events
  for each row execute procedure public.set_event_slug();

drop trigger if exists set_album_slug_before_write on public.albums;
create trigger set_album_slug_before_write
  before insert or update of slug, title on public.albums
  for each row execute procedure public.set_album_slug();

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  scope public.share_scope not null,
  profile_id uuid references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  password_hash text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint share_links_exact_scope check (
    (scope = 'profile' and profile_id is not null and event_id is null and album_id is null)
    or (scope = 'event' and profile_id is null and event_id is not null and album_id is null)
    or (scope = 'album' and profile_id is null and event_id is null and album_id is not null)
  )
);

alter table public.share_links enable row level security;

create or replace function public.can_manage_share_link(link public.share_links, user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(user_id)
    or (
      link.scope = 'profile'
      and link.profile_id = user_id
    )
    or (
      link.scope = 'event'
      and exists (
        select 1
        from public.events
        where events.id = link.event_id
          and events.owner_id = user_id
      )
    )
    or (
      link.scope = 'album'
      and exists (
        select 1
        from public.albums
        join public.events on events.id = albums.event_id
        where albums.id = link.album_id
          and events.owner_id = user_id
      )
    );
$$;

drop policy if exists "Share links are manageable by owners and admins" on public.share_links;
create policy "Share links are manageable by owners and admins"
  on public.share_links for all
  using (public.can_manage_share_link(share_links))
  with check (public.can_manage_share_link(share_links));

create or replace function public.create_share_link(
  p_scope public.share_scope,
  p_profile_id uuid,
  p_event_id uuid,
  p_album_id uuid,
  p_password text,
  p_expires_at timestamptz default null
)
returns public.share_links
language plpgsql
security definer
set search_path = public
as $$
declare
  new_link public.share_links;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(length(p_password), 0) < 4 then
    raise exception 'Share password must be at least 4 characters';
  end if;

  insert into public.share_links (
    scope,
    profile_id,
    event_id,
    album_id,
    password_hash,
    created_by,
    expires_at
  )
  values (
    p_scope,
    p_profile_id,
    p_event_id,
    p_album_id,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    auth.uid(),
    p_expires_at
  )
  returning * into new_link;

  if not public.can_manage_share_link(new_link, auth.uid()) then
    delete from public.share_links where id = new_link.id;
    raise exception 'Not allowed to share this resource';
  end if;

  return new_link;
end;
$$;

create or replace function public.verify_share_password(p_token text, p_password text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.share_links
    where token = p_token
      and is_active = true
      and (expires_at is null or expires_at > now())
      and password_hash = extensions.crypt(p_password, password_hash)
  );
$$;

create or replace function public.get_shared_gallery_by_slugs(
  p_profile_slug text,
  p_event_slug text default null,
  p_album_slug text default null,
  p_password text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_profile public.profiles;
  target_event public.events;
  target_album public.albums;
  password_ok boolean;
  event_ids uuid[];
  album_ids uuid[];
begin
  select * into target_profile
  from public.profiles
  where slug = public.slugify(p_profile_slug);

  if target_profile.id is null then
    raise exception 'Shared page not found';
  end if;

  if p_event_slug is not null then
    select * into target_event
    from public.events
    where owner_id = target_profile.id
      and slug = public.slugify(p_event_slug);

    if target_event.id is null then
      raise exception 'Shared event not found';
    end if;
  end if;

  if p_album_slug is not null then
    if target_event.id is null then
      raise exception 'Album links require an event slug';
    end if;

    select * into target_album
    from public.albums
    where event_id = target_event.id
      and slug = public.slugify(p_album_slug);

    if target_album.id is null then
      raise exception 'Shared album not found';
    end if;
  end if;

  select exists (
    select 1
    from public.share_links
    where is_active = true
      and (expires_at is null or expires_at > now())
      and password_hash = extensions.crypt(p_password, password_hash)
      and (
        (target_album.id is not null and scope = 'album' and album_id = target_album.id)
        or (target_event.id is not null and scope = 'event' and event_id = target_event.id)
        or (scope = 'profile' and profile_id = target_profile.id)
      )
  ) into password_ok;

  if not password_ok then
    raise exception 'Invalid share password';
  end if;

  if target_album.id is not null then
    album_ids := array[target_album.id];
    event_ids := array[target_event.id];
  elsif target_event.id is not null then
    event_ids := array[target_event.id];
    select coalesce(array_agg(id), array[]::uuid[]) into album_ids
    from public.albums
    where event_id = target_event.id;
  else
    select coalesce(array_agg(id), array[]::uuid[]) into event_ids
    from public.events
    where owner_id = target_profile.id;

    select coalesce(array_agg(albums.id), array[]::uuid[]) into album_ids
    from public.albums
    where albums.event_id = any(event_ids);
  end if;

  return jsonb_build_object(
    'profile', to_jsonb(target_profile) - 'email',
    'events', coalesce((
      select jsonb_agg(to_jsonb(events) order by events.created_at desc)
      from public.events
      where events.id = any(event_ids)
    ), '[]'::jsonb),
    'albums', coalesce((
      select jsonb_agg(to_jsonb(albums) order by albums.created_at desc)
      from public.albums
      where albums.id = any(album_ids)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(to_jsonb(photos) order by photos.sort_order asc, photos.created_at asc)
      from public.photos
      where photos.album_id = any(album_ids)
    ), '[]'::jsonb)
  );
end;
$$;

drop policy if exists "Public can sign active shared photo objects" on storage.objects;
create policy "Public can sign active shared photo objects"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and exists (
      select 1
      from public.photos
      join public.albums on albums.id = photos.album_id
      join public.events on events.id = albums.event_id
      join public.share_links on share_links.is_active = true
      where photos.storage_path = storage.objects.name
        and (share_links.expires_at is null or share_links.expires_at > now())
        and (
          (share_links.scope = 'album' and share_links.album_id = albums.id)
          or (share_links.scope = 'event' and share_links.event_id = events.id)
          or (share_links.scope = 'profile' and share_links.profile_id = events.owner_id)
        )
    )
  );

alter table public.share_links
  alter column password_hash drop not null;

create or replace function public.create_share_link(
  p_scope public.share_scope,
  p_profile_id uuid,
  p_event_id uuid,
  p_album_id uuid,
  p_password text default '',
  p_expires_at timestamptz default null
)
returns public.share_links
language plpgsql
security definer
set search_path = public
as $$
declare
  new_link public.share_links;
  cleaned_password text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  cleaned_password := nullif(trim(coalesce(p_password, '')), '');

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
    case
      when cleaned_password is null then null
      else extensions.crypt(cleaned_password, extensions.gen_salt('bf'))
    end,
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
  event_ids uuid[];
  album_ids uuid[];
begin
  select * into target_profile
  from public.profiles
  where slug = public.slugify(p_profile_slug);

  if target_profile.id is null then
    raise exception 'Shared page not found';
  end if;

  if p_event_slug is null then
    select coalesce(array_agg(id), array[]::uuid[]) into event_ids
    from public.events
    where owner_id = target_profile.id;

    select coalesce(array_agg(albums.id), array[]::uuid[]) into album_ids
    from public.albums
    where albums.event_id = any(event_ids);
  else
    select * into target_event
    from public.events
    where owner_id = target_profile.id
      and slug = public.slugify(p_event_slug);

    if target_event.id is null then
      raise exception 'Shared event not found';
    end if;

    if not exists (
      select 1
      from public.share_links
      where is_active = true
        and (expires_at is null or expires_at > now())
        and scope = 'event'
        and event_id = target_event.id
        and (
          password_hash is null
          or password_hash = extensions.crypt(coalesce(p_password, ''), password_hash)
        )
    ) then
      raise exception 'Invalid share password';
    end if;

    if p_album_slug is not null then
      select * into target_album
      from public.albums
      where event_id = target_event.id
        and slug = public.slugify(p_album_slug);

      if target_album.id is null then
        raise exception 'Shared album not found';
      end if;

      album_ids := array[target_album.id];
    else
      select coalesce(array_agg(id), array[]::uuid[]) into album_ids
      from public.albums
      where event_id = target_event.id;
    end if;

    event_ids := array[target_event.id];
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

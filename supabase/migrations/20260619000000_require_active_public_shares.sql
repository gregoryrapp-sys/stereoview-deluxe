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

  if not exists (
    select 1
    from public.share_links
    where is_active = true
      and (expires_at is null or expires_at > now())
      and (
        password_hash is null
        or password_hash = extensions.crypt(coalesce(p_password, ''), password_hash)
      )
      and (
        (target_album.id is not null and scope = 'album' and album_id = target_album.id)
        or (target_event.id is not null and scope = 'event' and event_id = target_event.id)
        or (scope = 'profile' and profile_id = target_profile.id)
      )
  ) then
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

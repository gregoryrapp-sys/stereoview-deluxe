-- Let photographers update their own profile.
--
-- The only UPDATE policy on public.profiles was "Admins update profiles"
-- (20260606000000_app_schema.sql:99-102), gated on is_admin(). But the app has
-- always performed self-updates: updateProfilePresentation() in
-- galleryService.ts, called from EventAlbumManagement.saveProfile, writes
-- display_name, slug, cover_photo_id, the dropbox cover pair, is_public and
-- password for the signed-in user.
--
-- An UPDATE that RLS rejects does not raise - it simply matches zero rows and
-- returns success. So every non-admin photographer has been silently unable to
-- save their profile, with the UI reporting success, since these policies
-- shipped in June.
--
-- Written idempotently: it converges to the correct state whether or not a
-- policy was added out-of-band via the dashboard. Permissive policies OR
-- together, so this coexists with the admin policy rather than replacing it.

drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can update their own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Guard the role column.
--
-- The policy above deliberately does not try to pin `role` in its WITH CHECK: a
-- policy cannot compare NEW against OLD, and a subquery back into profiles from
-- a policy ON profiles would recurse through RLS. A trigger can do both safely.
--
-- This matters because the client-side type permits it. The Update type is
-- Partial<Omit<Profile, 'id' | 'created_at'>> (src/types/database.ts), which
-- includes `role` - so without this, self-update would hand every user a path to
-- setting themselves to 'admin'.
--
-- is_admin() is SECURITY DEFINER, so it reads profiles without re-entering RLS
-- and the existing admin flow in Admin.tsx keeps working.

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an administrator can change a profile role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_profile_role_escalation();

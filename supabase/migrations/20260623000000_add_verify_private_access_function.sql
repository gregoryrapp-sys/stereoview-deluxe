-- This function is called by RLS policies to check if a user has been granted
-- temporary access to a private object (profile, event, or album).
-- It works by inspecting a custom 'unlocked_ids' claim within the JWT
-- provided by the client.

create or replace function public.verify_private_access(p_object_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  claims_raw json;
  claims_unlocked_ids jsonb;
begin
  -- This setting is populated by PostgREST from the Authorization: Bearer <jwt> header.
  -- The 'true' makes it return NULL instead of erroring if the setting is not found.
  claims_raw := current_setting('request.jwt.claims', true)::json;

  if claims_raw is null then
    return false;
  end if;

  -- Check if the JWT contains the 'unlocked_ids' claim and if it's an array.
  if json_typeof(claims_raw->'unlocked_ids') = 'array' then
    claims_unlocked_ids := (claims_raw->'unlocked_ids')::jsonb;
    
    -- The @> operator checks if the left JSONB value contains the right JSONB value.
    if claims_unlocked_ids @> to_jsonb(p_object_id::text) then
      return true;
    end if;
  end if;

  return false;
exception
  -- If any error occurs (e.g., invalid JWT), deny access.
  when others then
    return false;
end;
$$;
-- Acceptance of the Terms of Service per organization (audit of week 14, item 11; ADR 0018). The liability cap, the
-- refund rules and the trial rest on the terms, and nothing recorded that anybody accepted them. The owner who
-- creates an organization accepts them in the same step; an owner accepts a newer version from the organization page.

alter table public.organizations
  add column terms_version text check (terms_version is null or terms_version ~ '^\d{4}-\d{2}-\d{2}$'),
  add column terms_accepted_at timestamptz,
  add column terms_accepted_by uuid references auth.users (id) on delete set null;

drop function public.create_organization(text);

create function public.create_organization(p_name text, p_terms_version text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_user;
  insert into public.organizations (name, created_by, terms_version, terms_accepted_at, terms_accepted_by)
    values (btrim(p_name), v_user, p_terms_version, case when p_terms_version is null then null else now() end, case when p_terms_version is null then null else v_user end)
    returning id into v_org;
  insert into public.members (organization_id, user_id, email, role) values (v_org, v_user, coalesce(v_email, ''), 'owner');
  return v_org;
end;
$$;

revoke all on function public.create_organization from public, anon;
grant execute on function public.create_organization to authenticated;

-- A newer version of the terms, accepted by an owner. The time and the person come from the session.
create function public.accept_terms(p_org uuid, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_owner(p_org) then
    raise exception 'only owners accept the terms for the organization' using errcode = '42501';
  end if;
  update public.organizations set terms_version = p_version, terms_accepted_at = now(), terms_accepted_by = auth.uid() where id = p_org;
end;
$$;

revoke all on function public.accept_terms from public, anon;
grant execute on function public.accept_terms to authenticated;
